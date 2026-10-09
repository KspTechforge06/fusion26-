/*
 * ============================================================================
 * FUSION26 - OLED Dashboard Node  (ESP8266 + SSD1306 128x64)
 * ============================================================================
 * An ESP-NOW OBSERVER for the warehouse AMR fleet. It does NOT drive a robot:
 * it listens to the fleet's broadcast packets, shows live telemetry on an OLED,
 * and falls back to local random / tick readings when no robots are heard.
 *
 * Pages (NEXT button cycles):
 *   0 FLEET    - ESP-NOW robots: id, position, battery, status
 *   1 ROBOT    - one ESP-NOW robot's detail (auto round-robin, or `sel <id>`)
 *   2 READINGS - tick, random walk, raw random, temp, load, A0, counters
 *   3 LINK     - ESP-NOW transmission / loss stats + traffic sparkline
 *   4 EVENTS   - rolling log of button / serial events
 *   5 WEB      - fleet streamed from the warehouse-swarm web dashboard
 *   6 WROB     - detail of one web robot
 *
 * The node reads the warehouse-swarm web dashboard over the same USB serial
 * (WB/WR/WE text frames); that synthetic fleet is shown on pages 5-6.
 *
 * Buttons (active LOW to GND):
 *   NEXT  D5  - change page
 *   TRIG  D6  - trigger a reading/event (random value + log)
 *   FAIL  D7  - simulate a robot failure (demo overlay + beacon)
 *
 * Wiring (NodeMCU -> SSD1306 I2C):
 *   D1/GPIO5 -> SCL      D2/GPIO4 -> SDA      3V3 -> VCC     GND -> GND
 *
 * ---------------------------------------------------------------------------
 * FLASHING (Arduino IDE):
 *   1. Board: "NodeMCU 1.0 (ESP-12E Module)" (or your board)
 *   2. Libraries: "Adafruit SSD1306" + "Adafruit GFX Library"
 *   3. Board must use the SAME ESPNOW_CHANNEL as the fleet (default 1).
 *   4. Open Serial Monitor at 115200 baud.
 * ---------------------------------------------------------------------------
 * Serial commands (newline terminated):
 *   next | page <n> | sel <id> | trig | fail | list | info | reset | help
 * ============================================================================
 */

#include <ESP8266WiFi.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>

extern "C" {
#include <espnow.h>
}

#include "config.h"
#include "robot_packet.h"
#include "dashboard_data.h"
#include "oled_ui.h"

/* ----------------------------- globals ---------------------------------- */

static uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

static Adafruit_SSD1306 display(OLED_W, OLED_H, &Wire, -1);
static bool       gOledOk = false;

static FleetView  gFleet;
static Readings   gReadings;
static LinkTotals gLink;
static WebFeed    gWeb;
static EventLog   gEventLog;

static int  gPage        = PAGE_FLEET;
static int  gSelectedId  = 0;
static uint16_t gWebScroll = 0; /* WEB page robot-list scroll offset */
static uint16_t gBeaconSeq = 0;
static bool gSendBeaconNow = false;

static uint32_t gLastReadMs     = 0;
static uint32_t gLastOledMs     = 0;
static uint32_t gLastTelemMs    = 0;
static uint32_t gLastBeaconMs   = 0;

/* simulated failure (dashboard-side demo) */
static int      gSimFailTarget  = 0;
static uint32_t gSimFailUntil   = 0;

/* ESP-NOW receive queue (filled in callback, drained in loop) */
static const uint8_t RX_QUEUE_SIZE = 8;
static RobotPacket   gRxQueue[RX_QUEUE_SIZE];
static volatile uint8_t gRxHead = 0;
static volatile uint8_t gRxTail = 0;
static volatile uint32_t gRxBadLen = 0;  /* wrong-length frames            */
static volatile uint32_t gRxDropped = 0; /* RX queue overflow              */
static uint32_t gLastRxMs = 0;           /* last accepted packet (LED cue) */

