export type Activity = "sleeping" | "sitting" | "active";

export interface SimSettings {
  enginePeriodS: number;
  sensorIntervalS: number;
  sensorNoise: boolean;
  sensorNoiseSigmaPpm: number;
  outdoorCo2Ppm: number;
  infiltrationAch: number;
  co2PerPersonLph: Record<Activity, number>;
  valveFullyClosedPosition: number;
  valveHalfClosedFlowShare: number;
}

export const DEFAULT_SIM_SETTINGS: Readonly<SimSettings> = {
  enginePeriodS: 1,
  sensorIntervalS: 30,
  sensorNoise: false,
  sensorNoiseSigmaPpm: 15,
  outdoorCo2Ppm: 420,
  infiltrationAch: 0.1,
  co2PerPersonLph: { sleeping: 13, sitting: 19, active: 30 },
  valveFullyClosedPosition: 90,
  valveHalfClosedFlowShare: 0.25,
};

export const DEFAULT_ROOM_HEIGHT_M = 2.6;
export const DEFAULT_INITIAL_CO2_PPM = 500;
export const HISTORY_SAMPLE_S = 10;
export const HISTORY_LENGTH = 8640;
export const LOG_LIMIT = 1000;
