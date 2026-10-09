/*
 * FUSION26 - neighbor table.
 *
 * One record per possible robot id. ESP-NOW callbacks must NOT do heavy
 * work: they just queue packets (see the .ino). This table is updated in
 * the main loop where it is safe to do lookups and inference.
 *
 * Staleness policy:
 *   age <= NEIGHBOR_TIMEOUT_MS          -> "fresh", used by the GNN
 *   age >  FAILURE_TIMEOUT_MS           -> "failed", cell treated as blocked
 * Anything in between is stale but not yet failed.
 */
#pragma once

#include <Arduino.h>
#include "config.h"
#include "robot_packet.h"
#include "tiny_gnn.h"

struct NeighborRecord {
  bool     seen;          /* ever heard from                     */
  bool     failed;        /* age > FAILURE_TIMEOUT_MS            */
  bool     taskAdopted;   /* we already took over its goal        */
  uint8_t  robotId;
  uint16_t lastSequence;
  uint32_t lastSeenMs;
  int16_t  x, y;
  int16_t  goalX, goalY;
  uint8_t  batteryPercent;
  uint8_t  priority;
  uint8_t  status;
  uint8_t  nextAction;

  NeighborRecord()
      : seen(false), failed(false), taskAdopted(false), robotId(0),
        lastSequence(0), lastSeenMs(0), x(0), y(0), goalX(-1), goalY(-1),
        batteryPercent(0), priority(0), status(ST_WORKING), nextAction(ACT_WAIT) {}
};

class NeighborTable {
 public:
  static const int SIZE = MAX_ROBOT_ID + 1;
  NeighborRecord records[SIZE];

  void clear() {
    for (int i = 0; i < SIZE; ++i) records[i] = NeighborRecord();
  }

  /* sequence wrap-safe "a is newer than b" test */
  static inline bool isNewer(uint16_t a, uint16_t b) {
    return (int16_t)(a - b) > 0;
  }

  /* Returns true if the packet was accepted (new, valid, not self). */
  bool update(const RobotPacket &p, uint32_t now) {
    if (p.protocolVersion != PROTOCOL_VERSION) return false;
    if (p.robotId == 0 || p.robotId > MAX_ROBOT_ID) return false;
    if (p.robotId == ROBOT_ID) return false;

    NeighborRecord &r = records[p.robotId];
    if (r.seen && !isNewer(p.sequence, r.lastSequence)) return false;

    r.seen = true;
    r.failed = false;
    r.robotId = p.robotId;
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

  inline bool isFresh(const NeighborRecord &r, uint32_t now) const {
    return r.seen && (uint32_t)(now - r.lastSeenMs) <= NEIGHBOR_TIMEOUT_MS;
  }

  inline bool isFailed(const NeighborRecord &r, uint32_t now) const {
    return r.seen && (uint32_t)(now - r.lastSeenMs) > FAILURE_TIMEOUT_MS;
  }

  int freshCount(uint32_t now) const {
    int n = 0;
    for (int id = 1; id < SIZE; ++id)
      if (isFresh(records[id], now)) ++n;
    return n;
  }

  /* Mark records that have crossed the failure timeout. Returns count newly failed. */
  int expire(uint32_t now) {
    int newlyFailed = 0;
    for (int id = 1; id < SIZE; ++id) {
      NeighborRecord &r = records[id];
      if (r.seen && !r.failed && (uint32_t)(now - r.lastSeenMs) > FAILURE_TIMEOUT_MS) {
        r.failed = true;
        ++newlyFailed;
      }
    }
    return newlyFailed;
  }

  /*
   * Build features for up to maxN nearest *fresh* neighbours.
   * Returns how many were written.
   */
  int nearestFeatures(int16_t sx, int16_t sy, uint32_t now,
                      Features out[], int maxN) const {
    bool used[SIZE];
    for (int i = 0; i < SIZE; ++i) used[i] = false;

    int found = 0;
    for (int k = 0; k < maxN; ++k) {
      int best = -1;
      long bestD = 0x7FFFFFFF;
      for (int id = 1; id < SIZE; ++id) {
        const NeighborRecord &r = records[id];
        if (used[id] || !isFresh(r, now)) continue;
        long d = labs((long)r.x - sx) + labs((long)r.y - sy);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best < 0) break;
      used[best] = true;
      const NeighborRecord &r = records[best];
      out[found] = makeFeatures((int16_t)(r.goalX - r.x),
                                (int16_t)(r.goalY - r.y),
                                r.batteryPercent, r.priority,
                                0.0f /* neighbours don't share congestion */,
                                r.status);
      ++found;
    }
    return found;
  }
};