/* buttons */
struct Button {
  uint8_t  pin;
  bool     lastRead;
  bool     stable;
  uint32_t lastChangeMs;
};

static Button gBtnNext = {PIN_BTN_NEXT, false, false, 0};
static Button gBtnTrig = {PIN_BTN_TRIG, false, false, 0};
static Button gBtnFail = {PIN_BTN_FAIL, false, false, 0};

/* ----------------------------- helpers ---------------------------------- */

static inline bool simFailActive(uint32_t now) {
  return gSimFailUntil != 0 && (int32_t)(now - gSimFailUntil) < 0;
}

static void initButton(Button &b) {
  pinMode(b.pin, INPUT_PULLUP);
  b.lastRead = ((digitalRead(b.pin) == LOW));
  b.stable = b.lastRead;
  b.lastChangeMs = millis();
}

/* Returns true on the falling (press) edge, debounced. */
static bool pressed(Button &b, uint32_t now) {
  bool raw = (digitalRead(b.pin) == LOW);
  if (raw != b.lastRead) {
    b.lastRead = raw;
    b.lastChangeMs = now;
  }
  if ((uint32_t)(now - b.lastChangeMs) >= BTN_DEBOUNCE_MS && b.stable != b.lastRead) {
    b.stable = b.lastRead;
    if (b.stable) return true; /* transitioned to pressed */
  }
  return false;
}

/* ----------------------------- radio ------------------------------------ */

static void onDataSent(uint8_t *mac, uint8_t status) {
  (void)mac;
  (void)status;
}

/* Keep minimal: queue only. No Serial / drawing in the callback. */
static void onDataRecv(uint8_t *mac, uint8_t *data, uint8_t len) {
  (void)mac;
  if (len != sizeof(RobotPacket)) {
    ++gRxBadLen;
    return;
  }
  uint8_t next = (uint8_t)((gRxHead + 1) % RX_QUEUE_SIZE);
  if (next == gRxTail) { /* full: drop */
    ++gRxDropped;
    return;
  }
  memcpy(&gRxQueue[gRxHead], data, sizeof(RobotPacket));
  gRxHead = next;
}

static void setupRadio() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  if (esp_now_init() != 0) {
    Serial.println(F("ERR,esp_now_init_failed"));
    return;
  }
  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  if (esp_now_add_peer(BROADCAST_MAC, ESP_NOW_ROLE_COMBO, ESPNOW_CHANNEL,
                       NULL, 0) != 0) {
    Serial.println(F("ERR,esp_now_add_peer_failed"));
  }
}

static void drainRxQueue(uint32_t now) {
  if (gRxBadLen) {
    gLink.badLen += gRxBadLen;
    gRxBadLen = 0;
  }
  if (gRxDropped) {
    gLink.dropped += gRxDropped;
    gRxDropped = 0;
  }
  while (gRxTail != gRxHead) {
    RobotPacket p;
    memcpy(&p, &gRxQueue[gRxTail], sizeof(RobotPacket));
    gRxTail = (uint8_t)((gRxTail + 1) % RX_QUEUE_SIZE);
    switch (gFleet.update(p, now)) {
      case UPDATE_OK:
        gLink.accept();
        gLastRxMs = now;
        break;
      case UPDATE_STALE:
        ++gLink.stale;
        break;
      case UPDATE_BAD_VERSION:
        ++gLink.badVersion;
        break;
      case UPDATE_BAD_ID:
        ++gLink.badId;
        break;
    }
  }
}

/* ------------------------- web link (USB serial) ------------------------ */

/*
 * warehouse-swarm streams its synthetic fleet as text frames over the same USB
 * serial port used for telemetry. Lines beginning WB/WR/WE are that feed; every
 * other line is treated as a console command.
 */
static char     gWebLine[WEB_LINE_LEN];
static uint16_t gWebLineLen = 0;

