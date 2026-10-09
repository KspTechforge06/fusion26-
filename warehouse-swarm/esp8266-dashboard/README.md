# FUSION26 — OLED Dashboard Node (ESP8266)

An **ESP-NOW observer** for the warehouse AMR fleet. This board is **not a
robot** — it listens to the fleet's broadcast packets, shows live telemetry and
**transmission/link statistics** on a 128×64 SSD1306 OLED, and falls back to
local random/tick readings when no robots are heard. It never sends movement
commands and never uses a fleet robot id.

It also ingests the **warehouse-swarm web dashboard** over USB serial, so one
board can display the simulation's whole fleet (pages WEB / WROB) and a real
ESP-NOW fleet at the same time.

Part of the FUSION26 project. The fleet firmware lives
in [`../../esp8266/`](../../esp8266) — the dashboard reuses its 16-byte wire packet.

---

## Files

| File | Purpose |
|---|---|
| `esp8266-dashboard.ino` | Main firmware: setup, loop, ESP-NOW, buttons, serial |
| `config.h` | Protocol/channel (must match the fleet), pins, timings |
| `robot_packet.h` | **Copy** of the fleet wire packet — keep in sync |
| `dashboard_data.h` | `FleetView`, `LinkTotals`, `WebFeed`, `Readings`, `EventLog` data model |
| `oled_ui.h` | The seven OLED pages |
| `platformio.ini` | Optional PlatformIO build (Arduino IDE is primary) |

> Arduino IDE requirement: the folder name must equal the `.ino` name. The
> folder is `esp8266-dashboard` and the sketch is `esp8266-dashboard.ino`.

---

## Hardware

- ESP8266 **NodeMCU / ESP-12E** (one board)
- **SSD1306 128×64 I2C OLED** (address `0x3C`, some modules `0x3D`)
- **3 push buttons** (momentary, active LOW)
- USB cable + laptop

### Wiring

**OLED (I2C):**

| OLED | NodeMCU | Note |
|---|---|---|
| VCC | 3V3 | 3.3 V only |
| GND | GND | |
| SCL | **D1** (GPIO5) | I2C clock |
| SDA | **D2** (GPIO4) | I2C data |

**Buttons** (each button between the pin and **GND**; internal pull-up is used):

| Button | NodeMCU | Function |
|---|---|---|
| NEXT | **D5** (GPIO14) | change OLED page |
| TRIG | **D6** (GPIO12) | trigger a reading/event |
| FAIL | **D7** (GPIO13) | simulate a robot failure |

Avoid D3/D4/D8 for buttons — they are boot-strapping pins on the ESP8266.

---

## Build & upload

### Arduino IDE

1. Install the ESP8266 board package (same as the fleet).
2. Install libraries via **Tools → Manage Libraries**:
   - **Adafruit SSD1306**
   - **Adafruit GFX Library**
   (Wire is built in.)
3. Select board **NodeMCU 1.0 (ESP-12E Module)**.
4. Open `esp8266-dashboard/esp8266-dashboard.ino` and upload.
5. Open **Serial Monitor** at **115200** baud.

### arduino-cli

```bash
export PATH="$HOME/.local/bin:$PATH"
arduino-cli lib install "Adafruit SSD1306"
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 \
  /path/to/esp8266-dashboard
arduino-cli upload -p /dev/ttyUSB0 --fqbn esp8266:esp8266:nodemcuv2 \
  /path/to/esp8266-dashboard
```

### Important: same channel as the fleet

`ESPNOW_CHANNEL` in `config.h` **must match** the fleet firmware (default `1`).
Same for `PROTOCOL_VERSION`. If they differ, no packets are accepted.

---

## OLED pages

| # | Page | Shows |
|---|---|---|
| 0 | **FLEET** | Count + one line per live robot: `#id x,y Bxx STATUS` |
| 1 | **ROBOT** | One robot's detail: pos, goal, battery, priority, status, action, packet count + rate |
| 2 | **READINGS** | Tick seconds, random walk + raw random, temp, load, A0, trigger/fail counts, RX total + rate |
| 3 | **LINK** | Transmission: total RX, shared fleet tick, drops/stale/bad, per-second traffic sparkline, selected robot's rate/gaps/age |
| 4 | **EVENTS** | Rolling log of the last 6 button/serial events with timestamps |
| 5 | **WEB** | Web-dashboard fleet: count / active / tick, orders done, deadlocks + wait, scrolling robot list (`R0 …`) with state/pos/battery. Header = feed rate (`4/s`) or `DOWN`. |
| 6 | **WROB** | One web robot: pos, battery, state, task + stage, moves/waits, replans, feed age |

Press **NEXT** to cycle. When no robots are heard, page 0 shows a hint and the
readings page works standalone ("demo dashboard").

---

## Buttons

- **NEXT** — advance to the next page. Entering the ROBOT page auto-selects a
  robot (round-robin through the live ones).
- **TRIG** — generate a new random reading, increment the trigger counter, log
  `TRIG rnd=..`, and send an event beacon.
- **FAIL** — simulate a failure of the currently selected robot for
  `SIM_FAIL_WINDOW_MS` (5 s): the fleet/robot pages show it as `FAIL`, an
  `EVENT,sim_failure` line is printed, and a `ST_FAILED` beacon is broadcast.

> Failure in the real fleet is *silence*. To make the actual robots react
> (stop hearing a peer and adopt its task), press `f` on that robot's serial
> monitor. The dashboard `FAIL` button is a **display/demo** simulation.

---

## Transmission / link statistics

The LINK page (and the once-per-second `LINK,...` serial line) reports what is
actually crossing the air, so you can watch the fleet "talking" in real time:

