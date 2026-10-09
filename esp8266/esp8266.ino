/*
 * ============================================================================
 * FUSION26 - Decentralized Warehouse AMR Fleet
 * ESP8266 + ESP-NOW firmware  (one board == one robot)
 * ============================================================================
 *
 * Each board is an independent decision-maker:
 *   1. keeps its own position, goal, battery, priority, status
 *   2. broadcasts a compact state/action packet over ESP-NOW
 *   3. receives peers' packets into a neighbor table
 *   4. expires stale peers and detects failures locally
 *   5. runs a tiny message-passing GNN (self + mean of neighbors)
 *   6. masks the proposed action with an independent safety filter
 *   7. executes one grid step, or WAITs
 *   8. adopts a failed peer's task if it is the best-placed claimant
 *
 * There is NO central controller. Peers talk directly (broadcast).
 *
 * ---------------------------------------------------------------------------
 * FLASHING (Arduino IDE):
 *   1. Tools > Board > "NodeMCU 1.0 (ESP-12E Module)" (or your board)
 *   2. Set a UNIQUE robot id below (ROBOT_ID) for every board and re-upload.
 *   3. Open Serial Monitor at 115200 baud.
 * ---------------------------------------------------------------------------
 * Serial commands (newline terminated):
 *   f            simulate this robot failing (go silent for a few sec)
 *   goal <x> <y> set my goal to a grid cell
 *   pri <n>      set my priority 0..10
 *   info         print configuration + MAC
 *   reset        clear statistics
 *   help         list commands
 * ============================================================================
 */

#include <ESP8266WiFi.h>

extern "C" {
#include <espnow.h>
}

#include "config.h"
#include "robot_packet.h"
#include "robot_state.h"
#include "grid.h"
#include "tiny_gnn.h"
#include "neighbor_table.h"
#include "safety_filter.h"
#include "task_market.h"

/* ----------------------------- globals ---------------------------------- */

static uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

static LocalState    selfState;
static NeighborTable neighborTable;
static WarehouseGrid grid;

static uint32_t gLastBroadcastMs = 0;
static uint32_t gLastMoveMs      = 0;
static uint32_t gLastTelemetryMs = 0;
static uint32_t gRng             = 0x1BADB002u ^ ((uint32_t)ROBOT_ID * 2654435761u);
static uint32_t gSilentUntilMs   = 0;
static uint16_t gSeq             = 0;

/* stats */
static uint32_t gMoves = 0, gWaits = 0, gConflicts = 0;
static uint32_t gAdoptions = 0, gDeliveries = 0, gGnnRuns = 0;
static uint32_t gLastInferUs = 0;
static int      gLastAction = ACT_WAIT;
static float    gLastScores[ACTIONS] = {0};

/* ESP-NOW receive queue (filled in callback, drained in loop) */
static const uint8_t RX_QUEUE_SIZE = 8;
static RobotPacket   gRxQueue[RX_QUEUE_SIZE];
static volatile uint8_t gRxHead = 0;
static volatile uint8_t gRxTail = 0;

/* ----------------------------- helpers ---------------------------------- */

static inline uint32_t xorshift32(uint32_t &s) {
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  return s;
}

static void pickNewGoal() {
  for (int i = 0; i < 200; ++i) {
    int16_t gx = (int16_t)(xorshift32(gRng) % GRID_W);
    int16_t gy = (int16_t)(xorshift32(gRng) % GRID_H);
    if (!grid.isStaticBlocked(gx, gy) &&
        !(gx == selfState.x && gy == selfState.y)) {
      selfState.goalX = gx;
      selfState.goalY = gy;
      return;
    }
  }
}

static float computeCongestion(uint32_t now) {
  int count = 0;
  for (int id = 1; id < NeighborTable::SIZE; ++id) {
    const NeighborRecord &r = neighborTable.records[id];
    if (!neighborTable.isFresh(r, now)) continue;
    if (manhattanI(r.x, r.y, selfState.x, selfState.y) <= CONGESTION_RADIUS) ++count;
  }
  float c = (float)count / CONGESTION_SATURATION;
  return c > 1.0f ? 1.0f : c;
}

/* ----------------------------- radio ------------------------------------ */

static void onDataSent(uint8_t *mac, uint8_t status) {
  (void)mac;
  (void)status;
}

/* Keep this minimal: copy and return. No Serial, no inference. */
static void onDataRecv(uint8_t *mac, uint8_t *data, uint8_t len) {
  (void)mac;
  if (len != sizeof(RobotPacket)) return;
  uint8_t next = (uint8_t)((gRxHead + 1) % RX_QUEUE_SIZE);
  if (next == gRxTail) return; /* queue full: drop */
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

  /* Broadcast peer; channel must match on every board. */
  if (esp_now_add_peer(BROADCAST_MAC, ESP_NOW_ROLE_COMBO, ESPNOW_CHANNEL,
                       NULL, 0) != 0) {
    Serial.println(F("ERR,esp_now_add_peer_failed"));
  }
}