static void webCommit(uint32_t now) {
  /* Any robot not present in this frame has left the fleet. */
  for (int i = 0; i < WEB_MAX_ROBOTS; ++i) {
    WebRobot &r = gWeb.robots[i];
    if (r.seen && r.frameStamp != gWeb.frameStamp) r.seen = false;
  }
  uint32_t dt = now - gWeb.lastFrameMs;
  if (gWeb.lastFrameMs != 0 && dt > 0) {
    float inst = 1000.0f / (float)dt;
    gWeb.frameHz = gWeb.frameHz * 0.6f + inst * 0.4f;
  }
  gWeb.lastFrameMs = now;
  gWeb.active = true;
  ++gWeb.frames;
  gLastRxMs = now; /* share the RX-activity LED with the web link */

  if (gWeb.frames == 1) {
    gEventLog.add(now, "WEB link");
    if (gPage == PAGE_FLEET) gPage = PAGE_WEB; /* surface the feed */
  }
}

static void webParseLine(const char *line, uint32_t now) {
  if (line[1] == 'B') { /* WB,<summary> */
    ++gWeb.frameStamp;
    unsigned long t, n, done, tot, thr, dl, w, act;
    if (sscanf(line + 3,
               "t=%lu,n=%lu,done=%lu,tot=%lu,thr=%lu,dl=%lu,w=%lu,act=%lu", &t,
               &n, &done, &tot, &thr, &dl, &w, &act) == 8) {
      gWeb.tick = (uint32_t)t;
      gWeb.count = (uint16_t)n;
      gWeb.done = (uint32_t)done;
      gWeb.total = (uint32_t)tot;
      gWeb.throughputX100 = (uint16_t)thr;
      gWeb.deadlocks = (uint16_t)dl;
      gWeb.waitTicks = (uint32_t)w;
      gWeb.activeRobots = (uint16_t)act;
    }
  } else if (line[1] == 'R') { /* WR,<robot> */
    int id, x, y, b, st, task, stage, mv, wt, rp;
    if (sscanf(line + 3, "%d,%d,%d,%d,%d,%d,%d,%d,%d,%d", &id, &x, &y, &b, &st,
               &task, &stage, &mv, &wt, &rp) == 10 &&
        id >= 0 && id < WEB_MAX_ROBOTS) {
      WebRobot &r = gWeb.robots[id];
      r.seen = true;
      r.frameStamp = gWeb.frameStamp;
      r.x = (int16_t)x;
      r.y = (int16_t)y;
      r.battery = (uint8_t)b;
      r.state = (uint8_t)st;
      r.task = (int16_t)task;
      r.stage = (int8_t)stage;
      r.moves = (uint16_t)mv;
      r.waits = (uint16_t)wt;
      r.replans = (uint16_t)rp;
    }
  } else if (line[1] == 'E') { /* WE */
    webCommit(now);
  }
}

/* True when a line is part of the web feed (WB/WR/WE), not a command. */
static inline bool isWebLine(const char *line) {
  return line[0] == 'W' && (line[2] == ',' || line[2] == '\0') &&
         (line[1] == 'B' || line[1] == 'R' || line[1] == 'E');
}

/* Dashboard announces itself / button events on the shared channel. */
static void broadcastBeacon(uint32_t now) {
#if DASH_PERIODIC_BEACON
  bool due = (uint32_t)(now - gLastBeaconMs) >= BEACON_INTERVAL_MS;
#else
  bool due = false;
#endif
  if (!gSendBeaconNow && !due) return;
  gLastBeaconMs = now;
  gSendBeaconNow = false;

  bool fail = simFailActive(now);
  RobotPacket p;
  p.protocolVersion = PROTOCOL_VERSION;
  p.robotId  = DASH_BEACON_ID;
  p.sequence = gBeaconSeq++;
  p.x = gReadings.randWalk;
  p.y = (int16_t)(fail ? gSimFailTarget : gSelectedId);
  p.goalX = (int16_t)gReadings.triggers;
  p.goalY = (int16_t)gReadings.failures;
  p.batteryPercent = gReadings.load;
  p.priority = (uint8_t)(gPage & 0xFF);
  p.status = fail ? ST_FAILED : ST_WORKING;
  p.nextAction = (uint8_t)(gReadings.rnd & 0xFF);
  esp_now_send(BROADCAST_MAC, (uint8_t *)&p, sizeof(p));
}

