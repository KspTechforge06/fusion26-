/*
 * FUSION26 - OLED Dashboard Node - data model
 * ============================================================================
 * Three things the dashboard displays:
 *   1. FleetView  - the robots it hears over ESP-NOW (live telemetry).
 *   2. Readings   - local random / tick values used when no robots are heard.
 *   3. EventLog   - a short rolling list of button/serial events.
 * ============================================================================
 */
#pragma once

#include <Arduino.h>
#include <stdarg.h>
#include "config.h"
#include "robot_packet.h"

/* ------------------------------- fleet ---------------------------------- */

struct RobotView {
  bool     seen;
  uint16_t lastSequence;
  uint32_t lastSeenMs;
  int16_t  x, y, goalX, goalY;
  uint8_t  batteryPercent;
  uint8_t  priority;
  uint8_t  status;
  uint8_t  nextAction;

  /* transmission / link statistics */
  uint32_t packets; /* accepted packets from this robot              */
  uint32_t gaps;    /* missed packets detected (sequence gaps)        */
  float    hz;      /* received packets per second (EMA)              */

  RobotView()
      : seen(false), lastSequence(0), lastSeenMs(0), x(0), y(0), goalX(-1),
        goalY(-1), batteryPercent(0), priority(0), status(ST_WORKING),
        nextAction(ACT_WAIT), packets(0), gaps(0), hz(0.0f) {}
};

/* How a received packet was classified (drives the link counters). */
enum UpdateResult : uint8_t {
  UPDATE_OK = 0,
  UPDATE_STALE,
  UPDATE_BAD_VERSION,
  UPDATE_BAD_ID
};

class FleetView {
 public:
  static const int SIZE = MAX_ROBOT_ID + 1;
  RobotView robots[SIZE];

  FleetView() { clear(); }

  void clear() {
    for (int i = 0; i < SIZE; ++i) robots[i] = RobotView();
  }

  static inline bool isNewer(uint16_t a, uint16_t b) {
    return (int16_t)(a - b) > 0;
  }

  /* Accept a packet. Same validation rules as the fleet neighbour table.
   * Returns how the packet was classified so the caller can keep link stats. */
  UpdateResult update(const RobotPacket &p, uint32_t now) {
    if (p.protocolVersion != PROTOCOL_VERSION) return UPDATE_BAD_VERSION;
    if (p.robotId == 0 || p.robotId > MAX_ROBOT_ID) return UPDATE_BAD_ID;

    RobotView &r = robots[p.robotId];
    if (r.seen && !isNewer(p.sequence, r.lastSequence)) return UPDATE_STALE;

    /* Sequence gap = packet(s) lost in the air. Ignore huge jumps (reboot). */
    if (r.seen && r.packets > 0) {
      uint16_t diff = (uint16_t)(p.sequence - r.lastSequence);
      if (diff > 1 && diff < LINK_GAP_MAX) r.gaps += (uint32_t)(diff - 1);
    }
    if (r.seen) {
      uint32_t dt = now - r.lastSeenMs;
      if (dt > 0) {
        float inst = 1000.0f / (float)dt;
        r.hz = r.hz * (1.0f - LINK_RATE_ALPHA) + inst * LINK_RATE_ALPHA;
      }
    } else {
      r.hz = 0.0f;
    }

    r.seen = true;
    r.lastSequence = p.sequence;
    r.lastSeenMs = now;
    r.x = p.x;
    r.y = p.y;
    r.goalX = p.goalX;
    r.goalY = p.goalY;
    r.batteryPercent = p.batteryPercent;
    r.priority = p.priority;
    r.status = p.status;
    r.nextAction = p.nextAction;
    ++r.packets;
    return UPDATE_OK;
  }

  inline bool isFresh(const RobotView &r, uint32_t now) const {
    return r.seen && (uint32_t)(now - r.lastSeenMs) <= ROBOT_STALE_MS;
  }

  int freshCount(uint32_t now) const {
    int n = 0;
    for (int i = 1; i < SIZE; ++i)
      if (isFresh(robots[i], now)) ++n;
    return n;
  }

  int firstFresh(uint32_t now) const {
    for (int i = 1; i < SIZE; ++i)
      if (isFresh(robots[i], now)) return i;
    return 0;
  }

