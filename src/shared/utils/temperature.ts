/** How temperatures are shown. Every value is stored and sent in °C; only the display converts. */
export type TemperatureUnit = "celsius" | "fahrenheit";

export function isTemperatureUnit(value: unknown): value is TemperatureUnit {
  return value === "celsius" || value === "fahrenheit";
}

/** °C → the display unit. */
export function fromCelsius(celsius: number, unit: TemperatureUnit): number {
  return unit === "fahrenheit" ? (celsius * 9) / 5 + 32 : celsius;
}

/** The display unit → °C, for values typed into a form. */
export function toCelsius(value: number, unit: TemperatureUnit): number {
  return unit === "fahrenheit" ? ((value - 32) * 5) / 9 : value;
}

export function temperatureLabel(unit: TemperatureUnit): string {
  return unit === "fahrenheit" ? "°F" : "°C";
}