/* ---------------------------- readings ---------------------------------- */

static void updateReadings(uint32_t now) {
  gReadings.tick = now / 1000;
  gLink.tick(now);
  if ((uint32_t)(now - gLastReadMs) < READING_STEP_MS) return;
  gLastReadMs = now;
  gReadings.step();
#if USE_A0
  gReadings.a0 = analogRead(A0);
#endif
}

/* ---------------------------- actions ----------------------------------- */

static void actNext(uint32_t now) {
  gPage = (gPage + 1) % PAGE_COUNT;
  if (gPage == PAGE_ROBOT) {
    /* Round-robin so each visit shows a different robot when possible. */
    int n = gFleet.freshCount(now);
    if (n > 0) {
      int next = gFleet.nextFresh(gSelectedId, now);
      gSelectedId = (next > 0) ? next : gFleet.firstFresh(now);
    }
  }
  gEventLog.add(now, "PAGE %s", pageName(gPage));
}

static void actTrigger(uint32_t now) {
  ++gReadings.triggers;
  gReadings.step();
  gEventLog.add(now, "TRIG rnd=%d", (int)gReadings.randWalk);
  Serial.printf("EVENT,trigger,rnd=%d,raw=%u,count=%u\n", (int)gReadings.randWalk,
                (unsigned)gReadings.rnd, (unsigned)gReadings.triggers);
  gSendBeaconNow = true;
}

static void actFail(uint32_t now) {
  ++gReadings.failures;
  int target = gSelectedId;
  if (target <= 0 || !gFleet.isFresh(gFleet.robots[target], now)) {
    target = gFleet.firstFresh(now);
  }
  gSimFailTarget = target;
  gSimFailUntil = now + SIM_FAIL_WINDOW_MS;
  if (target > 0) gEventLog.add(now, "FAIL #%d", target);
  else            gEventLog.add(now, "FAIL sim");
  Serial.printf("EVENT,sim_failure,target=%d,until_ms=%lu\n", target,
                (unsigned long)gSimFailUntil);
  gSendBeaconNow = true;
}

/* ---------------------------- buttons ----------------------------------- */

static void handleButtons(uint32_t now) {
  if (pressed(gBtnNext, now)) actNext(now);
  if (pressed(gBtnTrig, now)) actTrigger(now);
  if (pressed(gBtnFail, now)) actFail(now);
}

/* ---------------------------- telemetry --------------------------------- */