static void broadcastState(uint32_t now) {
  if (now - gLastBroadcastMs < BROADCAST_INTERVAL_MS) return;
  gLastBroadcastMs = now;

  /* While simulating a failure, stay silent. */
  if (gSilentUntilMs && now < gSilentUntilMs) return;

  RobotPacket p;
  p.protocolVersion = PROTOCOL_VERSION;
  p.robotId  = selfState.id;
  p.sequence = gSeq++;
  p.x = selfState.x;
  p.y = selfState.y;
  p.goalX = selfState.goalX;
  p.goalY = selfState.goalY;
  p.batteryPercent = selfState.batteryPercent;
  p.priority = selfState.priority;
  p.status = selfState.status;
  p.nextAction = selfState.nextAction;

  esp_now_send(BROADCAST_MAC, (uint8_t *)&p, sizeof(p));
}

/* --------------------------- neighbor handling --------------------------- */

static void drainRxQueue(uint32_t now) {
  while (gRxTail != gRxHead) {
    RobotPacket p;
    memcpy(&p, &gRxQueue[gRxTail], sizeof(RobotPacket));
    gRxTail = (uint8_t)((gRxTail + 1) % RX_QUEUE_SIZE);
    neighborTable.update(p, now);
  }
}

static void handleFailuresAndTasks(uint32_t now) {
  int newly = neighborTable.expire(now);
  (void)newly;

  for (int id = 1; id < NeighborTable::SIZE; ++id) {
    NeighborRecord &r = neighborTable.records[id];
    if (!r.seen) continue;

    if (r.failed && !r.taskAdopted &&
        shouldAdoptTask(selfState, r, neighborTable, now)) {
      r.taskAdopted = true;
      selfState.goalX = r.goalX;
      selfState.goalY = r.goalY;
      ++gAdoptions;
      Serial.printf("EVENT,task_adopted,from=%u,goal=%d:%d\n",
                    r.robotId, (int)r.goalX, (int)r.goalY);
    }
  }
}

/* ------------------------------- control -------------------------------- */

static void stepMovement(uint32_t now) {
  if (now - gLastMoveMs < MOVE_INTERVAL_MS) return;
  gLastMoveMs = now;

  /* Simulated failure window: freeze and report FAILED. */
  if (gSilentUntilMs) {
    if (now < gSilentUntilMs) {
      selfState.status = ST_FAILED;
      selfState.nextAction = ACT_WAIT;
      gLastAction = ACT_WAIT;
      return;
    }
    gSilentUntilMs = 0;
    selfState.status = ST_WORKING;
    Serial.println(F("EVENT,resume"));
  }

  /* 1. Build local + neighbor features. */
  int16_t dx = (int16_t)(selfState.goalX - selfState.x);
  int16_t dy = (int16_t)(selfState.goalY - selfState.y);
  float congestion = computeCongestion(now);

  Features selfF = makeFeatures(dx, dy, selfState.batteryPercent,
                                selfState.priority, congestion,
                                selfState.status);

  Features neighF[MAX_NEIGHBORS];
  int n = neighborTable.nearestFeatures(selfState.x, selfState.y, now,
                                        neighF, MAX_NEIGHBORS);

  /* 2. Local GNN inference. */
  uint32_t t0 = micros();
  Scores sc = inferGNN(selfF, neighF, n);
  gLastInferUs = micros() - t0;
  ++gGnnRuns;
  for (int a = 0; a < ACTIONS; ++a) gLastScores[a] = sc.q[a];

  /* 3. Safety filter. */
  bool safe[ACTIONS];
  bool blockedAny = false;
  computeSafeActions(grid, neighborTable, selfState, now, safe, blockedAny);

  int action = chooseSafeAction(sc.q, safe);
  gLastAction = action;
  selfState.nextAction = (uint8_t)action;

  /* 4. Execute. */
  if (action == ACT_WAIT) {
    ++gWaits;
    selfState.status = blockedAny ? ST_BLOCKED : ST_WAITING;
    if (blockedAny) ++gConflicts;
  } else {
    int nx = selfState.x;
    int ny = selfState.y;
    applyAction((uint8_t)action, nx, ny);
    selfState.x = (int16_t)nx;
    selfState.y = (int16_t)ny;
    ++gMoves;
    selfState.status = ST_WORKING;
    if (selfState.batteryPercent > 0) {
      selfState.batteryPercent -= BATTERY_DRAIN_PER_MOVE;
    }
    if (selfState.x == selfState.goalX && selfState.y == selfState.goalY) {
      ++gDeliveries;
      Serial.printf("EVENT,delivery,id=%u,at=%d:%d\n",
                    selfState.id, (int)selfState.x, (int)selfState.y);
      pickNewGoal();
    }
  }
}

/* ------------------------------ telemetry ------------------------------- */

