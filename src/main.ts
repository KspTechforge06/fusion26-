import { snapshot } from "./core/metrics.js";
import { Renderer, STATE_COLOR, type ViewOptions } from "./render/renderer.js";
import { isFree } from "./core/grid.js";
import { createWorld } from "./core/warehouse.js";
import type { World } from "./core/world.js";

/** DOM lookup that fails loudly rather than dereferencing null. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>("canvas");
const tooltip = el<HTMLDivElement>("tooltip");

const seedInput = el<HTMLInputElement>("seed");
const robotsInput = el<HTMLInputElement>("robots");
const speedInput = el<HTMLInputElement>("speed");
const speedLabel = el<HTMLSpanElement>("speedLabel");
const playBtn = el<HTMLButtonElement>("play");
const stepBtn = el<HTMLButtonElement>("step");
const restartBtn = el<HTMLButtonElement>("restart");

const armedBlock = el<HTMLInputElement>("armedBlock");
const armedKill = el<HTMLInputElement>("armedKill");
const armedClear = el<HTMLInputElement>("armedClear");
const injectRushBtn = el<HTMLButtonElement>("injectRush");
const escalateBtn = el<HTMLButtonElement>("escalate");
const repairAllBtn = el<HTMLButtonElement>("repairAll");
const autoFaults = el<HTMLInputElement>("autoFaults");
const autoFaultLabel = el<HTMLSpanElement>("autoFaultLabel");

const showTrails = el<HTMLInputElement>("showTrails");
const showHeatmap = el<HTMLInputElement>("showHeatmap");
const showBattery = el<HTMLInputElement>("showBattery");

const statsEl = el<HTMLDListElement>("stats");
const causesEl = el<HTMLDListElement>("causes");
const selectionEl = el<HTMLDivElement>("selection");
const logEl = el<HTMLOListElement>("log");

const state = {
  world: null as World | null,
  renderer: null as Renderer | null,
  running: true,
  selectedRobot: null as number | null,
  autoFaultRate: 0,
  logRendered: 0,
  hoverCell: null as { x: number; y: number } | null,
};

const LOG_LIMIT = 60;

function restart(): void {
  const seed = Number(seedInput.value) || 1;
  const robotCount = Math.max(2, Math.min(40, Number(robotsInput.value) || 14));

  state.world = createWorld({
    seed,
    robotCount,
    initialTasks: Math.max(4, Math.round(robotCount / 2)),
  });
  state.renderer = new Renderer(canvas, state.world.grid);
  state.selectedRobot = null;
  state.logRendered = 0;
  logEl.replaceChildren();
  selectionEl.textContent = "Click a robot to inspect it.\nUse Play/Step to observe bidding, routing, and fault recovery.";

  // Layout may not be resolved on the very first construction, which would leave
  // the canvas with a zero-sized backing store. Measure again once the frame is up.
  requestAnimationFrame(() => {
    state.renderer?.resize();
    draw();
  });
}

/**
 * Keeps the canvas backing store matched to its box.
 *
 * A window resize listener alone misses panel reflow and zoom changes, and a canvas
 * that ends up 0x0 renders nothing forever.
 */
function watchCanvasSize(): void {
  const observer = new ResizeObserver(() => {
    state.renderer?.resize();
    draw();
  });
  observer.observe(canvas);

  // Keep retrying until the canvas first gets a real size.
  const settle = () => {
    if (state.renderer && !state.renderer.isSized) {
      state.renderer.resize();
      draw();
      requestAnimationFrame(settle);
    }
  };
  requestAnimationFrame(settle);
}

function viewOptions(): ViewOptions {
  return {
    showTrails: showTrails.checked,
    showHeatmap: showHeatmap.checked,
    showBattery: showBattery.checked,
    selectedRobot: state.selectedRobot,
  };
}

function draw(): void {
  const renderer = state.renderer;
  if (!state.world || !renderer || !renderer.isSized) return;
  renderer.draw(state.world, viewOptions());
}

function updateStats(): void {
  const world = state.world;
  if (!world) return;

  const s = snapshot(world.metrics);
  const active = world.robots.filter((r) => r.state !== "broken" && r.taskId !== null).length;

  const rows: Array<[string, string]> = [
    ["tick", String(s.tick)],
    ["orders done", `${s.completed} / ${Object.values(s.byPriority).reduce((a, b) => a + b.created, 0)}`],
    ["throughput", `${s.throughput.toFixed(2)} /100t`],
    ["mean latency", `${s.meanLatency.toFixed(1)} t`],
    ["p95 latency", `${s.p95Latency.toFixed(0)} t`],
    ["re-plans", String(s.totalReplans)],
    ["per order", s.replansPerTask.toFixed(1)],
    ["deadlocks", String(world.metrics.deadlocks)],
    ["wait ticks", String(s.waitTicks)],
    ["detour ratio", s.detourRatio.toFixed(3)],
    ["in pool", String(world.openTasks().length)],
    ["active", `${active}/${world.robots.length}`],
  ];
  statsEl.replaceChildren(...renderRows(rows));

  const causes = Object.entries(s.replansByCause)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  causesEl.replaceChildren(...renderRows(causes.length > 0 ? causes : [["—", "0"]]));
}

