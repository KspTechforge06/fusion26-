# FUSION26 — ESP8266 Fleet Setup Guide

Step-by-step instructions to go from bare boards to a running decentralized AMR
fleet. Follow it in order. Total time for 3 boards: ~30–45 minutes (plus board
package download).

- Firmware lives in **this folder** (`fusion26/esp8266/`).
- The main sketch is **`esp8266.ino`**.
- The folder name must stay `esp8266` so the Arduino IDE opens the sketch.
- Design rationale is in `../ESP8266_ESP_NOW_Tiny_GNN_Warehouse_AMR_Guide.md`.
- Command/demo reference is in `README.md`.

---

## 0. What you need

**Hardware**
- 2–3+ ESP8266 boards (NodeMCU v2 / v3, Wemos D1 mini, or ESP-12E class). Start
  with 2; add more once packet exchange works.
- USB data cables (charge-only cables will not upload).
- Laptop.
- Optional: 5 V USB power supply per board so they can run untethered.

**Software (laptop)** — pick ONE toolchain:
- **Arduino IDE 2.x** (easiest), or
- **arduino-cli** (scriptable), or
- **PlatformIO** (VS Code / CLI) — a `platformio.ini` is already included.

You do **not** need Python for the firmware. Python/PyTorch are only needed if
you later replace the bootstrap GNN weights with a trained model.

**Important**
- Every board must be flashed with the **same firmware** and the **same radio
  channel**, but a **different `ROBOT_ID`**.
- Do not power motors from a GPIO. The software demo needs no wiring at all.
- ESP-NOW works board-to-board; you do not need Wi-Fi, a router, or internet.

---

## 1. Install the ESP8266 board support

### Option A — Arduino IDE (recommended)

1. Download and install Arduino IDE 2.x: <https://www.arduino.cc/en/software>
2. Open **File → Preferences**.
3. In **Additional boards manager URLs**, paste:
   `https://arduino.esp8266.com/stable/package_esp8266com_index.json`
   (separate multiple URLs with commas if you already have others).
4. Open **Tools → Board → Boards Manager**, search **esp8266**, and install
   **esp8266 by ESP8266 Community** (latest version).
5. (Linux only) add yourself to the `dialout` group so you can access the port,
   then re-login:
   ```bash
   sudo usermod -aG dialout "$USER"
   ```
   If your board uses a **CH340** USB chip and no port appears, install
   `ch341`/`cp210x` drivers (Linux usually has them; Windows needs the vendor
   driver).

### Option B — arduino-cli

```bash
# install (Linux/macOS)
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh

arduino-cli config init
arduino-cli config add board_manager.additional_urls \
  https://arduino.esp8266.com/stable/package_esp8266com_index.json
arduino-cli core update-index
arduino-cli core install esp8266:esp8266
```

### Option C — PlatformIO

```bash
pip install platformio          # or use the VS Code PlatformIO extension
```

The provided `platformio.ini` already targets `nodemcuv2` with
`src_dir = .` so it compiles `esp8266.ino` and the headers in place.

---

## 2. Get the files

The firmware is already in this directory. Confirm you can see:

```bash
ls /home/ksp/fusion26/esp8266
# config.h  esp8266.ino  grid.h  neighbor_table.h  platformio.ini
# robot_packet.h  robot_state.h  safety_filter.h  task_market.h
# tiny_gnn.h  tiny_gnn_weights.h  README.md  tools/
```

Nothing needs to be copied or moved. If you clone this elsewhere, keep the
folder named `esp8266`.

---

## 3. Set a unique ROBOT_ID on every board

Open `config.h` and edit the fallback value:

```c
/* Identity (CHANGE PER BOARD) */
#ifndef ROBOT_ID
#define ROBOT_ID 1
#endif
```

Workflow:

| Board | `ROBOT_ID` to set | Then |
|---|---|---|
| 1st | `1` | upload |
| 2nd | `2` | upload |
| 3rd | `3` | upload |
| … | … | … |

Rules:
- IDs must be **unique** and in `1 … MAX_ROBOT_ID` (`16` by default).
- Never set `ROBOT_ID` equal to another live board, or the two will ignore each
  other (self-originated packet filter).
- Keep `ESPNOW_CHANNEL` identical on every board (default `1`).
- If you use PlatformIO / arduino-cli you can skip editing the file and pass
  `-DROBOT_ID=n` at build time instead (see sections 4B/4C).

---

## 4. Build and upload

### 4A — Arduino IDE

