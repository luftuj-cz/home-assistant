import { createContext } from "react";

import type { TemperatureUnit } from "@luftuj/shared/utils/temperature";

export interface TemperatureContextValue {
  unit: TemperatureUnit;
  setUnit: (unit: TemperatureUnit) => void;
}

export const TemperatureContext = createContext<TemperatureContextValue | null>(null);
