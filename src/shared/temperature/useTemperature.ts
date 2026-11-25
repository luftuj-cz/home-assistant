import { useContext } from "react";

import { fromCelsius, temperatureLabel, toCelsius } from "@luftuj/shared/utils/temperature";

import { TemperatureContext } from "./temperatureContext";

/**
 * The display unit and its conversions. `show(°C)` gives the number to print, `label` "°C" or "°F", `parse(n)`
 * turns a number typed in the display unit back into °C.
 */
export function useTemperature() {
  const context = useContext(TemperatureContext);
  const unit = context?.unit ?? "celsius";
  return {
    unit,
    setUnit: context?.setUnit ?? (() => undefined),
    label: temperatureLabel(unit),
    show: (celsius: number) => fromCelsius(celsius, unit),
    parse: (value: number) => toCelsius(value, unit),
  };
}
