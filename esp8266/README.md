# FUSION26 — ESP8266 / ESP-NOW Firmware

Decentralized firmware for the warehouse AMR fleet. **One ESP8266 = one robot.**
Every board senses, decides and communicates locally over ESP-NOW — there is no
central movement controller.

This folder contains the ESP-NOW files you upload to the boards. The training
tools run on the laptop (they are never flashed).

---

## Files

| File | Runs on | Purpose |
|---|---|---|
| `esp8266.ino` | board | Main firmware: setup, loop, ESP-NOW, state machine |
| `config.h` | board | **Robot ID**, channel, grid, timing, priorities |
| `robot_packet.h` | board | Wire packet + action/status enums |
| `robot_state.h` | board | The local robot's own state |
| `grid.h` | board | Occupancy grid + demo warehouse map |
| `tiny_gnn.h` | board | Message-passing GNN inference (`W_IN`, `W_SELF`, …) |
| `tiny_gnn_weights.h` | board | GNN weights (bootstrap; replaceable by training) |
| `neighbor_table.h` | board | Peer table, sequence dedup, freshness/failure |
| `safety_filter.h` | board | Independent action mask + priority tie-break |
| `task_market.h` | board | Best-effort task adoption after a peer fails |
| `platformio.ini` | laptop | Optional PlatformIO build (Arduino IDE is primary) |
| `tools/train_gnn.py` | laptop | Imitation-learn a tiny GNN from a teacher |
| `tools/export_weights.py` | laptop | Export checkpoint → `tiny_gnn_weights.h` |

> Arduino IDE requirement: the sketch folder name must equal the `.ino` name.
> The folder is `esp8266` and the sketch is `esp8266.ino`, so it opens directly.

---

## 1. Hardware

- 2–3+ **ESP8266 NodeMCU / ESP-12E** boards (one per robot)
- USB data cables
- A laptop

No wiring is needed for the software-only demo (all robots are simulated by
boards; the laptop is only a display/telemetry sink). If you later add motors,
power them from a separate supply with a common ground — **never from a GPIO**.

---

## 2. Arduino IDE setup

1. Install the ESP8266 board package:
   `File → Preferences → Additional Boards Manager URLs` →
   `https://arduino.esp8266.com/stable/package_esp8266com_index.json`,
   then install **esp8266** in Boards Manager.
2. Select board **NodeMCU 1.0 (ESP-12E Module)** (or your exact board).
3. Open `esp8266/esp8266.ino`.
4. **Set a unique `ROBOT_ID` in `config.h` for each board**, then upload.
5. Open **Serial Monitor** at **115200** baud, newline line ending.

### Give every board a unique ID

`config.h`:

```c
#ifndef ROBOT_ID
#define ROBOT_ID 1      // <-- 1, then 2, then 3, ... per board
#endif
```

Re-upload for each value. Alternatively (PlatformIO / arduino-cli) override at
build time: `-DROBOT_ID=2`.

---

## 3. Run the fleet

1. Power every board (USB or a 5 V supply). They all use `ESPNOW_CHANNEL` from
   `config.h` — keep it identical on every board.
2. On each serial monitor you should see:

```
BOOT,FUSION26,id=1,proto=1
MAC,AA:BB:CC:DD:EE:FF
CFG,id=1,channel=1,grid=24x24,neighborTimeout=1500,failureTimeout=5000
CMDS: f | goal <x> <y> | pri <n> | info | reset | help
TELEM,1,5,5,18,13,100,1,0,3,2,17,4,0,0,0,42
```

- `TELEM` line: `id,x,y,goalX,goalY,battery,priority,status,action,neighbors,moves,waits,conflicts,adoptions,deliveries,inferUs`
- `EVENT` lines mark deliveries, adopted tasks, and simulated failures.

### Serial commands

| Command | Effect |
|---|---|
| `f` | Simulate **this robot failing** (goes silent + freezes ~8 s). Peers time it out, mark it failed, and a best-placed robot adopts its goal. |
| `goal <x> <y>` | Set this robot's goal (e.g. `goal 20 3`). |
| `pri <n>` | Set priority 0–10 (higher wins ties in the safety filter). |
| `info` | Print id, MAC, position, and last GNN scores. |
| `reset` | Zero the statistics counters. |
| `help` | List commands. |

### Demonstrating the three required behaviors

- **Congestion** — bring several boards close together / aim them through one
  aisle. Robots raise their WAIT score and re-route; `conflicts` climbs, moves
  continue.
- **Equipment failure** — press `f` on one board. The others stop hearing it,
  mark it failed after `FAILURE_TIMEOUT_MS`, treat its last cell as blocked, and
  the closest healthy peer prints `EVENT,task_adopted,...`.
