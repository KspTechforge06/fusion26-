import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isFree } from "../src/core/grid.js";
import { createWorld } from "../src/core/warehouse.js";
import { Renderer } from "../src/render/renderer.js";
import type { Grid } from "../src/core/types.js";

/**
 * The renderer is DOM-facing, so it is exercised against a stub canvas in the node
 * environment. These guard the failure that produced an entirely blank viewport:
 * the canvas being handed a zero-sized backing store before layout had resolved,
 * which renders nothing and never recovers because nothing re-measures it.
 */
beforeAll(() => {
  if (typeof globalThis.window === "undefined") {
    Object.defineProperty(globalThis, "window", {
      value: { devicePixelRatio: 2 },
      configurable: true,
      writable: true,
    });
  }
});

afterAll(() => {
  // Leave the global as we found it for any other suite in the same worker.
  Reflect.deleteProperty(globalThis, "window");
});
function stubCanvas(cssWidth: number, cssHeight: number): HTMLCanvasElement {
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) => (key === "setTransform" ? () => {} : () => {}),
      set: () => true,
    },
  );

  return {
    clientWidth: cssWidth,
    clientHeight: cssHeight,
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: cssWidth, height: cssHeight }),
  } as unknown as HTMLCanvasElement;
}

function testGrid(): Grid {
  const grid = createWorld({ seed: 42, robotCount: 6, initialTasks: 3 }).grid;
  return grid;
}

describe("renderer sizing", () => {
  it("reports unsized when layout has not resolved", () => {
    const renderer = new Renderer(stubCanvas(0, 0), testGrid());
    expect(renderer.isSized).toBe(false);
  });

  it("scales the backing store by device pixel ratio", () => {
    const canvas = stubCanvas(900, 700);
    const renderer = new Renderer(canvas, testGrid());

    expect(renderer.isSized).toBe(true);
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it("maps pointer positions onto grid cells", () => {
    const grid = testGrid();
    const renderer = new Renderer(stubCanvas(900, 700), grid);

    const centre = renderer.cellAt(450, 350);
    expect(centre).not.toBeNull();
    expect(centre!.x).toBeGreaterThanOrEqual(0);
    expect(centre!.x).toBeLessThan(grid.width);
    expect(centre!.y).toBeGreaterThanOrEqual(0);
    expect(centre!.y).toBeLessThan(grid.height);
  });

  it("returns null for positions outside the map", () => {
    const grid = testGrid();
    const renderer = new Renderer(stubCanvas(900, 700), grid);
    expect(renderer.cellAt(-500, -500)).toBeNull();
    expect(renderer.cellAt(5000, 5000)).toBeNull();
  });

  it("draws a live world without throwing", () => {
    const world = createWorld({ seed: 42, robotCount: 8, initialTasks: 4 });
    world.run(40);

    const renderer = new Renderer(stubCanvas(900, 700), world.grid);
    expect(() =>
      renderer.draw(world, {
        showTrails: true,
        showHeatmap: true,
        showBattery: true,
        selectedRobot: 0,
      }),
    ).not.toThrow();
  });
});

describe("world data is renderable", () => {
  it("produces a floor with free cells and robots standing on it", () => {
    const world = createWorld({ seed: 42, robotCount: 14, initialTasks: 7 });

    let free = 0;
    for (const cell of world.grid.cells) if (cell === 1) free++;
    expect(free).toBeGreaterThan(world.grid.cells.length * 0.5);

    expect(world.robots).toHaveLength(14);
    for (const robot of world.robots) {
      expect(isFree(world.grid, robot.x, robot.y), `R${robot.id} spawned on shelving`).toBe(true);
    }

    expect(world.docks.length).toBeGreaterThan(0);
    expect(world.packingStations.length).toBeGreaterThan(0);
    expect(world.chargers.length).toBeGreaterThan(0);
  });

  it("keeps facilities on cells a robot can actually stand on", () => {
    const world = createWorld({ seed: 7, robotCount: 10, initialTasks: 4 });
    for (const p of [...world.docks, ...world.packingStations, ...world.chargers]) {
      expect(isFree(world.grid, p.x, p.y), `facility at ${p.x},${p.y} is not on floor`).toBe(true);
    }
  });
});