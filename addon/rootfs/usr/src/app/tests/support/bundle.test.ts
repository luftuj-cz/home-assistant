import type { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig } from "../../src/config/options.js";
import { setupTempDatabase } from "../helpers/testDb.js";

const HA_TOKEN = "SECRET_HA_TOKEN_VALUE";
const MQTT_PASSWORD = "SUPER_MQTT_PASSWORD";
const MQTT_USER = "mqtt-user-name";
const UI_MQTT_PASSWORD = "UI_ENTERED_MQTT_PASSWORD";
const UI_MQTT_USER = "ui-entered-mqtt-user";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

function makeConfig(): AppConfig {
  return {
    logLevel: "info",
    baseUrl: "http://supervisor/core",
    token: HA_TOKEN,
    webPort: 8099,
    staticRoot: "/usr/share/luftujha/www",
    corsOrigins: ["*"],
    offlineMode: false,
    mqtt: { host: "core-mosquitto", port: 1883, user: MQTT_USER, password: MQTT_PASSWORD },
  };
}

type AppendedEntry = { name: string; content: string | Buffer };

/**
 * Collects appended entries, draining streams into Buffers the way the real
 * archive would when it finalises - the database copy is streamed so the
 * add-on never holds the whole file in memory.
 */
function makeFakeArchive(entries: AppendedEntry[], pending: Promise<void>[]) {
  return {
    append(content: string | Buffer | Readable, opts: { name: string }) {
      if (typeof content === "string" || Buffer.isBuffer(content)) {
        entries.push({ name: opts.name, content });
        return;
      }
      pending.push(
        (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of content) chunks.push(Buffer.from(chunk));
          entries.push({ name: opts.name, content: Buffer.concat(chunks) });
        })(),
      );
    },
  };
}

describe("buildBugReportBundle", () => {
  let ctx: Awaited<ReturnType<typeof setupTempDatabase>>;

  beforeEach(async () => {
    ctx = await setupTempDatabase();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("assembles all sources, redacts secrets, and never leaks credentials", async () => {
    // Seed a settings row that embeds MQTT credentials entered through the UI.
    // They deliberately differ from the add-on config: the bundle must not rely
    // on config-derived secrets alone to keep them out.
    ctx.database.setAppSetting(
      "mqtt.settings",
      JSON.stringify({
        host: "core-mosquitto",
        port: 1883,
        user: UI_MQTT_USER,
        password: UI_MQTT_PASSWORD,
      }),
    );

    const { buildBugReportBundle } = await import("../../src/features/support/bundle.service.js");

    const deps = {
      diagnostics: {
        valveManager: { getSnapshot: async () => [] } as never,
        haClient: null,
        mqttService: {
          getStatus: () => ({
            connected: false,
            reconnecting: false,
            consecutiveFailures: 0,
            lastErrorMessage: null,
            lastErrorCode: null,
            lastErrorAt: null,
          }),
          getLastDiscoveryTime: () => null,
          getLastSuccessAt: () => null,
        } as never,
        timelineScheduler: { getActiveState: () => null },
        baseUrl: "http://supervisor/core",
        appStartedAt: new Date(),
      },
      config: makeConfig(),
      logger: noopLogger,
    };

    const entries: AppendedEntry[] = [];
    const pending: Promise<void>[] = [];
    const manifest = await buildBugReportBundle(deps, makeFakeArchive(entries, pending) as never);
    await Promise.all(pending);

    const names = entries.map((entry) => entry.name).sort();
    expect(names).toEqual(
      [
        "config.json",
        "connections.json",
        "debug-snapshot.json",
        "home-assistant.json",
        "luftator.db",
        "server-logs.log",
      ].sort(),
    );

    // Manifest records every source as included.
    expect(manifest.sources).toHaveLength(6);
    expect(manifest.sources.every((source) => source.included)).toBe(true);
    expect(manifest.appVersion).toBeTruthy();

    // No text entry may contain any secret fixture.
    for (const entry of entries) {
      if (typeof entry.content === "string") {
        expect(entry.content).not.toContain(HA_TOKEN);
        expect(entry.content).not.toContain(MQTT_PASSWORD);
        expect(entry.content).not.toContain(MQTT_USER);
        expect(entry.content).not.toContain(UI_MQTT_PASSWORD);
        expect(entry.content).not.toContain(UI_MQTT_USER);
      }
    }

    // The database copy must have the credential scrubbed from app_settings.
    const dbEntry = entries.find((entry) => entry.name === "luftator.db");
    expect(dbEntry).toBeDefined();
    expect(Buffer.isBuffer(dbEntry!.content)).toBe(true);

    const dir = mkdtempSync(path.join(tmpdir(), "luftator-bundle-verify-"));
    const verifyPath = path.join(dir, "copy.db");
    try {
      writeFileSync(verifyPath, dbEntry!.content as Buffer);
      const verifyDb = new DatabaseConstructor(verifyPath, { readonly: true });
      try {
        const row = verifyDb
          .prepare("SELECT value FROM app_settings WHERE key = ?")
          .get("mqtt.settings") as { value: string } | undefined;
        expect(row?.value).toBeDefined();
        expect(row!.value).not.toContain(UI_MQTT_PASSWORD);
        expect(row!.value).not.toContain(UI_MQTT_USER);
      } finally {
        verifyDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
