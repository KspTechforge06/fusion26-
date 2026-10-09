# FUSION26 — Edge-AI Distributed Fleet Coordination for Warehouse AMRs

**SIH 2026 · Problem Statement ID 26123**
*Edge-AI Based Distributed Fleet Coordination for Autonomous Mobile Robots in smart warehouses.*
Theme: Smart Automation · Category: Software · Benchmark: [MovingAI MAPF](https://movingai.com/benchmarks/mapf.html)

A decentralized warehouse robot fleet. **One ESP8266 = one robot.** Each board
senses, decides, and talks to its neighbors over ESP-NOW — there is **no central
controller**. Robots keep working, re-routing and recovering tasks, when a peer
fails, a path congests, or priorities change.

---

## What's in this repo

| Path | What it is |
|---|---|
| **`guide.md`** | **Read this first.** The problem brief: what SIH 26123 asks for, the three disruption triggers (congestion, failure, priority change), what "decentralized" really means, the evaluation focus, metrics, and milestones. |
| **`esp8266/`** | The uploadable firmware for the ESP8266 boards (ESP-NOW + tiny GNN). See the table below. |
| **`ESP8266_ESP_NOW_Tiny_GNN_Warehouse_AMR_Guide.md`** | Full design rationale, training plan, protocol details, and test metrics for the firmware. |
| **`maps/`** | The 33 MovingAI octile-format benchmark maps + an `audit ` folder with the design/audit reports. |
| **`README.md`** | This file — the index of what's what. |

---

## `esp8266/` — the firmware

One board = one robot. Wire protocol is a 16-byte broadcast packet; decisions are
local. Arduino IDE is the primary toolchain.

| File | Runs on | Purpose |
|---|---|---|
| `esp8266.ino` | board | Main firmware: `setup()`, `loop()`, ESP-NOW, state machine, telemetry |
| `config.h` | board | **`ROBOT_ID`**, channel, grid size, timing, priority defaults |
| `robot_packet.h` | board | 16-byte wire packet + action/status enums |
| `robot_state.h` | board | The local robot's own state (pos, goal, battery, priority) |
| `grid.h` | board | Occupancy grid + demo warehouse map |
| `tiny_gnn.h` | board | Message-passing GNN inference (encode → mean-aggregate → score) |
| `tiny_gnn_weights.h` | board | GNN weights (hand-built bootstrap; replaceable by training) |
| `neighbor_table.h` | board | Peer table, sequence dedup, freshness/expiry, failure detection |
| `safety_filter.h` | board | Independent action mask + deterministic priority/id tie-break |
| `task_market.h` | board | Best-effort task adoption after a peer fails |
| `README.md` | — | Firmware reference: hardware, upload steps, serial commands, requirements mapping |
| `setup.md` | — | Step-by-step setup guide (toolchain install → per-board ID → bring-up → demo scenarios) |
| `platformio.ini` | laptop | Optional PlatformIO build (Arduino IDE is primary) |
| `tools/train_gnn.py` | laptop | Imitation-learn a tiny GNN from a safe teacher |
| `tools/export_weights.py` | laptop | Export a trained checkpoint → `tiny_gnn_weights.h` |

> Arduino IDE requirement: the sketch folder name must equal the `.ino` name.
> The folder is `esp8266` and the sketch is `esp8266.ino`, so it opens directly.

**Give every board a unique ID.** Edit `config.h` (`#define ROBOT_ID 1`, then `2`, …)
and re-upload per board, or override at build time with `-DROBOT_ID=2`.

**Quick start:** open `esp8266/setup.md` for the full walkthrough, or
`esp8266/README.md` for the firmware reference and serial command list.

---

## `maps/` — benchmark data and reports

- **33 `.map` files** — MovingAI octile maps (warehouse, warehouse-20-40, room,
  maze, random, and city maps). Used as reference scenarios for the grid.
- **`maps/audit /`** — project documentation from the planning step
  (note the trailing space in the folder name):
  - `STEP_01_AUDIT.md` — environment + map audit (map validity, counts).
  - `STEP_02_SPECIFICATION.md` — the simulation design specification.
  - `STEP_02_AUDIT.md` / `STEP_02_1_REVIEW.md` — audit and review of that spec.

---

## The three behaviors this proves

1. **Congestion** — robots sharing an aisle raise their WAIT score and re-route
   locally; conflicts climb but motion continues.
2. **Equipment failure** — press `f` on a board; peers time it out, mark it failed,
   treat its last cell as blocked, and the best-placed robot adopts its goal.
3. **Priority change** — raise `pri` on one robot; it wins contested cells and the
   lower-priority robot yields.

All of the above happen **peer-to-peer**, with no central replanning.

---

## Status

- Firmware compiles for `esp8266:esp8266` (NodeMCU 1.0) and has been flashed and
  run on real hardware (`ROBOT_ID=1`); GNN inference ≈ 295 µs per decision.
- Shipped `tiny_gnn_weights.h` is a GNN-inspired **bootstrap** (not trained). Use
  `tools/train_gnn.py` + `tools/export_weights.py` to drop in a trained model, then
  verify Python↔board parity before claiming a deployed trained GNN.
- See `guide.md` for the roadmap and evaluation criteria.
