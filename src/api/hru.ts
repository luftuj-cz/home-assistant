import { resolveApiUrl } from "../utils/api";

export interface HruRegister {
  address: number;
  kind: "holding" | "input";
  scale?: number;
  precision?: number;
  unit?: string;
  maxValue?: number;
}

export interface HruUnit {
  id: string;
  name: string;
  isConfigurable?: boolean;
  maxValue?: number;
  controlUnit?: string;
  capabilities?: {
    hasPowerControl?: boolean;
    hasTemperatureControl?: boolean;
    hasModeControl?: boolean;
  };
  registers?: {
    read?: {
      power?: HruRegister;
      temperature?: HruRegister;
      mode?: { values?: Record<number, string> };
    };
  };
}

export async function fetchHruUnits(): Promise<HruUnit[]> {
  const res = await fetch(resolveApiUrl("/api/hru/units"));
  if (!res.ok) throw new Error("Failed to fetch HRU units");
  return res.json();
}
