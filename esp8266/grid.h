/*
 * FUSION26 - local occupancy grid.
 *
 * All boards use the same deterministic demo warehouse so that their
 * safety filters agree. A production version would load a shared map.
 */
#pragma once

#include <Arduino.h>
#include "config.h"

class WarehouseGrid {
 public:
  uint8_t cells[GRID_H][GRID_W]; /* 0 = free, 1 = static blocked */

  WarehouseGrid() { clear(); }

  void clear() {
    for (int y = 0; y < GRID_H; ++y)
      for (int x = 0; x < GRID_W; ++x) cells[y][x] = 0;
  }

  inline bool inBounds(int x, int y) const {
    return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
  }

  inline bool isStaticBlocked(int x, int y) const {
    return !inBounds(x, y) || cells[y][x] != 0;
  }

  inline void setBlocked(int x, int y, uint8_t v = 1) {
    if (inBounds(x, y)) cells[y][x] = v;
  }

  /* Regular 2x2 shelf blocks on a 5-cell pitch -> warehouse aisles. */
  void buildDemoWarehouse() {
    clear();
    for (int sx = 3; sx < GRID_W - 3; sx += 5) {
      for (int sy = 3; sy < GRID_H - 3; sy += 5) {
        for (int dx = 0; dx < 2; ++dx)
          for (int dy = 0; dy < 2; ++dy) setBlocked(sx + dx, sy + dy);
      }
    }
  }
};
