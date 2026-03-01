export function resolveModeValue(values: Record<number, string>, mode: number | string) {
  if (typeof mode === "number") {
    return mode;
  }
  const entry = Object.entries(values).find(([, name]) => name === mode);
  if (entry) {
    return Number(entry[0]);
  }
  const parsed = Number.parseInt(String(mode), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
