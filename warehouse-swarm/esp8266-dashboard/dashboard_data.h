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

  RobotView()
      : seen(false), lastSequence(0), lastSeenMs(0), x(0), y(0), goalX(-1),
        goalY(-1), batteryPercent(0), priority(0), status(ST_WORKING),
        nextAction(ACT_WAIT) {}
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

  /* Accept a packet. Same validation rules as the fleet neighbour table. */
  bool update(const RobotPacket &p, uint32_t now) {
    if (p.protocolVersion != PROTOCOL_VERSION) return false;
    if (p.robotId == 0 || p.robotId > MAX_ROBOT_ID) return false;

    RobotView &r = robots[p.robotId];
    if (r.seen && !isNewer(p.sequence, r.lastSequence)) return false;

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
    return true;
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
