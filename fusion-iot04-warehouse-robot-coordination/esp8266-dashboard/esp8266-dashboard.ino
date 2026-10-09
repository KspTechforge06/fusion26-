/*
 * ============================================================================
 * FUSION26 - OLED Dashboard Node  (ESP8266 + SSD1306 128x64)
 * ============================================================================
 * An ESP-NOW OBSERVER for the warehouse AMR fleet. It does NOT drive a robot:
 * it listens to the fleet's broadcast packets, shows live telemetry on an OLED,
 * and falls back to local random / tick readings when no robots are heard.
 *
 * Pages (NEXT button cycles):
 *   0 FLEET    - live robots: id, position, battery, status
 *   1 ROBOT    - one robot's detail (auto round-robin, or `sel <id>`)
 *   2 READINGS - tick, random walk, raw random, temp, load, A0, counters
 *   3 EVENTS   - rolling log of button / serial events
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

static FleetView gFleet;
static Readings  gReadings;
static EventLog  gEventLog;

static int  gPage        = PAGE_FLEET;
static int  gSelectedId  = 0;
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
  if (len != sizeof(RobotPacket)) return;
  uint8_t next = (uint8_t)((gRxHead + 1) % RX_QUEUE_SIZE);
  if (next == gRxTail) return; /* full: drop */
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
  while (gRxTail != gRxHead) {
    RobotPacket p;
    memcpy(&p, &gRxQueue[gRxTail], sizeof(RobotPacket));
    gRxTail = (uint8_t)((gRxTail + 1) % RX_QUEUE_SIZE);
    gFleet.update(p, now);
  }
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
      "load=%u,a0=%u,trig=%u,fail=%u,heap=%u,simfail=%d\n",
      (unsigned long)gReadings.tick, gFleet.freshCount(now), gSelectedId,
      pageName(gPage), (int)gReadings.randWalk, (unsigned)gReadings.rnd,
      gReadings.tempC, (unsigned)gReadings.load, (unsigned)gReadings.a0,
      (unsigned)gReadings.triggers, (unsigned)gReadings.failures,
      (unsigned)ESP.getFreeHeap(), simFailActive(now) ? gSimFailTarget : 0);
}

static void printInfo() {
  Serial.printf("INFO,node=dashboard,proto=%u,channel=%u,oled=%s\n",
                PROTOCOL_VERSION, ESPNOW_CHANNEL, gOledOk ? "ok" : "FAIL");
  Serial.print(F("INFO,mac="));
  Serial.println(WiFi.macAddress());
  Serial.printf("INFO,pins,sda=%u,scl=%u,next=%u,trig=%u,fail=%u\n",
                PIN_SDA, PIN_SCL, PIN_BTN_NEXT, PIN_BTN_TRIG, PIN_BTN_FAIL);
}

static void printHelp() {
  Serial.println(F("CMDS: next | page <n> | sel <id> | trig | fail | list | info | reset | help"));
}

static void printList(uint32_t now) {
  int n = gFleet.freshCount(now);
  Serial.printf("LIST,fresh=%d\n", n);
  for (int id = 1; id < FleetView::SIZE; ++id) {
    RobotView &r = gFleet.robots[id];
    if (!gFleet.isFresh(r, now)) continue;
    Serial.printf("ROBOT,%u,%d,%d,%d,%d,%u,%u,%u,%u,%lu\n", (unsigned)id, (int)r.x,
                  (int)r.y, (int)r.goalX, (int)r.goalY, (unsigned)r.batteryPercent,
                  (unsigned)r.priority, (unsigned)r.status, (unsigned)r.nextAction,
                  (unsigned long)(now - r.lastSeenMs));
  }
}

static void handleSerial(uint32_t now) {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
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
    if (sscanf(line.c_str(), "sel %d", &id) == 1 && id >= 0 && id <= MAX_ROBOT_ID) {
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
  } else if (line == "info") {
    printInfo();
  } else if (line == "reset") {
    gReadings.triggers = 0;
    gReadings.failures = 0;
    gSimFailUntil = 0;
    gSimFailTarget = 0;
    gEventLog = EventLog();
    Serial.println(F("EVENT,reset"));
  } else if (line == "help") {
    printHelp();
  } else {
    Serial.println(F("ERR,unknown_command"));
  }
}

/* ------------------------------- OLED ----------------------------------- */

static void refreshOled(uint32_t now) {
  if (!gOledOk) return;
  if ((uint32_t)(now - gLastOledMs) < OLED_REFRESH_MS) return;
  gLastOledMs = now;

  if (gSelectedId == 0) gSelectedId = gFleet.firstFresh(now);
  renderDashboard(display, gPage, gFleet, gReadings, gEventLog, now, gSelectedId,
                  gSimFailTarget, simFailActive(now));
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
  handleSerial(now);
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

  delay(LOOP_TICK_MS);
}
