/*
 * FUSION26 - OLED Dashboard Node - rendering
 * ============================================================================
 * Draws four pages on a 128x64 SSD1306:
 *   0 FLEET     - live robots heard over ESP-NOW
 *   1 ROBOT     - detail of one selected robot
 *   2 READINGS  - local random / tick / analog readings
 *   3 EVENTS    - rolling log of button + serial events
 * ============================================================================
 */
#pragma once

#include <Arduino.h>
#include <string.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "dashboard_data.h"

enum DashPage {
  PAGE_FLEET = 0,
  PAGE_ROBOT,
  PAGE_READINGS,
  PAGE_EVENTS,
  PAGE_COUNT
};

inline const char *pageName(int page) {
  switch (page) {
    case PAGE_FLEET:    return "FLEET";
    case PAGE_ROBOT:    return "ROBOT";
    case PAGE_READINGS: return "READ";
    case PAGE_EVENTS:   return "EVT";
    default:            return "?";
  }
}

inline const char *statusAbbrev(uint8_t s) {
  switch (s) {
    case ST_WORKING: return "WORK";
    case ST_WAITING: return "WAIT";
    case ST_BLOCKED: return "BLCK";
    case ST_FAILED:  return "FAIL";
    default:         return "?";
  }
}

inline const char *actionAbbrev(uint8_t a) {
  switch (a) {
    case ACT_UP:    return "UP";
    case ACT_DOWN:  return "DOWN";
    case ACT_LEFT:  return "LEFT";
    case ACT_RIGHT: return "RIGHT";
    case ACT_WAIT:  return "WAIT";
    default:        return "--";
  }
}

inline void drawHeader(Adafruit_SSD1306 &d, const char *left, const char *right) {
  d.fillRect(0, 0, OLED_W, 11, SSD1306_WHITE);
  d.setTextSize(1);
  d.setTextColor(SSD1306_BLACK);
  d.setCursor(2, 2);
  d.print(left);
  if (right && right[0]) {
    int16_t w = (int16_t)strlen(right) * 6;
    int16_t x = OLED_W - 3 - w;
    if (x < 50) x = 50;
    d.setCursor(x, 2);
    d.print(right);
  }
  d.setTextColor(SSD1306_WHITE);
}

inline void drawCentered(Adafruit_SSD1306 &d, int y, const char *s) {
  int16_t w = (int16_t)strlen(s) * 6;
  int16_t x = (OLED_W - w) / 2;
  if (x < 0) x = 0;
  d.setCursor(x, y);
  d.print(s);
}

/* ------------------------------ page 0 ---------------------------------- */

inline void drawPageFleet(Adafruit_SSD1306 &d, FleetView &fleet, uint32_t now,
                          int simTarget, bool simActive) {
  char hdr[16];
  snprintf(hdr, sizeof(hdr), "%d", fleet.freshCount(now));
  drawHeader(d, "FLEET", hdr);

  int line = 0;
  for (int id = 1; id < FleetView::SIZE && line < 6; ++id) {
    RobotView &r = fleet.robots[id];
    if (!fleet.isFresh(r, now)) continue;

    bool failed = simActive && id == simTarget;
    char buf[24];
    snprintf(buf, sizeof(buf), "#%u %d,%d  B%u %s", (unsigned)id, (int)r.x,
             (int)r.y, (unsigned)r.batteryPercent,
             failed ? "FAIL" : statusAbbrev(r.status));
    d.setCursor(0, 12 + line * 8);
    d.print(buf);
    ++line;
  }

  if (line == 0) {
    drawCentered(d, 20, "No robots heard");
    drawCentered(d, 32, "TRIG = readings");
    drawCentered(d, 44, "NEXT = pages");
  }
}

/* ------------------------------ page 1 ---------------------------------- */

