import { useTranslation } from "react-i18next";

import { useBackendSnapshot } from "@luftuj/features/debug/hooks/useDebugData";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import { StatStrip, type StatItem } from "@luftuj/shared/ui/stat-strip";

/** Reads `a.b.c` from the snapshot without trusting its shape. */
function pick(source: unknown, path: string): unknown {
  let node = source;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown) {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The six facts above the workbench, from the same `/api/debug` snapshot the Inspector shows: version, uptime,
 * memory, Home Assistant, MQTT and valves.
 */
export function DebugStats() {
  const { t, i18n } = useTranslation();
  const { data } = useBackendSnapshot();

  if (!data) return <Skeleton className="h-[86px] rounded-xl" />;

  const uptime = asNumber(pick(data, "app.uptimeSeconds")) ?? 0;
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  let uptimeLabel = t("debug.stats.uptimeMinutes", { minutes, seconds: Math.floor(uptime % 60) });
  if (days > 0) uptimeLabel = t("debug.stats.uptimeDays", { days, hours });
  else if (hours > 0) uptimeLabel = t("debug.stats.uptimeHours", { hours, minutes });

  const startedAt = asString(pick(data, "app.startedAt"));
  const started = startedAt
    ? new Date(startedAt).toLocaleString(i18n.language, {
        day: "numeric",
        month: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : undefined;

  const rss = asNumber(pick(data, "app.memory.rss"));

  const haConfigured = pick(data, "services.homeAssistant.configured") === true;
  const haConnected = pick(data, "services.homeAssistant.connection") === "connected";
  let ha: Pick<StatItem, "value" | "tone"> = { value: t("debug.stats.notConfigured") };
  if (haConfigured) {
    ha = haConnected
      ? { value: t("debug.stats.connected"), tone: "success" }
      : { value: t("debug.stats.disconnected"), tone: "destructive" };
  }

  const mqttEnabled = pick(data, "settings.mqtt.settings.enabled") === true;
  const mqttConnected = pick(data, "services.mqtt.connected") === true;
  const lastDiscovery = asString(pick(data, "services.mqtt.lastDiscovery"));
  let mqtt: Pick<StatItem, "value" | "tone"> = { value: t("debug.stats.off") };
  if (mqttEnabled) {
    mqtt = mqttConnected
      ? { value: t("debug.stats.connected"), tone: "success" }
      : { value: t("debug.stats.disconnected"), tone: "destructive" };
  }

  const valves = asNumber(pick(data, "services.valves.total")) ?? 0;
  const unavailable = asNumber(pick(data, "services.valves.unavailableCount")) ?? 0;

  const items: StatItem[] = [
    {
      legend: t("debug.stats.version"),
      value: asString(pick(data, "app.version")) ?? "—",
      hint: [asString(pick(data, "app.nodeVersion")), asString(pick(data, "app.arch"))]
        .filter(Boolean)
        .map((part, index) => (index === 0 ? `Node ${part}` : part))
        .join(" · "),
    },
    {
      legend: t("debug.stats.uptime"),
      value: uptimeLabel,
      hint: started ? t("debug.stats.since", { time: started }) : undefined,
    },
    {
      legend: t("debug.stats.memory"),
      value: rss === undefined ? "—" : (rss / 1024 / 1024).toFixed(1),
      unit: rss === undefined ? undefined : "MiB",
      hint: "RSS",
    },
    { legend: "Home Assistant", ...ha },
    {
      legend: "MQTT",
      ...mqtt,
      hint:
        mqttEnabled && lastDiscovery
          ? t("debug.stats.discovery", {
              time: new Date(lastDiscovery).toLocaleTimeString(i18n.language, {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })
          : undefined,
    },
    {
      legend: t("debug.stats.valves"),
      value: String(valves),
      tone: unavailable > 0 ? "warning" : undefined,
      hint: unavailable > 0 ? t("debug.stats.unavailable", { count: unavailable }) : undefined,
    },
  ];

  return <StatStrip items={items} />;
}
