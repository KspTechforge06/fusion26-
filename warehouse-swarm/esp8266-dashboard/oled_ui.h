/*
 * FUSION26 - OLED Dashboard Node - rendering
 * ============================================================================
 * Draws seven pages on a 128x64 SSD1306:
 *   0 FLEET     - live robots heard over ESP-NOW
 *   1 ROBOT     - detail of one ESP-NOW robot
 *   2 READINGS  - local random / tick / analog readings
 *   3 LINK      - ESP-NOW transmission / loss statistics
 *   4 EVENTS    - rolling log of button + serial events
 *   5 WEB       - fleet streamed from the warehouse-swarm web dashboard
 *   6 WROB      - detail of one web robot
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
  PAGE_LINK,
  PAGE_EVENTS,
  PAGE_WEB,
  PAGE_WROB,
  PAGE_COUNT
};

inline const char *pageName(int page) {
  switch (page) {
    case PAGE_FLEET:    return "FLEET";
    case PAGE_ROBOT:    return "ROBOT";
    case PAGE_READINGS: return "READ";
    case PAGE_LINK:     return "LINK";
    case PAGE_EVENTS:   return "EVT";
    case PAGE_WEB:      return "WEB";
    case PAGE_WROB:     return "WROB";
    default:            return "?";
  }
}

/* warehouse-swarm agent state -> 4-char OLED tag */
inline const char *webStateAbbrev(uint8_t s) {
  switch (s) {
    case WST_IDLE:       return "IDLE";
    case WST_MOVING:     return "MOVE";
    case WST_PICKING:    return "PICK";
    case WST_DELIVERING: return "DLVR";
    case WST_CHARGING:   return "CHRG";
    case WST_BROKEN:     return "FAIL";
    case WST_STRANDED:   return "STRN";
    default:             return "?";
  }
}

