/*
 * FUSION26 - decentralized task recovery after a robot failure.
 *
 * This is deliberately NOT a central auction. When a peer times out,
 * every healthy robot independently asks: "am I the best-placed node to
 * take over its unfinished goal?" using a deterministic rule:
 *
 *     adopt if no FRESH healthy peer is strictly closer to the failed
 *     robot, breaking distance ties by lower robot id.
 *
 * Because every robot runs the same rule on its local view, exactly one
 * robot should claim the task in a well-connected network. Views can
 * disagree under packet loss (the guide warns about this), so this is a
 * best-effort heuristic, not a consensus protocol.
 */
#pragma once

#include <Arduino.h>
#include "config.h"
#include "robot_state.h"
#include "neighbor_table.h"

inline int manhattanI(int x1, int y1, int x2, int y2) {
  return abs(x1 - x2) + abs(y1 - y2);
}

inline bool shouldAdoptTask(const LocalState &self,
                            const NeighborRecord &failedPeer,
                            const NeighborTable &nb,
                            uint32_t now) {
  if (failedPeer.taskAdopted) return false;
  if (failedPeer.goalX < 0 || failedPeer.goalY < 0) return false;

  const int myDist = manhattanI(self.x, self.y, failedPeer.x, failedPeer.y);

  for (int id = 1; id < NeighborTable::SIZE; ++id) {
    if (id == self.id) continue;
    const NeighborRecord &r = nb.records[id];
    if (!nb.isFresh(r, now)) continue;
    if (r.failed) continue;

    const int d = manhattanI(r.x, r.y, failedPeer.x, failedPeer.y);
    if (d < myDist) return false;
    if (d == myDist && r.robotId < self.id) return false;
  }
  return true;
}
