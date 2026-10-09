/*
 * FUSION26 - OLED Dashboard Node - configuration
 * ============================================================================
 * This board is an ESP-NOW OBSERVER, not a robot. It listens to the fleet's
 * broadcast packets and renders them on a 128x64 SSD1306 OLED. When no robots
 * are heard it falls back to local random/tick readings (a demo dashboard).
 *
 * The protocol constants below MUST match the fleet firmware in
 * ../esp8266/config.h, otherwise packets are rejected. All radio settings can
 * be overridden per-build with -D...=... (arduino-cli / PlatformIO).
 * ============================================================================
 */
#pragma once

/* ---- Protocol: MUST match the fleet (../esp8266) ---- */
#ifndef PROTOCOL_VERSION
#define PROTOCOL_VERSION 1
#endif
#ifndef ESPNOW_CHANNEL
#define ESPNOW_CHANNEL 1
#endif
#define MAX_ROBOT_ID 16

/*
 * Reserved dashboard beacon id. The fleet rejects any robotId > MAX_ROBOT_ID,
 * so 200 can never be confused with a real robot. The dashboard broadcasts its
 * own readings under this id so a laptop sniffer/log can see it too.
 */
#define DASH_BEACON_ID 200

/* ---- OLED: SSD1306 128x64 I2C ---- */
#define OLED_ADDR 0x3C
#define OLED_W 128
#define OLED_H 64
#ifndef PIN_SDA
#define PIN_SDA 4 /* NodeMCU D2 */
#endif
#ifndef PIN_SCL
#define PIN_SCL 5 /* NodeMCU D1 */
#endif

/* ---- Push buttons (active LOW, wired to GND, internal pull-up) ---- */
#ifndef PIN_BTN_NEXT
#define PIN_BTN_NEXT 14 /* NodeMCU D5 - change page               */
#endif
#ifndef PIN_BTN_TRIG
#define PIN_BTN_TRIG 12 /* NodeMCU D6 - trigger a reading/event   */
#endif
#ifndef PIN_BTN_FAIL
#define PIN_BTN_FAIL 13 /* NodeMCU D7 - simulate a robot failure  */
#endif

/* ---- Timing (milliseconds) ---- */
#define LOOP_TICK_MS 10
#define OLED_REFRESH_MS 250     /* redraw cadence                     */
#define SERIAL_TELEM_MS 1000    /* serial telemetry cadence           */
#define READING_STEP_MS 500     /* how often local readings advance   */
#define BTN_DEBOUNCE_MS 40
#define ROBOT_STALE_MS 3000     /* a robot older than this is hidden  */
#define SIM_FAIL_WINDOW_MS 5000 /* how long a simulated failure shows */
#define BEACON_INTERVAL_MS 500  /* dashboard self-broadcast cadence   */

/*
 * The dashboard can announce itself (and button events) on the same channel
 * under DASH_BEACON_ID. The fleet ignores that id, so it is safe. Set to 0 to
 * make the node receive-only.
 */
#ifndef DASH_PERIODIC_BEACON
#define DASH_PERIODIC_BEACON 1
#endif

/* ---- Local readings ---- */
#ifndef USE_A0
#define USE_A0 1 /* set 0 if A0 is not connected           */
#endif
#define RAND_WALK_MIN 0
#define RAND_WALK_MAX 99
#define RAND_WALK_STEP 6
#define TEMP_MIN 18.0f
#define TEMP_MAX 32.0f

/* ---- UI ---- */
#define EVENT_LOG_SIZE 6
#define EVENT_TEXT_LEN 18
