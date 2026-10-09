/* FUSION26 - the local robot's own state (not the wire format). */
#pragma once

#include <Arduino.h>

struct LocalState {
  uint8_t  id;
  int16_t  x;
  int16_t  y;
  int16_t  goalX;
  int16_t  goalY;
  uint8_t  batteryPercent;
  uint8_t  priority;
  uint8_t  status;
  uint8_t  nextAction;
  uint16_t sequence;

  LocalState()
      : id(0), x(0), y(0), goalX(0), goalY(0), batteryPercent(100),
        priority(1), status(0), nextAction(4), sequence(0) {}
};
