/*
 * FUSION26 - tiny message-passing network (inference only).
 *
 * Architecture (identical to tools/train_gnn.py):
 *     h_i = relu(W_IN  * x_i + B_IN)
 *     m_i = mean over neighbours of h_j           (0 if no neighbours)
 *     z_i = relu(W_SELF * h_i + W_NEIGHBOR * m_i + B_HIDDEN)
 *     q_i = W_OUT * z_i + B_OUT                   (5 action scores)
 *
 * Mean aggregation is permutation-invariant, which is what makes this a
 * graph-style model rather than a plain MLP over concatenated features.
 *
 * The action with the highest score is a *preference*. It is NOT a
 * collision-free plan: always pass it through the safety filter.
 */
#pragma once

#include <Arduino.h>
#include "config.h"
#include "robot_packet.h"
#include "tiny_gnn_weights.h"  /* must precede encode()/inferGNN() */

constexpr int INPUTS = 6;
constexpr int HIDDEN = 8;
constexpr int ACTIONS = 5;
constexpr int MAX_NEIGHBORS = 4;

struct Features { float x[INPUTS]; };
struct Scores   { float q[ACTIONS]; };

inline float relu(float v) { return v > 0.0f ? v : 0.0f; }

inline float clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/* h = relu(W_IN * f + B_IN) */
inline void encode(const Features &f, float h[HIDDEN]) {
  for (int i = 0; i < HIDDEN; ++i) {
    float sum = B_IN[i];
    for (int j = 0; j < INPUTS; ++j) sum += W_IN[i][j] * f.x[j];
    h[i] = relu(sum);
  }
}

inline Scores inferGNN(const Features &self,
                       const Features neighbors[MAX_NEIGHBORS],
                       int neighborCount) {
  float hSelf[HIDDEN] = {};
  float aggregate[HIDDEN] = {};
  float combined[HIDDEN] = {};

  encode(self, hSelf);

  if (neighborCount < 0) neighborCount = 0;
  if (neighborCount > MAX_NEIGHBORS) neighborCount = MAX_NEIGHBORS;

  for (int n = 0; n < neighborCount; ++n) {
    float hNeighbor[HIDDEN] = {};
    encode(neighbors[n], hNeighbor);
    for (int k = 0; k < HIDDEN; ++k) aggregate[k] += hNeighbor[k];
  }
  if (neighborCount > 0) {
    for (int k = 0; k < HIDDEN; ++k) aggregate[k] /= neighborCount;
  }

  for (int i = 0; i < HIDDEN; ++i) {
    float sum = B_HIDDEN[i];
    for (int j = 0; j < HIDDEN; ++j) {
      sum += W_SELF[i][j] * hSelf[j];
      sum += W_NEIGHBOR[i][j] * aggregate[j];
    }
    combined[i] = relu(sum);
  }

  Scores out{};
  for (int a = 0; a < ACTIONS; ++a) {
    float sum = B_OUT[a];
    for (int j = 0; j < HIDDEN; ++j) sum += W_OUT[a][j] * combined[j];
    out.q[a] = sum;
  }
  return out;
}

/*
 * Build the 6 normalized features. Keep the ordering/normalization here
 * IDENTICAL to tools/train_gnn.py, or C++/Python parity will fail.
 *
 *  dx,dy        : goal - current  (grid cells)
 *  battery      : 0..100
 *  priority     : 0..PRIORITY_MAX
 *  congestion   : 0..1
 *  status       : RobotStatus
 */
inline Features makeFeatures(int16_t dx, int16_t dy, uint8_t batteryPercent,
                             uint8_t priority, float congestion,
                             uint8_t status) {
  Features f;
  f.x[0] = clampf((float)dx / MAX_DIST, -1.0f, 1.0f);
  f.x[1] = clampf((float)dy / MAX_DIST, -1.0f, 1.0f);
  f.x[2] = (float)batteryPercent / 100.0f;
  f.x[3] = (float)priority / (float)PRIORITY_MAX;
  f.x[4] = clampf(congestion, 0.0f, 1.0f);
  f.x[5] = (status == ST_BLOCKED || status == ST_FAILED) ? 1.0f : 0.0f;
  return f;
}
