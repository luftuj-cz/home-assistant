import fs from "node:fs";
import { isValveAvailable } from "../../core/valveAvailability.js";
import type { ValveController } from "../../core/valveManager.js";
import type { HomeAssistantClient } from "../../services/homeAssistantClient.js";
import type { MqttService } from "../../services/mqttService.js";
import { getAllAppSettings, getAppSetting, getDatabasePath } from "../../services/database.js";
import { getServerLogBufferSize } from "../../logger.js";
import { APP_VERSION } from "../../constants.js";
import { HRU_SETTINGS_KEY, type HruSettings } from "../../types/index.js";

/**
 * Read the persisted HRU settings blob, tolerating a missing or corrupt value.
 * Shared by the status routes and the bug-report bundle.
 */
export function loadSavedHruSettings(): HruSettings | null {
  try {
    const raw = getAppSetting(HRU_SETTINGS_KEY);
    return raw ? (JSON.parse(String(raw)) as HruSettings) : null;
  } catch {
    return null;
  }
}

export type ActiveTimelineState = { source: string; modeName?: string | number } | null;

export type TimelineSchedulerLike = {
  getActiveState: () => ActiveTimelineState;
  getBoostRemainingMinutes?: () => number;
  getActiveBoostName?: () => string | null;
  getFormattedActiveMode?: () => string;
};

export type DiagnosticsDeps = {
  valveManager: ValveController;
  haClient: HomeAssistantClient | null;
  mqttService: MqttService;
  timelineScheduler: TimelineSchedulerLike;
  baseUrl: string;
  appStartedAt: Date;
};

export function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0 || days > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

export function resolveHassHost(baseUrl: string): string {
  if (baseUrl && baseUrl !== "http://supervisor/core") {
    const url = new URL(baseUrl);
    return url.hostname;
  }
  if (baseUrl === "http://supervisor/core") {
    return "homeassistant.local";
  }
  return "localhost";
}

function parseSettings(settings: Record<string, string>): Record<string, unknown> {
  return Object.entries(settings).reduce<Record<string, unknown>>((acc, [key, value]) => {
    try {
      acc[key] = JSON.parse(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
}

export async function buildDebugSnapshot(deps: DiagnosticsDeps) {
  const { valveManager, haClient, mqttService, timelineScheduler, baseUrl, appStartedAt } = deps;

  const snapshot = await valveManager.getSnapshot();
  const unavailableEntities = snapshot
    .filter((item) => !isValveAvailable(item))
    .map((item) => item.entity_id);
  const timelineState = timelineScheduler.getActiveState();
  const allSettings = getAllAppSettings();
  const parsedSettings = parseSettings(allSettings);

  const now = new Date();
  const appUptimeSeconds = Math.max(0, Math.floor((now.getTime() - appStartedAt.getTime()) / 1000));
  const processUptimeSeconds = Math.max(0, Math.floor(process.uptime()));

  const dbPath = getDatabasePath();
  const dbExists = fs.existsSync(dbPath);
  const dbStat = dbExists ? fs.statSync(dbPath) : null;
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  const mqttLastSuccessAtMs = mqttService.getLastSuccessAt();
  const mqttDebugStatus = mqttService.getStatus();
  const logBufferSize = getServerLogBufferSize();

  return {
    capturedAt: now.toISOString(),
    app: {
      version: APP_VERSION,
      startedAt: appStartedAt.toISOString(),
      uptimeSeconds: appUptimeSeconds,
      uptimeHuman: formatDuration(appUptimeSeconds),
      processUptimeSeconds,
      processUptimeHuman: formatDuration(processUptimeSeconds),
      pid: process.pid,
      ppid: process.ppid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      memory: process.memoryUsage(),
    },
    system: {
      hassBaseUrl: baseUrl,
      hassHost: resolveHassHost(baseUrl),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    services: {
      homeAssistant: {
        configured: haClient !== null,
        connection: haClient ? haClient.getConnectionState() : "offline",
      },
      mqtt: {
        ...mqttDebugStatus,
        connection: mqttDebugStatus.connected ? "connected" : "disconnected",
        lastDiscovery: mqttService.getLastDiscoveryTime(),
        lastSuccessAtMs: mqttLastSuccessAtMs,
        lastSuccessAt:
          mqttLastSuccessAtMs === null ? null : new Date(mqttLastSuccessAtMs).toISOString(),
      },
      timeline: {
        activeState: timelineState,
        formattedActiveMode: timelineScheduler.getFormattedActiveMode?.() ?? null,
        boostRemainingMinutes: timelineScheduler.getBoostRemainingMinutes?.() ?? null,
        activeBoostName: timelineScheduler.getActiveBoostName?.() ?? null,
      },
      valves: {
        total: snapshot.length,
        unavailableCount: unavailableEntities.length,
        unavailableEntities,
      },
    },
    database: {
      path: dbPath,
      exists: dbExists,
      sizeBytes: dbStat?.size ?? null,
      modifiedAt: dbStat?.mtime.toISOString() ?? null,
      walExists: fs.existsSync(walPath),
      shmExists: fs.existsSync(shmPath),
    },
    logs: {
      bufferedCount: logBufferSize,
      maxBufferedCount: 1_000,
    },
    settings: {
      raw: allSettings,
      parsed: parsedSettings,
    },
  };
}

export async function buildHomeAssistantApiSnapshot(haClient: HomeAssistantClient | null) {
  const capturedAt = new Date().toISOString();

  if (!haClient) {
    return {
      capturedAt,
      available: false,
      connection: "offline",
      detail: "Home Assistant client is not configured",
    };
  }

  const [config, luftatorEntities] = await Promise.all([
    haClient.fetchConfig(),
    haClient.fetchLuftatorEntities(),
  ]);

  return {
    capturedAt,
    available: true,
    connection: haClient.getConnectionState(),
    config,
    luftatorEntityCount: luftatorEntities.length,
    luftatorEntities,
  };
}

export async function buildHomeAssistantEntitiesSnapshot(haClient: HomeAssistantClient | null) {
  const capturedAt = new Date().toISOString();

  if (!haClient) {
    return {
      capturedAt,
      available: false,
      connection: "offline",
      detail: "Home Assistant client is not configured",
      entities: [],
    };
  }

  const states = await haClient.fetchAllStates();
  const entities = states.map((entity) => {
    const attributes = entity.attributes ?? {};
    const friendly = attributes.friendly_name;
    const unit = attributes.unit_of_measurement;
    const deviceClass = attributes.device_class;
    return {
      entityId: entity.entity_id,
      domain: entity.entity_id.split(".")[0] ?? "",
      state: entity.state,
      friendlyName: typeof friendly === "string" && friendly ? friendly : entity.entity_id,
      unit: typeof unit === "string" ? unit : null,
      deviceClass: typeof deviceClass === "string" ? deviceClass : null,
      attributes,
      lastChanged: entity.last_changed ?? null,
    };
  });

  return {
    capturedAt,
    available: true,
    connection: haClient.getConnectionState(),
    entityCount: entities.length,
    entities,
  };
}