static void printTelemetry(uint32_t now) {
  if (now - gLastTelemetryMs < TELEMETRY_INTERVAL_MS) return;
  gLastTelemetryMs = now;

  Serial.printf(
      "TELEM,%u,%d,%d,%d,%d,%u,%u,%u,%u,%d,%lu,%lu,%lu,%lu,%lu,%lu\n",
      selfState.id, (int)selfState.x, (int)selfState.y,
      (int)selfState.goalX, (int)selfState.goalY,
      selfState.batteryPercent, selfState.priority, selfState.status,
      selfState.nextAction, neighborTable.freshCount(now),
      (unsigned long)gMoves, (unsigned long)gWaits,
      (unsigned long)gConflicts, (unsigned long)gAdoptions,
      (unsigned long)gDeliveries, (unsigned long)gLastInferUs);
}

static void printInfo() {
  Serial.printf("INFO,id=%u,proto=%u,channel=%u,grid=%dx%d\n",
                ROBOT_ID, PROTOCOL_VERSION, ESPNOW_CHANNEL, GRID_W, GRID_H);
  Serial.print(F("INFO,mac="));
  Serial.println(WiFi.macAddress());
  Serial.printf("INFO,pos=%d:%d,goal=%d:%d,priority=%u\n",
                (int)selfState.x, (int)selfState.y,
                (int)selfState.goalX, (int)selfState.goalY, selfState.priority);
  Serial.printf("INFO,scores=%d,%d,%d,%d,%d\n",
                (int)(gLastScores[0] * 100), (int)(gLastScores[1] * 100),
                (int)(gLastScores[2] * 100), (int)(gLastScores[3] * 100),
                (int)(gLastScores[4] * 100));
}

static void printHelp() {
  Serial.println(F("CMDS: f | goal <x> <y> | pri <n> | info | reset | help"));
}

static void handleSerial(uint32_t now) {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  char c = line.charAt(0);
  if (c == 'f' || line == "fail") {
    gSilentUntilMs = now + SIMULATED_FAILURE_MS;
    selfState.status = ST_FAILED;
    Serial.printf("EVENT,simulated_failure,until_ms=%lu\n",
                  (unsigned long)gSilentUntilMs);
  } else if (line.startsWith("goal")) {
    int gx = -1, gy = -1;
    if (sscanf(line.c_str(), "goal %d %d", &gx, &gy) == 2) {
      if (grid.inBounds(gx, gy) && !grid.isStaticBlocked(gx, gy)) {
        selfState.goalX = (int16_t)gx;
        selfState.goalY = (int16_t)gy;
        Serial.printf("EVENT,goal_set,goal=%d:%d\n", gx, gy);
      } else {
        Serial.println(F("ERR,bad_goal"));
      }
    }
  } else if (line.startsWith("pri")) {
    int p = -1;
    if (sscanf(line.c_str(), "pri %d", &p) == 1 && p >= 0 && p <= PRIORITY_MAX) {
      selfState.priority = (uint8_t)p;
      Serial.printf("EVENT,priority_set,%d\n", p);
    } else {
      Serial.println(F("ERR,bad_priority"));
    }
  } else if (line == "info") {
    printInfo();
  } else if (line == "reset") {
    gMoves = gWaits = gConflicts = gAdoptions = gDeliveries = gGnnRuns = 0;
    Serial.println(F("EVENT,stats_reset"));
  } else if (line == "help") {
    printHelp();
  } else {
    Serial.println(F("ERR,unknown_command"));
  }
}

/* -------------------------------- setup --------------------------------- */

static void setupState() {
  grid.buildDemoWarehouse();

  selfState.id = ROBOT_ID;
  selfState.batteryPercent = START_BATTERY;
  selfState.priority = 1;
  selfState.status = ST_WORKING;
  selfState.nextAction = ACT_WAIT;
  selfState.sequence = 0;

  /* Deterministic, distinct-ish starting cells for small fleets. */
  selfState.x = (int16_t)((ROBOT_ID * 5) % GRID_W);
  selfState.y = (int16_t)((ROBOT_ID * 7) % GRID_H);
  if (grid.isStaticBlocked(selfState.x, selfState.y)) {
    selfState.x = 0;
    selfState.y = 0;
  }
  pickNewGoal();
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.printf("\nBOOT,FUSION26,id=%u,proto=%u\n", ROBOT_ID, PROTOCOL_VERSION);
  setupState();
  setupRadio();
  Serial.print(F("MAC,"));
  Serial.println(WiFi.macAddress());
  Serial.printf("CFG,id=%u,channel=%u,grid=%dx%d,neighborTimeout=%d,failureTimeout=%d\n",
                ROBOT_ID, ESPNOW_CHANNEL, GRID_W, GRID_H,
                NEIGHBOR_TIMEOUT_MS, FAILURE_TIMEOUT_MS);
  printHelp();
}

/* --------------------------------- loop --------------------------------- */

void loop() {
  uint32_t now = millis();

  handleSerial(now);
  drainRxQueue(now);
  handleFailuresAndTasks(now);
  stepMovement(now);
  broadcastState(now);
  printTelemetry(now);

  delay(LOOP_TICK_MS);
}
