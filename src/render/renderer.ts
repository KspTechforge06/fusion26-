import { makeCodec } from "../core/codec.js";
import { isFree } from "../core/grid.js";
import type { AgentState, Grid, Position } from "../core/types.js";
import type { World } from "../core/world.js";

export interface ViewOptions {
  showTrails: boolean;
  showHeatmap: boolean;
  showBattery: boolean;
  selectedRobot: number | null;
}

export const STATE_COLOR: Record<AgentState, string> = {
  idle: "#64748b",
  moving: "#38bdf8",
  picking: "#fbbf24",
  delivering: "#a78bfa",
  charging: "#22c55e",
  stranded: "#f97316",
  broken: "#ef4444",
};

const COLORS = {
  floor: "#171918",
  floorAlt: "#242725",
  obstacle: "#5D8D5C",
  obstacleEdge: "#8A9580",
  dock: "#2563eb",
  packing: "#059669",
  charger: "#eab308",
  trail: "#7dd3fc",
  selection: "#f8fafc",
};

/**
 * Canvas 2D view of the world.
 *
 * Deliberately not a DOM element per robot: at tens of ticks per second with a
 * few dozen robots, canvas fills stay comfortably ahead of the simulation where
 * hundreds of elements would not.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cell = 16;
  private dpr = 1;
  private codec: ReturnType<typeof makeCodec>;
  private originX = 0;
  private originY = 0;

  constructor(private canvas: HTMLCanvasElement, private grid: Grid) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.codec = makeCodec(grid);
    this.resize();
  }

  /**
   * True once the canvas has a usable backing store.
   *
   * Sizing is not guaranteed at construction time: the module script runs after
   * the DOM exists, but layout may still report zero for a grid cell that has not
   * been resolved. A canvas given `width=0` silently renders nothing and never
   * recovers, because nothing re-measures it.
   */
  get isSized(): boolean {
    return this.canvas.width > 0 && this.canvas.height > 0;
  }

  /**
   * Fits the whole map inside the canvas and sets up crisp rendering.
   *
   * Assigning canvas.width/height resets the 2D context, so the DPR transform has
   * to be re-applied afterwards.
   */
  resize(): void {
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) return; // layout not ready; try again later

    this.dpr = window.devicePixelRatio || 1;

    const padding = 10;
    const fitX = (cssWidth - padding * 2) / this.grid.width;
    const fitY = (cssHeight - padding * 2) / this.grid.height;
    this.cell = Math.max(3, Math.floor(Math.min(fitX, fitY)));
    this.originX = Math.floor((cssWidth - this.cell * this.grid.width) / 2);
    this.originY = Math.floor((cssHeight - this.cell * this.grid.height) / 2);

    this.canvas.width = Math.floor(cssWidth * this.dpr);
    this.canvas.height = Math.floor(cssHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Grid cell under a pointer position, or null when outside the map. */
  cellAt(clientX: number, clientY: number): Position | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.originX) / this.cell);
    const y = Math.floor((clientY - rect.top - this.originY) / this.cell);
    if (x < 0 || y < 0 || x >= this.grid.width || y >= this.grid.height) return null;
    return { x, y };
  }

  draw(world: World, options: ViewOptions): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#171918";
    ctx.fillRect(0, 0, w, h);

    this.drawFloor();
    if (options.showHeatmap) this.drawHeatmap(world);
    if (options.showTrails) this.drawTrails(world);
    this.drawFacilities(world);
    this.drawRobots(world, options);
  }

  private drawFloor(): void {
    const { ctx, cell } = this;
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const open = isFree(this.grid, x, y);
        ctx.fillStyle = open
          ? (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt
          : COLORS.obstacle;
        ctx.fillRect(this.originX + x * cell, this.originY + y * cell, cell, cell);

        if (!open && cell >= 6) {
          ctx.strokeStyle = COLORS.obstacleEdge;
          ctx.lineWidth = 1;
          ctx.strokeRect(this.originX + x * cell + 0.5, this.originY + y * cell + 0.5, cell - 1, cell - 1);
        }
      }
    }
  }

  private drawHeatmap(world: World): void {
    const { ctx, cell } = this;

    let peak = 0;
    for (let i = 0; i < world.congestion.length; i++) {
      if (world.congestion[i] > peak) peak = world.congestion[i];
    }
    if (peak <= 0) return;

    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const value = world.congestion[this.codec.cell(x, y)];
        if (value <= 0) continue;

        // Warm amber-orange-red for congestion (visible on charcoal/sage background).
        const t = Math.min(1, value / peak);
        const r = Math.round(220 + t * 35);   // amber -> bright warm
        const g = Math.round(140 - t * 90);   // amber -> deeper orange
        const b = Math.round(20 - t * 20);    // low -> red-leaning

        ctx.fillStyle = `rgba(${r},${g},${b},${0.25 + t * 0.55})`;
        ctx.fillRect(this.originX + x * cell, this.originY + y * cell, cell, cell);
      }
    }
  }

  private drawTrails(world: World): void {
    const { ctx, cell } = this;
    ctx.lineWidth = Math.max(1, cell * 0.13);
    ctx.lineCap = "round";

    for (const robot of world.robots) {
      if (robot.state === "broken" || robot.committed.length === 0) continue;

      const stranded = robot.state === "stranded";
      ctx.strokeStyle = stranded ? "#fb923c" : COLORS.trail;
      ctx.globalAlpha = stranded ? 0.75 : 0.4;
      ctx.beginPath();
      ctx.moveTo(this.cx(robot.x), this.cy(robot.y));
      for (const p of robot.committed) ctx.lineTo(this.cx(p.x), this.cy(p.y));
      ctx.stroke();

      // Where it is heading next.
      const last = robot.committed[robot.committed.length - 1];
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = STATE_COLOR[robot.state];
      ctx.beginPath();
      ctx.arc(this.cx(last.x), this.cy(last.y), Math.max(1.5, cell * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  private drawFacilities(world: World): void {
    const { ctx, cell } = this;

    const stamp = (p: Position, color: string, glyph: string) => {
      const x = this.originX + p.x * cell;
      const y = this.originY + p.y * cell;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      ctx.globalAlpha = 1;

      if (cell >= 12) {
        ctx.fillStyle = "#f8fafc";
        ctx.font = `${Math.floor(cell * 0.62)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(glyph, x + cell / 2, y + cell / 2 + 1);
      }
    };

    for (const dock of world.docks) stamp(dock, COLORS.dock, "D");
    for (const station of world.packingStations) stamp(station, COLORS.packing, "P");
    for (const charger of world.chargers) stamp(charger, COLORS.charger, "C");
  }

  private drawRobots(world: World, options: ViewOptions): void {
    const { ctx, cell } = this;

    for (const robot of world.robots) {
      const cx = this.cx(robot.x);
      const cy = this.cy(robot.y);
      const radius = cell * 0.36;

      ctx.fillStyle = STATE_COLOR[robot.state];
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      if (robot.state === "broken") {
        ctx.strokeStyle = "#fecaca";
        ctx.lineWidth = Math.max(1.5, cell * 0.12);
        ctx.beginPath();
        ctx.moveTo(cx - radius * 0.5, cy - radius * 0.5);
        ctx.lineTo(cx + radius * 0.5, cy + radius * 0.5);
        ctx.moveTo(cx + radius * 0.5, cy - radius * 0.5);
        ctx.lineTo(cx - radius * 0.5, cy + radius * 0.5);
        ctx.stroke();
      }

      // Battery ring, sweeping clockwise from the top.
      if (options.showBattery && cell >= 10) {
        ctx.strokeStyle = robot.battery < world.lowBattery ? "#ef4444" : "#94a3b8";
        ctx.lineWidth = Math.max(1, cell * 0.09);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * robot.battery);
        ctx.stroke();
      }

      // Carrying a payload.
      if (robot.stage === "to-dropoff") {
        ctx.fillStyle = "#fde68a";
        const s = cell * 0.26;
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      }

      if (cell >= 14) {
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${Math.floor(cell * 0.4)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(robot.id), cx, cy + 1);
      }

      if (options.selectedRobot === robot.id) {
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private cx(gridX: number): number {
    return this.originX + gridX * this.cell + this.cell / 2;
  }

  private cy(gridY: number): number {
    return this.originY + gridY * this.cell + this.cell / 2;
  }
}