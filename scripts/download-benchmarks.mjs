#!/usr/bin/env node
/**
 * Downloads and extracts the MovingAI MAPF benchmark maps.
 *
 * Maps only by default (73 KB). Scenario files run to 8-10 MB per set and are
 * opt-in, because a single scenario file is enough to prove solver correctness --
 * the full sweep is a benchmarking activity, not a CI one.
 *
 *   node scripts/download-benchmarks.mjs
 *   node scripts/download-benchmarks.mjs --scenarios
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "benchmarks");

const BASE = "https://movingai.com/benchmarks/mapf";
const ARTIFACTS = [
  { url: `${BASE}/mapf-map.zip`, name: "maps.zip" },
  { url: `${BASE}/mapf-scen-even.zip`, name: "scen-even.zip", scenarios: true },
  { url: `${BASE}/mapf-scen-random.zip`, name: "scen-random.zip", scenarios: true },
];

async function download(url, dest) {
  process.stdout.write(`  fetching ${url}\n`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buffer);
  return buffer.length;
}

async function extract(zipPath, target) {
  await mkdir(target, { recursive: true });
  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${target}' -Force`,
    ]);
  } else {
    await run("unzip", ["-o", zipPath, "-d", target]);
  }
}

async function main() {
  const wantScenarios = process.argv.includes("--scenarios");
  await mkdir(outDir, { recursive: true });

  console.log(`MAPF benchmarks -> ${outDir}`);

  for (const artifact of ARTIFACTS) {
    if (artifact.scenarios && !wantScenarios) {
      console.log(`  skip ${artifact.name} (pass --scenarios to include)`);
      continue;
    }

    const zipPath = join(outDir, artifact.name);
    if (existsSync(zipPath)) {
      console.log(`  have ${artifact.name}`);
    } else {
      const bytes = await download(artifact.url, zipPath);
      console.log(`  saved ${artifact.name} (${(bytes / 1024).toFixed(0)} KB)`);
    }

    const target = join(outDir, artifact.name.replace(/\.zip$/, ""));
    await rm(target, { recursive: true, force: true });
    await extract(zipPath, target);
    console.log(`  extracted -> ${target}`);
  }

  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});