1. Connect one board by USB.
2. **Tools → Board → ESP8266 Boards → NodeMCU 1.0 (ESP-12E Module)**
   (or your exact board).
3. **Tools → Port →** select the board's port
   (e.g. `/dev/ttyUSB0`, `/dev/ttyACM0`, `COM5`).
4. Set **Tools → Upload Speed → 115200** if the default upload fails.
5. Open `esp8266.ino` (File → Open, or double-click it).
6. Set `ROBOT_ID = 1` in `config.h` (section 3).
7. Click **Upload** (→ arrow). Wait for `Done uploading`.
8. If it fails, hold the **FLASH/BOOT** button while the upload starts, release
   after `Connecting…`.

Repeat for each board, changing `ROBOT_ID` each time.

### 4B — arduino-cli

```bash
cd /home/ksp/fusion26/esp8266

# find the port
arduino-cli board list

# compile just to check
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 -e .

# upload board #1
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 \
  --build-property "compiler.cpp.extra_flags=-DROBOT_ID=1" -u \
  -p /dev/ttyUSB0 .

# board #2: change to -DROBOT_ID=2 and the port
```

> `-e` builds to a temp dir; `-u` uploads. If your board is a Wemos D1 mini use
> `esp8266:esp8266:d1_mini`.

### 4C — PlatformIO

The `[env:amr1]` build sets `-DROBOT_ID=1`. For each extra board, copy the
commented `[env:amr2]` block (already in `platformio.ini`) and change the id.

```bash
cd /home/ksp/fusion26/esp8266

pio run -e amr1                 # compile
pio run -e amr1 -t upload       # upload board 1
pio device monitor -b 115200    # serial monitor
```

Because `src_dir = .`, PlatformIO compiles `esp8266.ino` in place. If your
PlatformIO version objects to the `-e`/temp layout, use one env at a time and
pass `-DROBOT_ID=n` via `build_flags`.

---

## 5. Verify the first board (before adding others)

Open the serial monitor at **115200 baud**, newline line ending.
- Arduino IDE: **Tools → Serial Monitor**, set 115200.
- CLI: `arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200` or
  `pio device monitor -b 115200`.

You should see at boot:

```
BOOT,FUSION26,id=1,proto=1
MAC,AA:BB:CC:DD:EE:FF
CFG,id=1,channel=1,grid=24x24,neighborTimeout=1500,failureTimeout=5000
CMDS: f | goal <x> <y> | pri <n> | info | reset | help
```

and then a `TELEM` line roughly every 500 ms:

```
TELEM,1,5,5,18,13,100,1,0,3,0,0,0,0,0,0,37
```

Format:

```
TELEM,id,x,y,goalX,goalY,battery,priority,status,action,neighbors,
      moves,waits,conflicts,adoptions,deliveries,inferUs
```

With one board only, `neighbors` is `0` — that's expected. The robot should still
move toward its goal (`moves` increasing).

If you see nothing, check the baud rate, the correct port, and that the board's
LED blinks at boot. Type `info` and press Enter to confirm input works.

---

## 6. Flash and power the whole fleet

1. Upload to each remaining board, giving each a unique `ROBOT_ID`
   (repeat section 4, editing `config.h` or passing `-DROBOT_ID=n`).
2. Power all boards from the **same** source/setup and keep them close
   (ESP-NOW range is fine at a few metres indoors; walls reduce it).
3. Watch any board's serial monitor. Within ~1–2 s, `neighbors` should become
   non-zero, and you will see IDs from the other boards reflected in behavior.

Quick proof the mesh works:
- Type `info` on both boards; each shows the other's presence via `neighbors ≥ 1`.
- Unplug one board: the others keep running, then after `FAILURE_TIMEOUT_MS`
  (~5 s) print `EVENT,peer_failed` / `EVENT,task_adopted`.

---

## 7. Run the demo scenarios

All commands are typed into a board's serial monitor, newline-terminated.

**Scenario 1 — normal delivery.** Just power up. Robots pick goals, move, print
`EVENT,delivery,...`, and pick new goals. `deliveries` climbs.

**Scenario 2 — congestion.** Place 3+ boards near one another / funnel their
goals through the same aisle. Watch `conflicts` and `waits` rise while `moves`
continues (robots detour rather than deadlock). Feature 4 (congestion) rises, so
the local GNN raises the WAIT score.

**Scenario 3 — equipment failure + task recovery.**
1. On one board type `f` → it goes silent and freezes for ~8 s and prints
   `EVENT,simulated_failure,...`.