static void printTelemetry(uint32_t now) {
  if ((uint32_t)(now - gLastTelemMs) < SERIAL_TELEM_MS) return;
  gLastTelemMs = now;

  Serial.printf(
      "DASH,tick=%lu,fleet=%d,sel=%d,page=%s,rnd=%d,raw=%u,temp=%.1f,"
      "load=%u,a0=%u,trig=%u,fail=%u,heap=%u,simfail=%d,"
      "rx=%lu,rxps=%.1f,ftick=%lu\n",
      (unsigned long)gReadings.tick, gFleet.freshCount(now), gSelectedId,
      pageName(gPage), (int)gReadings.randWalk, (unsigned)gReadings.rnd,
      gReadings.tempC, (unsigned)gReadings.load, (unsigned)gReadings.a0,
      (unsigned)gReadings.triggers, (unsigned)gReadings.failures,
      (unsigned)ESP.getFreeHeap(), simFailActive(now) ? gSimFailTarget : 0,
      (unsigned long)gLink.rx, gLink.rxPerSec, (unsigned long)gLink.fleetTick);

  /* transmission summary, one line per second */
  Serial.printf(
      "LINK,rx=%lu,rxps=%.1f,peak=%u,drop=%lu,stale=%lu,badver=%lu,badid=%lu,"
      "badlen=%lu,ftick=%lu\n",
      (unsigned long)gLink.rx, gLink.rxPerSec, (unsigned)gLink.peakPerSec,
      (unsigned long)gLink.dropped, (unsigned long)gLink.stale,
      (unsigned long)gLink.badVersion, (unsigned long)gLink.badId,
      (unsigned long)gLink.badLen, (unsigned long)gLink.fleetTick);

  /* web link summary, once per second */
  Serial.printf(
      "WEBLINK,active=%d,frames=%lu,hz=%.1f,age=%lu,tick=%lu,robots=%u,sel=%d\n",
      gWeb.active ? 1 : 0, (unsigned long)gWeb.frames, gWeb.frameHz,
      gWeb.active ? (unsigned long)((now - gWeb.lastFrameMs) / 1000) : 0UL,
      (unsigned long)gWeb.tick, (unsigned)gWeb.seenCount(), gSelectedId);
}

static void printInfo() {
  Serial.printf("INFO,node=dashboard,proto=%u,channel=%u,oled=%s\n",
                PROTOCOL_VERSION, ESPNOW_CHANNEL, gOledOk ? "ok" : "FAIL");
  Serial.print(F("INFO,mac="));
  Serial.println(WiFi.macAddress());
  Serial.printf("INFO,pins,sda=%u,scl=%u,next=%u,trig=%u,fail=%u\n",
                PIN_SDA, PIN_SCL, PIN_BTN_NEXT, PIN_BTN_TRIG, PIN_BTN_FAIL);
}

static void printLink() {
  Serial.printf(
      "LINKTOTAL,rx=%lu,rxps=%.1f,peak=%u,drop=%lu,stale=%lu,badver=%lu,"
      "badid=%lu,badlen=%lu,ftick=%lu\n",
      (unsigned long)gLink.rx, gLink.rxPerSec, (unsigned)gLink.peakPerSec,
      (unsigned long)gLink.dropped, (unsigned long)gLink.stale,
      (unsigned long)gLink.badVersion, (unsigned long)gLink.badId,
      (unsigned long)gLink.badLen, (unsigned long)gLink.fleetTick);
  uint32_t now = millis();
  for (int id = 1; id < FleetView::SIZE; ++id) {
    RobotView &r = gFleet.robots[id];
    if (!r.seen) continue;
    Serial.printf("LINK,%u,pkts=%lu,hz=%.1f,gaps=%lu,age=%lu,fresh=%d\n",
                  (unsigned)id, (unsigned long)r.packets, r.hz,
                  (unsigned long)r.gaps,
                  (unsigned long)((now - r.lastSeenMs) / 1000),
                  gFleet.isFresh(r, now) ? 1 : 0);
  }
}

static void printWeb() {
  uint32_t now = millis();
  Serial.printf(
      "WEB,active=%d,frames=%lu,hz=%.1f,age=%lu,tick=%lu,count=%u,act=%u,"
      "done=%lu,total=%lu,thr=%u,dl=%u,wait=%lu\n",
      gWeb.active ? 1 : 0, (unsigned long)gWeb.frames, gWeb.frameHz,
      gWeb.active ? (unsigned long)((now - gWeb.lastFrameMs) / 1000) : 0UL,
      (unsigned long)gWeb.tick, (unsigned)gWeb.count,
      (unsigned)gWeb.activeRobots, (unsigned long)gWeb.done,
      (unsigned long)gWeb.total, (unsigned)gWeb.throughputX100,
      (unsigned)gWeb.deadlocks, (unsigned long)gWeb.waitTicks);
  for (int i = 0; i < WEB_MAX_ROBOTS; ++i) {
    WebRobot &r = gWeb.robots[i];
    if (!r.seen) continue;
    Serial.printf("WROBOT,%d,%d,%d,%u,%u,%d,%d,%u,%u,%u\n", i, (int)r.x, (int)r.y,
                  (unsigned)r.battery, (unsigned)r.state, (int)r.task,
                  (int)r.stage, (unsigned)r.moves, (unsigned)r.waits,
                  (unsigned)r.replans);
  }
}

