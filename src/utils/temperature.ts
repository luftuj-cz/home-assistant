export type TemperatureUnit = "c" | "f";

/**
 * Converts temperature from Celsius to Fahrenheit if needed.
 * @param celsius Temperature in Celsius
 * @param unit Target unit ("c" or "f")
 * @returns Converted temperature
 */
export function formatTemperature(celsius: number, unit: TemperatureUnit = "c"): number {
  if (unit === "f") {
    return (celsius * 9) / 5 + 32;
  }
  return celsius;
}

/**
 * Parses temperature from the target unit back to Celsius.
 * @param value Temperature in the given unit
 * @param unit Source unit ("c" or "f")
 * @returns Temperature in Celsius
 */
export function parseTemperature(value: number, unit: TemperatureUnit = "c"): number {
  if (unit === "f") {
    return ((value - 32) * 5) / 9;
  }
  return value;
}

/**
 * Gets the localized unit label.
 */
export function getTemperatureLabel(unit: TemperatureUnit = "c"): string {
  return unit === "f" ? "°F" : "°C";
}
