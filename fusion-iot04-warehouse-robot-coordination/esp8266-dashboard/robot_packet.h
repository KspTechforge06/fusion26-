/*
 * FUSION26 - wire packet + enums.
 *
 * IMPORTANT: both firmware builds must use exactly this field order and
 * the same #pragma pack(1). Bump PROTOCOL_VERSION on any change.
 *
 * NOTE: this is an exact copy of ../esp8266/robot_packet.h. Keep both files
 * byte-for-byte compatible. If the fleet format changes, update BOTH.
 */
#pragma once

#include <Arduino.h>
#include "config.h"

/* Actions: index 0..4 is also the GNN output order. */
enum Action : uint8_t {
  ACT_UP = 0,
  ACT_DOWN = 1,
  ACT_LEFT = 2,
  ACT_RIGHT = 3,
  ACT_WAIT = 4
};

/* Robot status values carried in the packet. */
enum RobotStatus : uint8_t {
  ST_WORKING = 0,
  ST_WAITING = 1,
  ST_BLOCKED = 2,
  ST_FAILED = 3
};

#pragma pack(push, 1)
struct RobotPacket {
  uint8_t  protocolVersion;
  uint8_t  robotId;
  uint16_t sequence;

  int16_t  x;
  int16_t  y;
  int16_t  goalX;
  int16_t  goalY;

  uint8_t  batteryPercent; /* 0..100                     */
  uint8_t  priority;       /* 0..PRIORITY_MAX            */
  uint8_t  status;         /* RobotStatus                */
  uint8_t  nextAction;     /* Action the robot intends   */
};
#pragma pack(pop)

/* ---------------------------------------------------------------- */
/* Shared, side-effect-free helpers used by safety + planning code.  */
/* ---------------------------------------------------------------- */

inline int actionDX(uint8_t action) {
  return (action == ACT_LEFT) ? -1 : ((action == ACT_RIGHT) ? 1 : 0);
}

inline int actionDY(uint8_t action) {
  return (action == ACT_UP) ? -1 : ((action == ACT_DOWN) ? 1 : 0);
}

/* Apply an action to a coordinate pair. WAIT leaves it unchanged. */
inline void applyAction(uint8_t action, int &x, int &y) {
  x += actionDX(action);
  y += actionDY(action);
}