2. On a peer, after ~5 s you should see `EVENT,peer_failed,...` then
   `EVENT,task_adopted,from=<id>,goal=X:Y`.
3. The frozen board resumes (`EVENT,resume`) and the fleet continues. The failed
   robot's last cell stays an obstacle while it's silent.

**Scenario 4 — priority change.** On one robot type `pri 9`. At a contested cell
it wins the `(priority, lower id)` tie-break; the other robot yields (its status
becomes blocked/waiting). Set `pri 1` to restore.

Other commands: `goal 20 3` sets a goal; `reset` zeroes counters; `help` lists
commands.

---

## 8. Optional — capture telemetry on the laptop

TELEM lines are plain CSV-ish text; pipe a serial port into a file for charts:

```bash
# Linux; adjust device
stty -F /dev/ttyUSB0 115200 raw -echo
cat /dev/ttyUSB0 | tee /tmp/fusion26_telem.log
```

Then filter just the data:

```bash
grep '^TELEM' /tmp/fusion26_telem.log > /tmp/fusion26_telem.csv
```

Use this feed for the 2D grid dashboard described in the project `guide.md`.
Python (`pyserial`) or the Arduino plotter both work.

---

## 9. Optional — deploy a trained GNN instead of the bootstrap weights

The shipped `tiny_gnn_weights.h` is a hand-built **GNN-inspired bootstrap** so
the fleet moves out of the box. To use a genuinely trained model:

```bash
cd /home/ksp/fusion26/esp8266/tools
python3 -m venv .venv && source .venv/bin/activate
pip install torch numpy

# imitation-train from a conventional teacher, then export
python3 train_gnn.py --samples 40000 --epochs 40
# -> writes tiny_gnn.pt and overwrites ../tiny_gnn_weights.h
```

Re-export an existing checkpoint without retraining:

```bash
python3 export_weights.py tiny_gnn.pt ../tiny_gnn_weights.h
```

Then rebuild and re-flash every board (all boards must share identical weights).
**Verify parity first**: run 20–100 fixed inputs through the Python model and
through a board, and compare all five scores within a small tolerance before
trusting it. Only call it a *trained deployed GNN* once parity passes.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `esp_now_init_failed` at boot | active Wi-Fi mode / stale state | reflash, press reset; ensure `WiFi.disconnect()` runs (it does) |
| Port not listed | cable/driver/permissions | use a data cable; install CH340/CP210x; add user to `dialout` |
| Upload stuck at `Connecting…` | board needs bootloader trigger | hold FLASH/BOOT during connect (some boards need it) |
| `neighbors` stays 0 | different channel / proto / packet / ID clash | same `ESPNOW_CHANNEL` and `PROTOCOL_VERSION` on all; unique IDs; all flashed |
| Only some boards see each other | range / obstruction / too many APs | move closer; keep every board on one channel and off Wi-Fi APs |
| Scores never change | zero weights / stale records | reflash the bootstrap header; run `info` and watch neighbors change |
| Robots freeze in a corner | conservative safety (stale ⇒ WAIT) | confirm packets arrive; this is the safe fallback, not a crash |
| Collision despite filters | view inconsistency under packet loss | treat as a protocol bug; raise broadcast rate; keep peers fresh |
| Two boards ignore each other | duplicate `ROBOT_ID` | give each a unique ID and reflash |
| `f` doesn't trigger recovery on peers | timeout not reached / no healthy peer close | wait >5 s; ensure at least one other board is in range |

---

## 11. Reflash / factory reset

- There is no stored config; reflashing the sketch resets everything.
- To return a board to defaults: set `ROBOT_ID` as desired, re-upload, press the
  board's **RST** button, and open the serial monitor.
- To wipe flash entirely (rarely needed): erase the flash with
  `esptool.py erase_flash` (install via `pip install esptool`) using the board's
  serial port, then re-upload.

---

## 12. Setup checklist

- [ ] ESP8266 core installed (IDE/cli/PlatformIO).
- [ ] Port visible and upload succeeds on one board.
- [ ] Each board has a unique `ROBOT_ID`; all share `ESPNOW_CHANNEL`.
- [ ] Serial shows `BOOT` + `CFG` + repeating `TELEM` lines.
- [ ] With 2+ boards powered, `neighbors > 0`.
- [ ] `f` produces `EVENT,peer_failed` + `EVENT,task_adopted` on a peer.
- [ ] `pri 9` visibly changes yielding behavior at a contested cell.
- [ ] Unplugging a board does not stop the rest.

When all boxes are ticked, the fleet is running and matches the guide's
definition of done for the embedded part.
