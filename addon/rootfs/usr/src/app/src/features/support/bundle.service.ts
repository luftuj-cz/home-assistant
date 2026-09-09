import type { Archiver } from "archiver";
import DatabaseConstructor from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/options.js";
import { APP_VERSION } from "../../constants.js";
import { checkpointDatabase, getAllAppSettings, getDatabasePath } from "../../services/database.js";
import { getRecentServerLogs } from "../../logger.js";
import { getModbusStatusFor } from "../../shared/modbus/client.js";
import {
  buildDebugSnapshot,
  buildHomeAssistantApiSnapshot,
  type DiagnosticsDeps,
  loadSavedHruSettings,
} from "./diagnostics.js";
import { collectSecrets, maskConfig, redactSecrets } from "./redact.js";

export const BUNDLE_SCHEMA_VERSION = 1;

export type BundleDeps = {
  diagnostics: DiagnosticsDeps;
  config: AppConfig;
  logger: Logger;
};

type ManifestEntry = { source: string; file: string; included: boolean; error?: string };

export type BundleManifest = {
  bundleSchemaVersion: number;
  appVersion: string;
  generatedAt: string;
  sources: ManifestEntry[];
};

/**
 * Copy the live SQLite database into a throwaway file and scrub any
 * credential-bearing values out of its `app_settings` table. The live
 * database is never modified.
 *
 * Returns a stream over the redacted copy rather than its contents: the
 * database may be tens or hundreds of megabytes (import allows 200 MB) and the
 * add-on runs in a memory-limited container, so reading it whole could take
 * down the very add-on the user is filing a report about. The temporary file is
 * removed once the stream closes, i.e. after the archive has consumed it.
 */
function buildRedactedDbCopy(secrets: string[], logger: Logger): Readable {
  const sourcePath = getDatabasePath();
  if (!fs.existsSync(sourcePath)) {
    throw new Error("Database file not found");
  }

  // Fold the WAL into the main file so the copy is self-contained.
  checkpointDatabase(logger);

  const copyPath = path.join(
    os.tmpdir(),
    `luftator-bundle-${process.pid}-${process.hrtime.bigint()}.db`,
  );
  fs.copyFileSync(sourcePath, copyPath);

  try {
    const db = new DatabaseConstructor(copyPath);
    try {
      const rows = db.prepare("SELECT key, value FROM app_settings").all() as {
        key: string;
        value: string;
      }[];
      const update = db.prepare("UPDATE app_settings SET value = ? WHERE key = ?");
      for (const row of rows) {
        let redactedValue: string;
        try {
          const parsed = JSON.parse(row.value);
          redactedValue = JSON.stringify(redactSecrets(parsed, secrets));
        } catch {
          redactedValue = redactSecrets(row.value, secrets);
        }
        if (redactedValue !== row.value) {
          update.run(redactedValue, row.key);
        }
      }
    } finally {
      db.close();
    }
  } catch (error) {
    removeQuietly(copyPath, logger);
    throw error;
  }

  const stream = fs.createReadStream(copyPath);
  // Unlink as soon as the file is open: on Linux (the only platform the add-on
  // runs on) the data stays readable through the open descriptor and the file
  // disappears the moment it closes - however the stream ends, including a
  // download aborted mid-transfer. Where an open file cannot be unlinked the
  // attempt is logged and the close handler removes it instead.
  let removed = false;
  stream.once("open", () => {
    removed = removeQuietly(copyPath, logger);
  });
  stream.once("close", () => {
    if (!removed) removeQuietly(copyPath, logger);
  });
  return stream;
}

function removeQuietly(filePath: string, logger: Logger): boolean {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    logger.warn({ error }, "Failed to remove temporary bundle database copy");
    return false;
  }
}

function readStoredSettings(logger: Logger): Record<string, string> {
  try {
    return getAllAppSettings();
  } catch (error) {
    logger.warn({ error }, "Could not read stored settings for secret collection");
    return {};
  }
}

/**
 * Assemble the bug-report bundle into the given archiver instance. Each source
 * is gathered best-effort: a failure is recorded in the manifest and the rest
 * of the bundle is still produced. No secret ever enters the archive.
 */
export async function buildBugReportBundle(
  deps: BundleDeps,
  archive: Archiver,
): Promise<BundleManifest> {
  const { diagnostics, config, logger } = deps;
  const secrets = collectSecrets(config, readStoredSettings(logger));
  const sources: ManifestEntry[] = [];

  async function addSource(
    source: string,
    file: string,
    produce: () => Promise<string | Buffer | Readable> | string | Buffer | Readable,
  ): Promise<void> {
    try {
      const content = await produce();
      archive.append(content, { name: file });
      sources.push({ source, file, included: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error, source }, "Bug report bundle source failed");
      sources.push({ source, file, included: false, error: message });
    }
  }

  await addSource("debug-snapshot", "debug-snapshot.json", async () => {
    const snapshot = await buildDebugSnapshot(diagnostics);
    return JSON.stringify(redactSecrets(snapshot, secrets), null, 2);
  });

  await addSource("server-logs", "server-logs.log", () => {
    const text = getRecentServerLogs(1_000)
      .map((entry) => entry.line)
      .join("\n");
    return redactSecrets(text, secrets);
  });

  await addSource("home-assistant", "home-assistant.json", async () => {
    const snapshot = await buildHomeAssistantApiSnapshot(diagnostics.haClient);
    return JSON.stringify(redactSecrets(snapshot, secrets), null, 2);
  });

  await addSource("connections", "connections.json", () => {
    const savedHru = loadSavedHruSettings();
    const modbus = savedHru?.host
      ? getModbusStatusFor({
          host: savedHru.host,
          port: savedHru.port ?? 502,
          unitId: savedHru.unitId ?? 1,
        })
      : null;
    const payload = {
      capturedAt: new Date().toISOString(),
      mqtt: {
        host: config.mqtt.host,
        port: config.mqtt.port,
        ...diagnostics.mqttService.getStatus(),
        lastDiscovery: diagnostics.mqttService.getLastDiscoveryTime(),
        lastSuccessAtMs: diagnostics.mqttService.getLastSuccessAt(),
      },
      modbus: modbus ? { host: savedHru?.host, port: savedHru?.port ?? 502, ...modbus } : null,
    };
    return JSON.stringify(redactSecrets(payload, secrets), null, 2);
  });

  await addSource("config", "config.json", () => JSON.stringify(maskConfig(config), null, 2));

  await addSource("database", "luftator.db", () => buildRedactedDbCopy(secrets, logger));

  return {
    bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    generatedAt: new Date().toISOString(),
    sources,
  };
}