  /* Next fresh robot id after `after` (wraps); 0 if none. */
  int nextFresh(int after, uint32_t now) const {
    for (int k = 1; k < SIZE; ++k) {
      int i = after + k;
      if (i >= SIZE) i -= SIZE;
      if (i >= 1 && isFresh(robots[i], now)) return i;
    }
    return 0;
  }
};

/* ------------------------------ link stats ------------------------------ */

/*
 * Aggregate transmission statistics for the shared ESP-NOW channel.
 * `fleetTick` is a single, shared clock: it counts accepted packets, so every
 * dashboard that hears the same fleet reports the same value (in sync).
 */
struct LinkTotals {
  uint32_t rx;         /* accepted packets                        */
  uint32_t stale;      /* rejected: old/duplicate sequence         */
  uint32_t badVersion; /* rejected: protocol version mismatch      */
  uint32_t badId;      /* rejected: robot id out of range          */
  uint32_t badLen;     /* rejected: wrong packet length            */
  uint32_t dropped;    /* dropped: RX queue full (saturated)       */
  uint32_t fleetTick;  /* shared fleet clock = accepted packets    */

  uint32_t lastBucketMs;
  uint32_t bucketCount;
  float    rxPerSec;
  uint16_t peakPerSec;
  uint16_t history[LINK_HISTORY]; /* packets per second, rolling          */
  uint8_t  histHead;

  LinkTotals()
      : rx(0), stale(0), badVersion(0), badId(0), badLen(0), dropped(0),
        fleetTick(0), lastBucketMs(0), bucketCount(0), rxPerSec(0.0f),
        peakPerSec(0), histHead(0) {
    for (int i = 0; i < LINK_HISTORY; ++i) history[i] = 0;
  }

  void accept() {
    ++rx;
    ++fleetTick;
    ++bucketCount;
  }

  /* Roll the per-second rate bucket. Call every loop. */
  void tick(uint32_t now) {
    if ((uint32_t)(now - lastBucketMs) < LINK_BUCKET_MS) return;
    lastBucketMs = now;
    uint16_t c = (bucketCount > 0xFFFFu) ? 0xFFFFu : (uint16_t)bucketCount;
    history[histHead] = c;
    histHead = (uint8_t)((histHead + 1) % LINK_HISTORY);
    if (c > peakPerSec) peakPerSec = c;
    rxPerSec = rxPerSec * 0.5f + (float)bucketCount * 0.5f;
    bucketCount = 0;
  }

  uint16_t historyMax() const {
    uint16_t m = 1;
    for (int i = 0; i < LINK_HISTORY; ++i)
      if (history[i] > m) m = history[i];
    return m;
  }
};

/* -------------------- web feed (warehouse-swarm) ------------------------ */

/*
 * The web dashboard sends its robot states over USB serial as text frames:
 *   WB,t=<tick>,n=<count>,done=<d>,tot=<t>,thr=<x100>,dl=<d>,w=<w>,act=<a>
 *   WR,<id>,<x>,<y>,<batt>,<state>,<task>,<stage>,<moves>,<waits>,<replans>
 *   WE
 * `WebFeed` is the parsed snapshot. Ids are 0-based and match the web sim.
 */

/* Agent states, matching the codes emitted by src/link/espLink.ts. */
enum WebState : uint8_t {
  WST_IDLE = 0,
  WST_MOVING,
  WST_PICKING,
  WST_DELIVERING,
  WST_CHARGING,
  WST_BROKEN,
  WST_STRANDED
};

struct WebRobot {
  bool     seen;
  uint32_t frameStamp; /* frame this robot was last present in */
  int16_t  x, y;
  uint8_t  battery;
  uint8_t  state;
  int16_t  task;  /* -1 = none                                      */
  int8_t   stage; /* -1 = none, else index into the web stage codes */
  uint16_t moves, waits, replans;
};

struct WebFeed {
  bool     active;
  uint32_t lastFrameMs;
  uint32_t frames;
  uint32_t frameStamp;
  float    frameHz;

  uint32_t tick;
  uint16_t count;
  uint32_t done;
  uint32_t total;
  uint16_t throughputX100; /* deliveries per 100 ticks x100            */
  uint16_t deadlocks;
  uint32_t waitTicks;
  uint16_t activeRobots;

