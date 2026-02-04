export type TemperatureUnit = "c" | "f";

export function formatTemperature(celsius: number, unit: TemperatureUnit = "c"): number {
  if (unit === "f") {
    return (celsius * 9) / 5 + 32;
  }
  return celsius;
}

export function parseTemperature(value: number, unit: TemperatureUnit = "c"): number {
  if (unit === "f") {
    return ((value - 32) * 5) / 9;
  }
  return value;
}

export function getTemperatureLabel(unit: TemperatureUnit = "c"): string {
  return unit === "f" ? "°F" : "°C";
}
