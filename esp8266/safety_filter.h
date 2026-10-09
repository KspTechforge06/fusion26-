/*
 * FUSION26 - safety filter.
 *
 * The GNN only produces a *preference*. Before that preference becomes a
 * move, it is masked against the local occupancy knowledge:
 *   - destination must be inside the grid and not a static obstacle
 *   - destination must not be the last-known cell of ANY known peer
 *     (conservative: a silent/failed robot may still physically be there)
 *   - two peers must not claim the same destination in the same step;
 *     ties are broken deterministically by (priority, then lower id)
 * WAIT is always safe, so the filter can never deadlock into ILP.
 *
 * This is a local, best-effort filter. It reduces collisions but a
 * fleet-wide guarantee needs time-indexed reservations across all peers.
 */
#pragma once

#include <Arduino.h>
#include "config.h"
#include "robot_packet.h"
#include "robot_state.h"
#include "grid.h"
#include "neighbor_table.h"

inline int chooseSafeAction(const float scores[ACTIONS], const bool safe[ACTIONS]) {
  int best = -1;
  float bestScore = -1.0e30f;
  for (int a = 0; a < ACTIONS; ++a) {
    if (safe[a] && scores[a] > bestScore) {
      best = a;
      bestScore = scores[a];
    }
  }
  return (best < 0) ? ACT_WAIT : best;
}

/*
 * Fill safe[0..4]. blockedAny is set if at least one directional action
 * was rejected (used to report ST_BLOCKED status).
 */
inline void computeSafeActions(const WarehouseGrid &grid,
                               const NeighborTable &nb,
                               const LocalState &self,
                               uint32_t now,
                               bool safe[ACTIONS],
                               bool &blockedAny) {
  for (int a = 0; a < ACTIONS; ++a) safe[a] = true;
  blockedAny = false;

  for (uint8_t a = 0; a < ACT_WAIT; ++a) {
    int nx = self.x + actionDX(a);
    int ny = self.y + actionDY(a);
    bool ok = true;

    if (!grid.inBounds(nx, ny) || grid.isStaticBlocked(nx, ny)) {
      ok = false;
    }

    /* Any known peer's last cell blocks the target. */
    if (ok) {
      for (int id = 1; id < NeighborTable::SIZE; ++id) {
        const NeighborRecord &r = nb.records[id];
        if (!r.seen) continue;
        if (r.x == nx && r.y == ny) {
          ok = false;
          break;
        }
      }
    }

    /* Simultaneous destination claim: deterministic priority tie-break. */
    if (ok) {
      for (int id = 1; id < NeighborTable::SIZE; ++id) {
        const NeighborRecord &r = nb.records[id];
        if (!nb.isFresh(r, now)) continue;
        int tx = r.x + actionDX(r.nextAction);
        int ty = r.y + actionDY(r.nextAction);
        if (tx == nx && ty == ny) {
          bool iWin = (self.priority > r.priority) ||
                      (self.priority == r.priority && self.id < r.robotId);
          if (!iWin) {
            ok = false;
            break;
          }
        }
      }
    }

    safe[a] = ok;
    if (!ok) blockedAny = true;
  }

  safe[ACT_WAIT] = true; /* always allowed */
}