  WebRobot robots[WEB_MAX_ROBOTS];

  WebFeed() { reset(); }

  void reset() {
    active = false;
    lastFrameMs = 0;
    frames = 0;
    frameStamp = 0;
    frameHz = 0.0f;
    tick = 0;
    count = 0;
    done = 0;
    total = 0;
    throughputX100 = 0;
    deadlocks = 0;
    waitTicks = 0;
    activeRobots = 0;
    for (int i = 0; i < WEB_MAX_ROBOTS; ++i) {
      WebRobot &r = robots[i];
      r.seen = false;
      r.frameStamp = 0;
      r.x = r.y = 0;
      r.battery = 0;
      r.state = WST_IDLE;
      r.task = -1;
      r.stage = -1;
      r.moves = r.waits = r.replans = 0;
    }
  }

  bool fresh(uint32_t now) const {
    return active && (uint32_t)(now - lastFrameMs) <= WEB_STALE_MS;
  }

  int seenCount() const {
    int n = 0;
    for (int i = 0; i < WEB_MAX_ROBOTS; ++i)
      if (robots[i].seen) ++n;
    return n;
  }

  /* Id of the nth seen robot (0-based ordinal), or -1. */
  int nthSeen(int nth) const {
    int n = 0;
    for (int i = 0; i < WEB_MAX_ROBOTS; ++i) {
      if (!robots[i].seen) continue;
      if (n == nth) return i;
      ++n;
    }
    return -1;
  }
};

/* ------------------------------ readings -------------------------------- */

struct Readings {
  uint32_t tick;     /* seconds since boot                 */
  uint32_t ticks;    /* total reading updates              */
  int16_t  randWalk; /* 0..99 slowly drifting "sensor"     */
  uint16_t rnd;      /* raw random sample 0..4095          */
  float    tempC;    /* simulated temperature              */
  uint8_t  load;     /* simulated load 0..100              */
  uint16_t a0;       /* A0 analog sample (if USE_A0)       */
  uint16_t triggers;
  uint16_t failures;

  Readings()
      : tick(0), ticks(0), randWalk(50), rnd(0), tempC(24.0f), load(20), a0(0),
        triggers(0), failures(0) {}

  /* Advance the random walk. Millis-free so it is easy to unit test. */
  void step() {
    ++ticks;
    int v = randWalk + (int)random(-RAND_WALK_STEP, RAND_WALK_STEP + 1);
    if (v < RAND_WALK_MIN) v = RAND_WALK_MIN;
    if (v > RAND_WALK_MAX) v = RAND_WALK_MAX;
    randWalk = (int16_t)v;

    rnd = (uint16_t)random(0, 4096);
    load = (uint8_t)(((uint16_t)load * 3 + (uint16_t)random(0, 100)) / 4);

    float t = tempC + (random(-100, 101) / 100.0f);
    if (t < TEMP_MIN) t = TEMP_MIN;
    if (t > TEMP_MAX) t = TEMP_MAX;
    tempC = t;
  }
};

/* ------------------------------ event log ------------------------------- */

struct EventEntry {
  uint32_t ms;
  char     text[EVENT_TEXT_LEN];
};

class EventLog {
 public:
  EventEntry entries[EVENT_LOG_SIZE];
  uint8_t    head;  /* next write slot */
  uint8_t    count;

  EventLog() : head(0), count(0) {
    for (int i = 0; i < EVENT_LOG_SIZE; ++i) {
      entries[i].ms = 0;
      entries[i].text[0] = '\0';
    }
  }

  void add(uint32_t now, const char *fmt, ...) {
    EventEntry &e = entries[head];
    e.ms = now;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(e.text, EVENT_TEXT_LEN, fmt, ap);
    va_end(ap);
    head = (uint8_t)((head + 1) % EVENT_LOG_SIZE);
    if (count < EVENT_LOG_SIZE) ++count;
  }

  /* i = 0 oldest .. count-1 newest. */
  const EventEntry &at(int i) const {
    int idx = (int)head - (int)count + i;
    while (idx < 0) idx += EVENT_LOG_SIZE;
    idx %= EVENT_LOG_SIZE;
    return entries[idx];
  }
};