- **Priority change** — run `pri 9` on one robot. At contested cells it wins the
  tie-break and the lower-priority robot yields.

---

## 4. How the local loop works (see `esp8266.ino`)

```
handleSerial → drainRxQueue → handleFailuresAndTasks → stepMovement
             → broadcastState → printTelemetry
```

1. **Broadcast** own state/action every `BROADCAST_INTERVAL_MS` (200 ms).
2. **Receive** into a small queue; the ESP-NOW callback does *no* heavy work.
3. **Update** the neighbor table (validate length/version, reject self and old
   sequence numbers, timestamp arrival).
4. **Expire** stale peers (`NEIGHBOR_TIMEOUT_MS`) and flag failures
   (`FAILURE_TIMEOUT_MS`).
5. **Features**: 6 normalized inputs — relative goal X/Y, battery, priority,
   congestion, status.
6. **GNN**: encode self + neighbors, **mean-aggregate** neighbor hidden states
   (permutation-invariant), combine, emit 5 action scores.
7. **Safety filter** masks unsafe moves (walls, occupied/known cells, same-target
   claims) with a deterministic `(priority, lower id)` tie-break. `WAIT` is
   always allowed.
8. **Execute** one grid step or wait; adopt a failed peer's goal if best placed.

### Why this counts as decentralized

- Each board owns its own state and decision. Packets are broadcast peer-to-peer.
- There is no global plan and no `replan-everyone` call. A failure only changes
  local neighbor records and prompts one local task adoption.
- Computation and radio load scale with the local neighborhood, not fleet size.

---

## 5. Radio notes

- All peers must share one channel. Keep `ESPNOW_CHANNEL` the same and do not
  connect to a Wi-Fi AP (that can move the radio off-channel).
- Broadcast `FF:FF:FF:FF:FF:FF` is used, so no MAC lists are needed. Broadcast
  has no authentication/ACK — fine for a demo, do not treat it as secure.
- ESP-NOW payload here is 16 bytes, far below the ESP8266 limit.
- The receive callback only copies into a queue; everything else runs in `loop()`.

---

## 6. Using a trained model (optional)

The shipped `tiny_gnn_weights.h` is a hand-built **GNN-inspired bootstrap** so the
fleet moves out of the box. To use a genuinely trained model (PyTorch + NumPy):

```bash
cd tools
pip install torch numpy
python3 train_gnn.py --samples 40000 --epochs 40   # imitation of a safe teacher
# -> writes tiny_gnn.pt and overwrites ../tiny_gnn_weights.h
```

Then **verify parity** before trusting it: the guide requires 20–100 fixed
inputs run through Python and the board to match within a small tolerance. Only
call it a *trained deployed GNN* once that passes.

---

## 7. Bring-up / verification checklist

- [ ] Each board prints its MAC and a unique `ROBOT_ID`.
- [ ] `TELEM` `neighbors` becomes non-zero when boards are powered together.
- [ ] `sequence` numbers increase in the packets each board sends.
- [ ] Unplugging one board does not stop the others.
- [ ] Pressing `f` on one board triggers `EVENT,simulated_failure` there and
      later `EVENT,task_adopted` on a peer.
- [ ] Moving a board away (out of range) does not crash the rest; it is only
      marked failed after the timeout.
- [ ] `generic: scores change` when a neighbor is added/removed (`info`).

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| No packets (`neighbors=0`) | same channel on all boards; same `PROTOCOL_VERSION`; same packet struct; boards actually flashed |
| Scores never change | weights are zeros? you flashed the bootstrap file? run `info` and watch features/neighbors |
| Robots freeze/collide | treat as a safety/protocol bug, not a training bug; check the priority tie-break and stale data (stale ⇒ conservative WAIT) |
| `esp_now_init_failed` | another Wi-Fi mode is active; reflash and reboot |
| One board dominates | its `pri` is too high; reset priorities or raise others |

## 9. Mapping to the SIH/guide requirements

| Requirement | Where |
|---|---|
| Local state + goal per robot | `robot_state.h`, `esp8266.ino` |
| Broadcast state + intended move | `broadcastState()` |
| Receive neighbors | `onDataRecv`, `drainRxQueue` |
| Neighbor table + expiry | `neighbor_table.h` |
| Tiny GNN local inference | `tiny_gnn.h`, `tiny_gnn_weights.h` |
| Independent safety filter | `safety_filter.h` |
| Congestion handling | `computeCongestion`, feature 4 |
| Failure + task recovery | `handleFailuresAndTasks`, `task_market.h` |
| Deterministic tie-break | `safety_filter.h` |
| Telemetry for the 2D dashboard | `printTelemetry()` |

See `../ESP8266_ESP_NOW_Tiny_GNN_Warehouse_AMR_Guide.md` for the full design
rationale, training plan, and test metrics.
