/*
 * FUSION26 - warehouse-swarm <-> ESP8266 OLED node link.
 *
 * Streams the running simulation to the ESP over USB serial using the Web
 * Serial API (Chromium browsers). The node parses WB/WR/WE text frames and
 * renders them on its WEB / WROB OLED pages. The node's own ESP-NOW telemetry
 * on the same port is drained and ignored.
 */

import { snapshot } from "../core/metrics.js";
import type { World } from "../core/world.js";

/* Minimal Web Serial typings (not present in every TS lib.dom version). */
interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}
interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}
interface SerialApi {
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

/** Agent-state codes: must match the ESP's `WebState` enum in dashboard_data.h. */
const STATE_CODE: Record<string, number> = {
  idle: 0,
  moving: 1,
  picking: 2,
  delivering: 3,
  charging: 4,
  broken: 5,
  stranded: 6,
};

/** Job-stage codes: must match the ESP's `webStageAbbrev()` in oled_ui.h. */
const STAGE_CODE: Record<string, number> = {
  "to-pickup": 0,
  picking: 1,
  "to-dropoff": 2,
  dropping: 3,
};

/** True when the browser offers the Web Serial API (Chromium). */
export function serialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

const SEND_INTERVAL_MS = 250;

export class EspLink {
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private lastSend = 0;
  private sending = false;
  connected = false;

  constructor(private readonly onStatus: (msg: string, ok: boolean) => void) {}

  async connect(): Promise<void> {
    const serial = this.serialApi();
    if (!serial) {
      this.onStatus("Web Serial unavailable - use Chrome/Edge on localhost", false);
      return;
    }
    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      this.port = port;
      this.writer = port.writable?.getWriter() ?? null;
      this.reader = port.readable?.getReader() ?? null;
      this.connected = true;
      if (this.reader) void this.drain();
      this.onStatus("connected - streaming to ESP", true);
    } catch (err) {
      this.port = null;
      this.onStatus(`connect failed: ${errorMessage(err)}`, false);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    try {
      await this.reader?.cancel();
    } catch {
      /* port already gone */
    }
    try {
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.reader = null;
    this.writer = null;
    this.port = null;
    this.onStatus("disconnected", false);
  }

  /** Push a fresh frame at most every 250 ms while connected. */
  maybeSend(world: World, now: number): void {
    if (!this.connected || !this.writer || this.sending) return;
    if (now - this.lastSend < SEND_INTERVAL_MS) return;
    this.lastSend = now;
    this.sending = true;
    this.writer
      .write(this.encoder.encode(encodeWorld(world)))
      .catch(() => void this.disconnect())
      .finally(() => {
        this.sending = false;
      });
  }

  /** Drain the node's own telemetry so its host TX buffer never backs up. */
  private async drain(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
      }
    } catch {
      /* port closed */
    }
  }

  private serialApi(): SerialApi | null {
    return (navigator as unknown as { serial?: SerialApi }).serial ?? null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One frame: WB (run summary), one WR line per robot, WE terminator. The ESP
 * node keys on the WB/WR/WE prefixes, so these lines never hit its console
 * command parser.
 */
export function encodeWorld(world: World): string {
  const s = snapshot(world.metrics);
  const total = Object.values(s.byPriority).reduce((a, b) => a + b.created, 0);
  const active = world.robots.filter((r) => r.state !== "broken" && r.taskId !== null).length;

  const lines: string[] = [
    `WB,t=${s.tick},n=${world.robots.length},done=${s.completed},tot=${total},` +
      `thr=${Math.round(s.throughput * 100)},dl=${world.metrics.deadlocks},` +
      `w=${s.waitTicks},act=${active}`,
  ];
  for (const r of world.robots) {
    lines.push(
      `WR,${r.id},${r.x},${r.y},${Math.round(r.battery * 100)},` +
        `${STATE_CODE[r.state] ?? 0},${r.taskId ?? -1},` +
        `${r.stage ? (STAGE_CODE[r.stage] ?? -1) : -1},` +
        `${r.moves},${r.waitTicks},${r.replans}`,
    );
  }
  lines.push("WE");
  return lines.join("\n") + "\n";
}