static void printHelp() {
  Serial.println(F(
      "CMDS: next | page <n> | sel <id> | trig | fail | list | link | web | info | reset | help"));
}

static void printList(uint32_t now) {
  int n = gFleet.freshCount(now);
  Serial.printf("LIST,fresh=%d\n", n);
  for (int id = 1; id < FleetView::SIZE; ++id) {
    RobotView &r = gFleet.robots[id];
    if (!gFleet.isFresh(r, now)) continue;
    Serial.printf(
        "ROBOT,%u,%d,%d,%d,%d,%u,%u,%u,%u,%lu,pkts=%lu,hz=%.1f,gaps=%lu\n",
        (unsigned)id, (int)r.x, (int)r.y, (int)r.goalX, (int)r.goalY,
        (unsigned)r.batteryPercent, (unsigned)r.priority, (unsigned)r.status,
        (unsigned)r.nextAction, (unsigned long)(now - r.lastSeenMs),
        (unsigned long)r.packets, r.hz, (unsigned long)r.gaps);
  }
}

static void handleCommand(const char *rawLine, uint32_t now) {
  String line(rawLine);
  line.trim();
  if (line.length() == 0) return;

  if (line == "next") {
    actNext(now);
  } else if (line.startsWith("page")) {
    int p = -1;
    if (sscanf(line.c_str(), "page %d", &p) == 1 && p >= 0 && p < PAGE_COUNT) {
      gPage = p;
      Serial.printf("EVENT,page=%s\n", pageName(gPage));
    } else {
      Serial.println(F("ERR,bad_page"));
    }
  } else if (line.startsWith("sel")) {
    int id = -1;
    if (sscanf(line.c_str(), "sel %d", &id) == 1 && id >= 0 &&
        id < WEB_MAX_ROBOTS) {
      gSelectedId = id;
      Serial.printf("EVENT,sel=%d\n", id);
    } else {
      Serial.println(F("ERR,bad_id"));
    }
  } else if (line == "trig" || line == "t") {
    actTrigger(now);
  } else if (line == "fail" || line == "f") {
    actFail(now);
  } else if (line == "list") {
    printList(now);
  } else if (line == "link") {
    printLink();
  } else if (line == "web") {
    printWeb();
  } else if (line == "info") {
    printInfo();
  } else if (line == "reset") {
    gReadings.triggers = 0;
    gReadings.failures = 0;
    gSimFailUntil = 0;
    gSimFailTarget = 0;
    gEventLog = EventLog();
    gLink = LinkTotals();
    gWeb.reset();
    gWebScroll = 0;
    gRxBadLen = 0;
    gRxDropped = 0;
    Serial.println(F("EVENT,reset"));
  } else if (line == "help") {
    printHelp();
  } else {
    Serial.println(F("ERR,unknown_command"));
  }
}

/*
 * Read whatever is waiting on USB serial and route each complete line: web feed
 * lines go to the parser, everything else to the command handler. A per-call
 * budget keeps drawing/telemetry responsive under a busy feed.
 */
static void pollSerial(uint32_t now) {
  int budget = 48;
  while (Serial.available() && budget-- > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (gWebLineLen > 0) {
        gWebLine[gWebLineLen] = '\0';
        if (isWebLine(gWebLine))
          webParseLine(gWebLine, now);
        else
          handleCommand(gWebLine, now);
      }
      gWebLineLen = 0;
    } else if (gWebLineLen < WEB_LINE_LEN - 1) {
      gWebLine[gWebLineLen++] = c;
    } else {
      gWebLineLen = 0; /* overflow: drop the over-long line */
    }
  }
}