/* warehouse-swarm job stage code -> short tag */
inline const char *webStageAbbrev(int8_t stage) {
  switch (stage) {
    case 0:  return ">dock";
    case 1:  return "pick";
    case 2:  return ">pack";
    case 3:  return "pack";
    default: return "-";
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
  /* transmission: received packets + packet rate for this robot */
  snprintf(buf, sizeof(buf), "PKT%lu Hz%.1f", (unsigned long)r.packets, r.hz);
  d.print(buf);
}

/* ------------------------------ page 2 ---------------------------------- */

inline void drawPageReadings(Adafruit_SSD1306 &d, Readings &rd, LinkTotals &link) {
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
  snprintf(buf, sizeof(buf), "RX    %lu %.0f/s", (unsigned long)link.rx,
           link.rxPerSec);
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

/* ------------------------------ page 3 (LINK) --------------------------- */

/* Transmission view: total traffic, losses, a per-second sparkline, and the
 * selected robot's packet count / rate / gaps / age. */
inline void drawPageLink(Adafruit_SSD1306 &d, FleetView &fleet, LinkTotals &link,
                         uint32_t now, int selId) {
  char hdr[12];
  snprintf(hdr, sizeof(hdr), "%.0f/s", link.rxPerSec);
  drawHeader(d, "LINK", hdr);

  char buf[26];
  d.setCursor(0, 12);
  snprintf(buf, sizeof(buf), "RX %lu  TICK %lu", (unsigned long)link.rx,
           (unsigned long)link.fleetTick);
  d.print(buf);

  d.setCursor(0, 20);
  snprintf(buf, sizeof(buf), "DROP%lu STL%lu BAD%lu", (unsigned long)link.dropped,
           (unsigned long)link.stale,
           (unsigned long)(link.badVersion + link.badId + link.badLen));
  d.print(buf);

  /* sparkline: oldest -> newest, scaled to the peak in the window */
  const int baseY = 47;
  const int topY = 30;
  uint16_t mx = link.historyMax();
  int bw = OLED_W / LINK_HISTORY;
  if (bw < 1) bw = 1;
  for (int i = 0; i < LINK_HISTORY; ++i) {
    int idx = (link.histHead + i) % LINK_HISTORY;
    uint16_t v = link.history[idx];
    int h = (int)((uint32_t)v * (baseY - topY) / mx);
    int x = i * bw;
    if (h > 0) d.fillRect(x, baseY - h, bw - 1, h, SSD1306_WHITE);
  }

  d.setCursor(0, 48);
  snprintf(buf, sizeof(buf), "PEAK%u/s NOW%.0f/s", (unsigned)link.peakPerSec,
           link.rxPerSec);
  d.print(buf);

  d.setCursor(0, 56);
  if (selId > 0 && fleet.isFresh(fleet.robots[selId], now)) {
    RobotView &r = fleet.robots[selId];
    snprintf(buf, sizeof(buf), "#%d H%.1f g%lu a%lus", selId, r.hz,
             (unsigned long)r.gaps,
             (unsigned long)((now - r.lastSeenMs) / 1000));
    d.print(buf);
  } else {
    d.print(F("no robot selected"));
  }
}

/* --------------------------- page 5 (WEB fleet) ------------------------- */

/* Fleet streamed from the warehouse-swarm web dashboard over USB serial. Shows
 * the run summary plus three robots, scrolling through the whole fleet. */
inline void drawPageWeb(Adafruit_SSD1306 &d, WebFeed &w, uint32_t now,
                        uint16_t scroll) {
  char hdr[12];
  if (!w.active)
    hdr[0] = '\0';
  else if (!w.fresh(now))
    snprintf(hdr, sizeof(hdr), "DOWN");
  else
    snprintf(hdr, sizeof(hdr), "%.0f/s", w.frameHz);
  drawHeader(d, "WEB", hdr);

  if (!w.active) {
    drawCentered(d, 20, "No web link");
    drawCentered(d, 32, "open warehouse-swarm");
    drawCentered(d, 44, "click Connect ESP");
    return;
  }

  char buf[26];
  d.setCursor(0, 12);
  snprintf(buf, sizeof(buf), "N%u ACT%u T%lu", (unsigned)w.count,
           (unsigned)w.activeRobots, (unsigned long)w.tick);
  d.print(buf);

  d.setCursor(0, 20);
  snprintf(buf, sizeof(buf), "DONE %lu/%lu", (unsigned long)w.done,
           (unsigned long)w.total);
  d.print(buf);

  d.setCursor(0, 28);
  snprintf(buf, sizeof(buf), "DL%u WAIT%lu", (unsigned)w.deadlocks,
           (unsigned long)w.waitTicks);
  d.print(buf);

  int total = w.seenCount();
  if (total == 0) {
    drawCentered(d, 44, "0 robots");
    return;
  }
  for (int row = 0; row < 3; ++row) {
    int id = w.nthSeen((int)((scroll + row) % total));
    if (id < 0) continue;
    WebRobot &r = w.robots[id];
    snprintf(buf, sizeof(buf), "R%d %s %d,%d B%u", id, webStateAbbrev(r.state),
             (int)r.x, (int)r.y, (unsigned)r.battery);
    d.setCursor(0, 36 + row * 8);
    d.print(buf);
  }
}

/* --------------------------- page 6 (WEB robot) ------------------------- */

inline void drawPageWebRobot(Adafruit_SSD1306 &d, WebFeed &w, uint32_t now,
                             int selId) {
  char hdr[12];
  if (selId >= 0) snprintf(hdr, sizeof(hdr), "#%d", selId);
  else hdr[0] = '\0';
  drawHeader(d, "WROB", hdr);

  if (!w.active) {
    drawCentered(d, 28, "No web link");
    return;
  }
  if (selId < 0 || selId >= WEB_MAX_ROBOTS || !w.robots[selId].seen) {
    char msg[24];
    snprintf(msg, sizeof(msg), "no web robot #%d", selId);
    drawCentered(d, 28, msg);
    return;
  }

  WebRobot &r = w.robots[selId];
  char buf[26];

  d.setCursor(0, 12);
  snprintf(buf, sizeof(buf), "POS   %d,%d", (int)r.x, (int)r.y);
  d.print(buf);

  d.setCursor(0, 20);
  snprintf(buf, sizeof(buf), "BATT  %u%%", (unsigned)r.battery);
  d.print(buf);

  d.setCursor(0, 28);
  snprintf(buf, sizeof(buf), "STATE %s", webStateAbbrev(r.state));
  d.print(buf);

  d.setCursor(0, 36);
  if (r.task < 0)
    snprintf(buf, sizeof(buf), "TASK  -");
  else
    snprintf(buf, sizeof(buf), "TASK  #%d %s", (int)r.task,
             webStageAbbrev(r.stage));
  d.print(buf);

  d.setCursor(0, 44);
  snprintf(buf, sizeof(buf), "MOV%u WAIT%u", (unsigned)r.moves,
           (unsigned)r.waits);
  d.print(buf);

  d.setCursor(0, 52);
  snprintf(buf, sizeof(buf), "REPLAN%u AGE%lus", (unsigned)r.replans,
           (unsigned long)((now - w.lastFrameMs) / 1000));
  d.print(buf);
}

/* ----------------------------- dispatcher ------------------------------- */

inline void renderDashboard(Adafruit_SSD1306 &d, int page, FleetView &fleet,
                            Readings &rd, LinkTotals &link, WebFeed &web,
                            EventLog &log, uint32_t now, int selId, int simTarget,
                            bool simActive, uint16_t webScroll) {
  d.clearDisplay();
  switch (page) {
    case PAGE_FLEET:
      drawPageFleet(d, fleet, now, simTarget, simActive);
      break;
    case PAGE_ROBOT:
      drawPageRobot(d, fleet, now, selId, simTarget, simActive);
      break;
    case PAGE_READINGS:
      drawPageReadings(d, rd, link);
      break;
    case PAGE_LINK:
      drawPageLink(d, fleet, link, now, selId);
      break;
    case PAGE_EVENTS:
      drawPageEvents(d, log);
      break;
    default:
      break;
  }
  d.display();
}