- **RX** — total accepted packets; **fleet tick** — the same counter used as a
  shared clock, so every dashboard that hears the same fleet shows the *same*
  tick. This is what keeps the nodes in sync.
- **rx/s** — smoothed packets-per-second; **PEAK** — busiest second seen.
- **DROP** — RX queue overflow; **STALE** — duplicate/old sequence numbers;
  **BAD** — wrong length, wrong protocol version, or out-of-range id.
- **Sparkline** — the last `LINK_HISTORY` (32) seconds of traffic.
- **Per robot** — packets received, `hz`, sequence **gaps** (lost packets), age.
- **LED** — the on-board LED pulses on every accepted packet (a physical
  transmission indicator).

Sequence gaps come from the fleet's per-robot `sequence` counter, so packet loss
is visible without any extra messages.

---

## Web link (warehouse-swarm → node, USB serial)

The web dashboard in [`..`](../../warehouse-swarm) streams its simulation to this
board over the same USB serial at 115200 baud via the browser's **Web Serial
API** — no extra software. One frame every 250 ms:

```text
WB,t=1234,n=14,done=5,tot=30,thr=80,dl=2,w=120,act=12
WR,0,2,7,87,1,5,0,120,4,3
...
WE
```

- **WB** — run summary: tick, robot count, orders done/total, throughput ×100,
  deadlocks, wait ticks, active robots.
- **WR** — one robot: id (0-based, matching the sim), x, y, battery %, state,
  task id (`−1` = none), stage code, moves, waits, replans.
- **WE** — commits the frame; robots missing from it drop out.

On the first committed frame the node jumps to the **WEB** page and pulses the
on-board LED on every frame (same RX-activity cue as ESP-NOW packets). The feed
rate is in the WEB header; `DOWN` means `WEB_STALE_MS` (1.5 s) passed since the
last frame. The `reset` command clears the feed.

**To connect:** start `warehouse-swarm` (`npm run dev`, Chrome/Edge on
`localhost`), click **Connect ESP**, pick the NodeMCU's USB-serial port. Web
Serial needs a secure context — `localhost` or HTTPS.

---

## Serial commands (115200, newline)

| Command | Effect |
|---|---|
| `next` | next page |
| `page <n>` | jump to page 0–6 |
| `sel <id>` | select robot id for the ROBOT / WROB pages (web ids are 0-based) |
| `trig` / `t` | trigger a reading |
| `fail` / `f` | simulate a failure |
| `list` | list live robots (`LIST`, `ROBOT,...`, with `pkts/hz/gaps`) |
| `link` | dump transmission stats (`LINKTOTAL,...` + per-robot `LINK,...`) |
| `web` | dump the web feed (`WEB,...` + per-robot `WROBOT,...`) |
| `info` | config, MAC, pins, OLED status |
| `reset` | clear counters/sim-failure and the event log |
| `help` | list commands |

The board also prints `DASH,...`, `LINK,...`, and `WEBLINK,...` once per second.

```text
DASH,tick=42,fleet=3,sel=2,page=LINK,...,rx=1234,rxps=15.0,ftick=1234
LINK,rx=1234,rxps=15.0,peak=22,drop=0,stale=3,badver=0,badid=0,badlen=0,ftick=1234
WEBLINK,active=1,frames=480,hz=4.0,age=0,tick=1234,robots=14,sel=0
```

---

## How it fits the fleet protocol

- Receives the fleet's 16-byte `RobotPacket` broadcast on the shared channel.
  Validation matches the fleet neighbour table: version must match, `robotId`
  in `1..MAX_ROBOT_ID`, newer sequence wins.
- A robot not heard for `ROBOT_STALE_MS` (3 s) is hidden from the fleet page.
- The dashboard announces itself under **`DASH_BEACON_ID = 200`**. The fleet
  rejects any id `> MAX_ROBOT_ID`, so this can never be mistaken for a robot.
  Set `DASH_PERIODIC_BEACON 0` in `config.h` to make the node receive-only.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| OLED stays blank | I2C wiring (SDA=D2, SCL=D1), 3V3 power; try address `0x3D` in `config.h`; run `info` — it prints `oled=ok/FAIL` |
| Garbled/torn display | lower `Wire.setClock` to `100000`; check for a short |
| `fleet=0` while robots run | `ESPNOW_CHANNEL` mismatch, `PROTOCOL_VERSION` mismatch, or robots not on the same channel/ap disconnected |
| Buttons do nothing | wired to GND? pins D5/D6/D7? active-LOW with internal pull-up |
| Values frozen | normal when no robots — page 2/3 still tick; press TRIG |
| ESP-NOW init failed | another Wi-Fi mode active; power-cycle |
| WEB page: No web link / `DOWN` | `npm run dev`, click **Connect ESP**, pick the port; `DOWN` after 1.5 s of silence = browser or feed stopped |

---

## Mapping to the project

| Feature | Where |
|---|---|
| Live fleet telemetry display | `FleetView` + `drawPageFleet` |
| Per-robot detail | `drawPageRobot` |
| Random / tick readings | `Readings` + `drawPageReadings` |
| Push-button triggers | `handleButtons`, `actTrigger` |
| Failure simulation | `actFail`, `simFailActive` |
| Event log | `EventLog` + `drawPageEvents` |
| Transmission / link stats | `LinkTotals` + `drawPageLink`, RX LED pulse |
| Shared fleet clock (sync) | `LinkTotals::fleetTick` = accepted packets |
| Web feed ingest | `WebFeed` + `pollSerial` / `webParseLine` in the `.ino` |
| Web fleet display | `drawPageWeb` + `drawPageWebRobot` |
| Decentralized observer (no controller) | receive-only from the shared ESP-NOW channel |