/* ------------------------------- OLED ----------------------------------- */

static void refreshOled(uint32_t now) {
  if (!gOledOk) return;
  if ((uint32_t)(now - gLastOledMs) < OLED_REFRESH_MS) return;
  gLastOledMs = now;

  /* ESP-NOW pages auto-pick a robot; the web pages keep the chosen id (web ids
   * are 0-based, so 0 is a valid robot there). */
  if (gPage != PAGE_WEB && gPage != PAGE_WROB && gSelectedId == 0)
    gSelectedId = gFleet.firstFresh(now);
  if (gPage == PAGE_WEB) gWebScroll = (uint16_t)(gWebScroll + 3);

  renderDashboard(display, gPage, gFleet, gReadings, gLink, gWeb, gEventLog, now,
                  gSelectedId, gSimFailTarget, simFailActive(now), gWebScroll);
}

/* -------------------------------- setup --------------------------------- */

static void showSplash() {
  if (!gOledOk) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(14, 12);
  display.print(F("FUSION26"));
  display.setCursor(14, 24);
  display.print(F("OLED DASHBOARD"));
  display.setCursor(10, 40);
  display.printf("ch %u  proto %u", ESPNOW_CHANNEL, PROTOCOL_VERSION);
  display.display();
}

void setup() {
  Serial.setRxBufferSize(1024); /* a web frame can be ~1.5 KB at 115200 */
  Serial.begin(115200);
  delay(200);

  pinMode(LED_BUILTIN, OUTPUT);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  gOledOk = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (gOledOk) {
    display.setRotation(0);
    display.setTextWrap(false);
    display.clearDisplay();
    display.display();
  } else {
    Serial.println(F("ERR,oled_begin_failed (check I2C wiring/addr)"));
  }

  initButton(gBtnNext);
  initButton(gBtnTrig);
  initButton(gBtnFail);

  randomSeed(micros() ^ (uint32_t)analogRead(A0) ^ (millis() << 1));
  gReadings.tempC = 22.0f + (random(0, 400) / 100.0f);
  gReadings.randWalk = (int16_t)random(RAND_WALK_MIN, RAND_WALK_MAX + 1);
  gReadings.load = (uint8_t)random(10, 60);

  showSplash();

  Serial.printf("\nBOOT,FUSION26-DASHBOARD,proto=%u,ch=%u\n", PROTOCOL_VERSION,
                ESPNOW_CHANNEL);
  setupRadio();
  Serial.print(F("MAC,"));
  Serial.println(WiFi.macAddress());
  Serial.printf("CFG,oled=%dx%d@0x%02X,sda=%u,scl=%u,stale=%dms\n", OLED_W,
                OLED_H, OLED_ADDR, PIN_SDA, PIN_SCL, ROBOT_STALE_MS);

  gEventLog.add(millis(), "BOOT");
  printHelp();
  delay(1200);
}

/* -------------------------------- loop ---------------------------------- */

void loop() {
  uint32_t now = millis();

  handleButtons(now);
  pollSerial(now);
  drainRxQueue(now);
  updateReadings(now);

  if (gSimFailUntil && !simFailActive(now)) {
    gEventLog.add(now, "FAIL end");
    gSimFailUntil = 0;
    gSimFailTarget = 0;
    gSendBeaconNow = true;
  }

  broadcastBeacon(now);
  refreshOled(now);
  printTelemetry(now);

  /* RX activity indicator: brief pulse on the on-board LED per packet. */
  digitalWrite(LED_BUILTIN,
               ((uint32_t)(now - gLastRxMs) < LED_PULSE_MS) ? LOW : HIGH);

  delay(LOOP_TICK_MS);
}