function renderRows(rows: Array<[string, string | number]>): HTMLElement[] {
  return rows.flatMap(([key, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    return [dt, dd];
  });
}

function updateSelection(): void {
  const world = state.world;
  if (!world) return;

  const robot = state.selectedRobot === null ? null : world.robots[state.selectedRobot];
  if (!robot) {
    selectionEl.textContent = "Click a robot to inspect it.";
    return;
  }

  const task = robot.taskId === null ? null : world.tasks.get(robot.taskId);
  const next = robot.committed[0];
  const goal = robot.committed[robot.committed.length - 1];

  // Explanation of decision: why this robot has the task / is rerouting
  let explanation = "";
  if (robot.taskId !== null && task) {
    const score = "(bid score reflects distance, queue depth, priority, battery, congestion)";
    explanation = `Assigned because best bidder for order ${task.id} (${task.priority}). ${score}`;
  }
  if (robot.replanCause) {
    explanation += ` Replanning due to ${robot.replanCause}.`;
  } else if (robot.consecutiveWaits >= 4) {
    explanation += " Waiting: queue or blocked aisle.";
  } else if (robot.state === "stranded") {
    explanation += " Stranded: no safe route within horizon.";
  }

  selectionEl.textContent = [
    `robot      R${robot.id}`,
    `state      ${robot.state}`,
    `position   ${robot.x}, ${robot.y}`,
    `battery    ${(robot.battery * 100).toFixed(0)}%`,
    `order      ${task ? `#${task.id} (${task.priority})` : "—"}`,
    `stage      ${task ? (robot.stage === "to-pickup" ? "to dock" : "to packing") : "—"}`,
    `committed  ${robot.committed.length} steps`,
    `next       ${next ? `${next.x}, ${next.y}` : "—"}`,
    `heading    ${goal ? `${goal.x}, ${goal.y}` : "—"}`,
    `moves      ${robot.moves}   waits ${robot.waitTicks}`,
    `re-plans   ${robot.replans}`,
    `--- why ---`,
    explanation,
  ].join("\n");
}

function updateLog(): void {
  const world = state.world;
  if (!world) return;

  const events = world.log.slice(-LOG_LIMIT);
  if (state.logRendered === 0 || events.length < state.logRendered) {
    logEl.replaceChildren();
    state.logRendered = 0;
  }

  for (let i = state.logRendered; i < events.length; i++) {
    const event = events[i];
    const li = document.createElement("li");
    li.className = `k-${event.kind}`;

    const tick = document.createElement("b");
    tick.textContent = `t${event.tick} `;
    li.append(tick, document.createTextNode(event.message));
    logEl.append(li);
  }

  state.logRendered = events.length;
  while (logEl.childElementCount > LOG_LIMIT) logEl.removeChild(logEl.firstChild!);
  logEl.scrollTop = logEl.scrollHeight;
}

function updateTooltip(): void {
  const world = state.world;
  const renderer = state.renderer;

  if (!world || !renderer || !state.hoverCell) {
    tooltip.hidden = true;
    return;
  }

  const { x, y } = state.hoverCell;
  const robot = world.robotAt(x, y);
  const lines = [`(${x}, ${y})  ${isFree(world.grid, x, y) ? "floor" : "shelving"}`];
  let accent = "";

  if (robot) {
    accent = STATE_COLOR[robot.state];
    lines.push(`R${robot.id}  ${robot.state}`);
    lines.push(`battery ${(robot.battery * 100).toFixed(0)}%`);
    if (robot.taskId !== null) lines.push(`order #${robot.taskId}`);
  }

  tooltip.textContent = lines.join("\n");
  tooltip.hidden = false;
  tooltip.style.color = accent;

  const rect = canvas.getBoundingClientRect();
  const pad = 14;
  const flipX = x > world.grid.width * 0.6;
  tooltip.style.left =
    `${(flipX ? -1 : 1) * (tooltip.offsetWidth + pad) + (flipX ? rect.width : 0)}px`;
  tooltip.style.top = `${pad + (y / world.grid.height) * rect.height}px`;
}

function handleClick(event: MouseEvent): void {
  const world = state.world;
  const renderer = state.renderer;
  if (!world || !renderer) return;

  const cell = renderer.cellAt(event.clientX, event.clientY);
  if (!cell) return;

  const robot = world.robotAt(cell.x, cell.y);

  if (robot && armedKill.checked) {
    world.failRobot(robot.id);
    return;
  }
  if (armedBlock.checked) {
    world.blockCell(cell.x, cell.y);
    return;
  }
  if (armedClear.checked) {
    world.unblockCell(cell.x, cell.y);
    return;
  }

  state.selectedRobot = robot ? robot.id : null;
  updateSelection();
}

/** Injects a plausible fault now and then when the auto-fault rate is dialled up. */
function maybeAutoFault(): void {
  const world = state.world;
  if (!world || state.autoFaultRate <= 0) return;
  if (Math.random() > state.autoFaultRate / 100) return;

  const roll = Math.random();
  if (roll < 0.45) {
    world.failRobot(Math.floor(Math.random() * world.robots.length));
  } else if (roll < 0.9) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = 1 + Math.floor(Math.random() * (world.grid.width - 2));
      const y = 1 + Math.floor(Math.random() * (world.grid.height - 2));
      if (world.blockCell(x, y)) break;
    }
  } else {
    world.injectTask("rush");
  }
}

