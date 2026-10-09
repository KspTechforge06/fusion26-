import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BENCH_DIR = join(process.cwd(), "benchmarks", "maps");

export interface LoadedMap {
  name: string;
  text: string;
}

/** True when the benchmark maps have been downloaded. */
export function mapsAvailable(): boolean {
  return existsSync(BENCH_DIR);
}

export function listMaps(): LoadedMap[] {
  if (!mapsAvailable()) return [];
  const files = readdirSync(BENCH_DIR).filter((f: string) => f.endsWith(".map")).sort();
  return files.map((f: string) => ({
    name: f.replace(/\.map$/, ""),
    text: readFileSync(join(BENCH_DIR, f), "utf8"),
  }));
}

export const SMALL_MAPS = [
  "random-32-32-10",
  "random-32-32-20",
  "room-32-32-4",
];

export const WAREHOUSE_MAPS = [
  "warehouse-10-20-10-2-1",
  "warehouse-10-20-10-2-2",
  "warehouse-20-40-10-2-1",
  "warehouse-20-40-10-2-2",
];