inline void drawPageRobot(Adafruit_SSD1306 &d, FleetView &fleet, uint32_t now,
                          int selId, int simTarget, bool simActive) {
  char hdr[12];
  if (selId > 0) snprintf(hdr, sizeof(hdr), "#%d", selId);
  else hdr[0] = '\0';
  drawHeader(d, "ROBOT", hdr);

  if (selId <= 0 || !fleet.isFresh(fleet.robots[selId], now)) {
    drawCentered(d, 18, "No robot selected");
    drawCentered(d, 32, "wait for a robot");
    return;
  }

  RobotView &r = fleet.robots[selId];
  bool failed = simActive && selId == simTarget;
  char buf[24];

  d.setCursor(0, 12);
  snprintf(buf, sizeof(buf), "POS   %d,%d", (int)r.x, (int)r.y);
  d.print(buf);

  d.setCursor(0, 20);
  snprintf(buf, sizeof(buf), "GOAL  %d,%d", (int)r.goalX, (int)r.goalY);
  d.print(buf);

  d.setCursor(0, 28);
  snprintf(buf, sizeof(buf), "BATT  %u%%  PRI %u", (unsigned)r.batteryPercent,
           (unsigned)r.priority);
  d.print(buf);

  d.setCursor(0, 36);
  snprintf(buf, sizeof(buf), "STAT  %s", failed ? "FAIL" : statusAbbrev(r.status));
  d.print(buf);

  d.setCursor(0, 44);
  snprintf(buf, sizeof(buf), "ACT   %s", actionAbbrev(r.nextAction));
  d.print(buf);

  d.setCursor(0, 52);
  snprintf(buf, sizeof(buf), "AGE   %.1fs",
           (now - r.lastSeenMs) / 1000.0f);
  d.print(buf);
}

/* ------------------------------ page 2 ---------------------------------- */

inline void drawPageReadings(Adafruit_SSD1306 &d, Readings &rd) {
  char hdr[12];
  snprintf(hdr, sizeof(hdr), "t%lu", (unsigned long)rd.ticks);
  drawHeader(d, "READINGS", hdr);

  char buf[24];

  d.setCursor(0, 12);
  snprintf(buf, sizeof(buf), "TICK  %lus", (unsigned long)rd.tick);
  d.print(buf);

  d.setCursor(0, 20);
  snprintf(buf, sizeof(buf), "RND   %d   raw %u", (int)rd.randWalk,
           (unsigned)rd.rnd);
  d.print(buf);

  d.setCursor(0, 28);
  snprintf(buf, sizeof(buf), "TEMP  %.1f C", rd.tempC);
  d.print(buf);

  d.setCursor(0, 36);
#if USE_A0
  snprintf(buf, sizeof(buf), "LOAD  %u%%  A0 %u", (unsigned)rd.load,
           (unsigned)rd.a0);
#else
  snprintf(buf, sizeof(buf), "LOAD  %u%%", (unsigned)rd.load);
#endif
  d.print(buf);

  d.setCursor(0, 44);
  snprintf(buf, sizeof(buf), "TRIG  %u  FAIL %u", (unsigned)rd.triggers,
           (unsigned)rd.failures);
  d.print(buf);

  d.setCursor(0, 52);
  snprintf(buf, sizeof(buf), "HEAP  %u", (unsigned)ESP.getFreeHeap());
  d.print(buf);
}

/* ------------------------------ page 3 ---------------------------------- */

inline void drawPageEvents(Adafruit_SSD1306 &d, EventLog &log) {
  char hdr[8];
  snprintf(hdr, sizeof(hdr), "%u", (unsigned)log.count);
  drawHeader(d, "EVENTS", hdr);

  if (log.count == 0) {
    drawCentered(d, 30, "(none yet)");
    return;
  }

  /* Newest first. */
  int shown = 0;
  for (int i = log.count - 1; i >= 0 && shown < 6; --i, ++shown) {
    const EventEntry &e = log.at(i);
    uint32_t s = e.ms / 1000;
    char buf[26];
    snprintf(buf, sizeof(buf), "%02lu:%02lu %s", (unsigned long)((s / 60) % 100),
             (unsigned long)(s % 60), e.text);
    d.setCursor(0, 12 + shown * 8);
    d.print(buf);
  }
}

/* ----------------------------- dispatcher ------------------------------- */

inline void renderDashboard(Adafruit_SSD1306 &d, int page, FleetView &fleet,
                            Readings &rd, EventLog &log, uint32_t now,
                            int selId, int simTarget, bool simActive) {
  d.clearDisplay();
  switch (page) {
    case PAGE_FLEET:
      drawPageFleet(d, fleet, now, simTarget, simActive);
      break;
    case PAGE_ROBOT:
      drawPageRobot(d, fleet, now, selId, simTarget, simActive);
      break;
    case PAGE_READINGS:
      drawPageReadings(d, rd);
      break;
    case PAGE_EVENTS:
      drawPageEvents(d, log);
      break;
    default:
      break;
  }
  d.display();
}