// --------------------------------------------------------------- simulation

let accumulator = 0;
let lastFrame = performance.now();
const MAX_STEPS_PER_FRAME = 12;

function frame(now: number): void {
  const elapsed = now - lastFrame;
  lastFrame = now;

  if (state.running && state.world) {
    const ticksPerSecond = Number(speedInput.value);
    accumulator += (elapsed / 1000) * ticksPerSecond;

    // Bounded catch-up: without the cap, a stall in the tab would otherwise try to
    // replay hundreds of ticks in one frame and freeze the page.
    let steps = 0;
    while (accumulator >= 1 && steps < MAX_STEPS_PER_FRAME) {
      state.world.step();
      maybeAutoFault();
      accumulator -= 1;
      steps++;
    }
    if (accumulator > 4) accumulator = 0;
  }

  draw();
  updateStats();
  updateLog();
  updateTooltip();

  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------- wiring

restartBtn.addEventListener("click", () => {
  restart();
  draw();
  updateStats();
});

playBtn.addEventListener("click", () => {
  state.running = !state.running;
  playBtn.textContent = state.running ? "Pause" : "Play";
  lastFrame = performance.now();
});

stepBtn.addEventListener("click", () => {
  if (!state.world) return;
  state.running = false;
  playBtn.textContent = "Play";
  for (let i = 0; i < 5; i++) state.world.step();
  draw();
  updateStats();
});

speedInput.addEventListener("input", () => {
  speedLabel.textContent = `${speedInput.value} t/s`;
});

autoFaults.addEventListener("input", () => {
  state.autoFaultRate = Number(autoFaults.value);
  autoFaultLabel.textContent = state.autoFaultRate === 0 ? "off" : `${state.autoFaultRate}%`;
});

injectRushBtn.addEventListener("click", () => state.world?.injectTask("rush"));

escalateBtn.addEventListener("click", () => {
  const world = state.world;
  if (!world) return;

  const selected = state.selectedRobot;
  const owned = selected === null ? null : world.robots[selected].taskId;

  if (owned !== null) {
    world.raisePriority(owned, "rush");
    return;
  }

  // Otherwise escalate the oldest live order, so the button always does something.
  const live = [...world.tasks.values()]
    .filter((t) => t.deliveredTick === null)
    .sort((a, b) => a.createdTick - b.createdTick);
  if (live.length > 0) world.raisePriority(live[0].id, "rush");
});

repairAllBtn.addEventListener("click", () => {
  if (!state.world) return;
  for (const robot of state.world.robots) state.world.repairRobot(robot.id);
});

canvas.addEventListener("click", handleClick);

canvas.addEventListener("mousemove", (event) => {
  if (!state.renderer) return;
  state.hoverCell = state.renderer.cellAt(event.clientX, event.clientY);
});

canvas.addEventListener("mouseleave", () => {
  state.hoverCell = null;
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;

  switch (event.key) {
    case " ":
      event.preventDefault();
      playBtn.click();
      break;
    case ".":
      stepBtn.click();
      break;
    case "b":
      armedBlock.checked = true;
      break;
    case "k":
      armedKill.checked = true;
      break;
    case "Escape":
      state.selectedRobot = null;
      updateSelection();
      break;
  }
});

window.addEventListener("resize", () => {
  state.renderer?.resize();
  draw();
});

restart();
watchCanvasSize();
speedLabel.textContent = `${speedInput.value} t/s`;
autoFaultLabel.textContent = "off";
requestAnimationFrame(frame);