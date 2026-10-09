/*
 * FUSION26 - Decentralized Warehouse AMR Fleet - configuration
 *
 * Every board runs the SAME firmware. The only field that must differ is
 * ROBOT_ID. Set it here, or override it per-build with -DROBOT_ID=n
 * (PlatformIO) / -DROBOT_ID=n (arduino-cli).
 */
#pragma once

/* ---- Protocol ---- */
#ifndef PROTOCOL_VERSION
#define PROTOCOL_VERSION 1
#endif

/* ---- Identity (CHANGE PER BOARD) ---- */
#ifndef ROBOT_ID
#define ROBOT_ID 1
#endif

/* ---- Radio ----
 * Every board in the fleet must use the SAME Wi-Fi channel. ESP-NOW only
 * works between peers on one channel. Avoid running an AP connection at
 * the same time (it can move the radio off this channel).
 */
#ifndef ESPNOW_CHANNEL
#define ESPNOW_CHANNEL 1
#endif

/* Highest robot id the fleet will ever use (table sizing). */
#define MAX_ROBOT_ID 16

/* ---- Grid world (all boards agree on this map) ---- */
#define GRID_W 24
#define GRID_H 24
#define MAX_DIST 20.0f /* normalization scale for relative goal */

/* ---- Timing (milliseconds) ---- */
#define LOOP_TICK_MS 20          /* main loop pacing               */
#define BROADCAST_INTERVAL_MS 200 /* state/action heartbeat         */
#define MOVE_INTERVAL_MS 500      /* one grid step this often       */
#define TELEMETRY_INTERVAL_MS 500 /* serial telemetry cadence       */
#define NEIGHBOR_TIMEOUT_MS 1500  /* drop peer from GNN input       */
#define FAILURE_TIMEOUT_MS 5000   /* declare peer FAILED            */
#define SIMULATED_FAILURE_MS 8000 /* 'f' command silence window     */

/* ---- Behavior ---- */
#define PRIORITY_MAX 10           /* priority range 0..10           */
#define START_BATTERY 100         /* percent                        */
#define BATTERY_DRAIN_PER_MOVE 1  /* percent per grid step          */
#define CONGESTION_RADIUS 4       /* cells: count peers within      */
#define CONGESTION_SATURATION 5.0f /* peers for congestion score = 1 */
