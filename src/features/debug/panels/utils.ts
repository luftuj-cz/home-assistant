export type DebugPayload = Record<string, unknown>;

export type DebugRow = {
  key: string;
  value: string;
};

export type ServerLogEntry = {
  timestamp: string;
  level: string;
  message: string;
  context?: string;
  line: string;
};

export function isBytePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.startsWith("app.memory.") || normalized.endsWith("bytes");
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return String(bytes);
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.abs(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const signedValue = bytes < 0 ? -value : value;
  const precision = unitIndex === 0 ? 0 : signedValue >= 10 ? 1 : 2;
  const human = `${signedValue.toFixed(precision)} ${units[unitIndex]}`;
  return `${human} (${Math.round(bytes).toLocaleString()} B)`;
}

export function formatDebugValue(value: unknown, path: string): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "number" && isBytePath(path)) {
    return formatByteSize(value);
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectDebugRows(value: unknown, path: string, rows: DebugRow[]): void {
  if (value === null || value === undefined) {
    rows.push({ key: path, value: formatDebugValue(value, path) });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push({ key: path, value: "[]" });
      return;
    }
    value.forEach((item, index) => {
      collectDebugRows(item, `${path}[${index}]`, rows);
    });
    return;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      rows.push({ key: path, value: "{}" });
      return;
    }
    entries.forEach(([key, nested]) => {
      const nextPath = path ? `${path}.${key}` : key;
      collectDebugRows(nested, nextPath, rows);
    });
    return;
  }

  rows.push({ key: path, value: formatDebugValue(value, path) });
}

export function flattenDebugRows(payload: DebugPayload | null): DebugRow[] {
  if (!payload) {
    return [];
  }

  const rows: DebugRow[] = [];
  collectDebugRows(payload, "", rows);
  return rows
    .filter((item) => item.key.trim().length > 0)
    .toSorted((a, b) => a.key.localeCompare(b.key));
}

export function formatTimestamp(value: string): string {
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? value : asDate.toLocaleString();
}

export function getLogLevelColor(level: string): string {
  const normalized = level.toLowerCase();
  if (normalized === "fatal" || normalized === "error") {
    return "red";
  }
  if (normalized === "warn") {
    return "yellow";
  }
  if (normalized === "info") {
    return "blue";
  }
  if (normalized === "debug") {
    return "teal";
  }
  return "gray";
}

export function formatLogContext(context?: string): string {
  if (!context) {
    return "";
  }

  try {
    const parsed = JSON.parse(context) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return context;
  }
}
