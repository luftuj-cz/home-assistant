import type { DecisionBranch } from "../core/engine.ts";

export type Co2Band = "ok" | "warn" | "bad" | "none";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** ok below TH1, warn from TH1 below TH2, bad from TH2; none without a reading. */
export function co2Band(ppm: number | null, th1: number, th2: number): Co2Band {
  if (ppm === null) {
    return "none";
  }
  if (ppm < th1) {
    return "ok";
  }
  return ppm < th2 ? "warn" : "bad";
}

export function formatClock(secondOfDay: number): string {
  const whole = Math.floor(secondOfDay);
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(whole % SECONDS_PER_MINUTE)}`;
}

export function formatHhMm(secondOfDay: number): string {
  return formatClock(secondOfDay).slice(0, 5);
}

/** The second of day for "HH:MM", or null when the text is not a time of day. */
export function parseHhMm(text: string): number | null {
  const match = TIME_OF_DAY.exec(text);
  if (match === null) {
    return null;
  }
  return Number(match[1]) * SECONDS_PER_HOUR + Number(match[2]) * SECONDS_PER_MINUTE;
}

/** "m:ss"; minutes are not wrapped into hours. */
export function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / SECONDS_PER_MINUTE)}:${twoDigits(whole % SECONDS_PER_MINUTE)}`;
}

export function branchLabel(branch: DecisionBranch): string {
  switch (branch) {
    case "th2":
      return "TH2";
    case "th1":
      return "TH1";
    case "fluctuation":
      return "Pohyb osob";
    case "allBelow":
      return "Vše pod TH1";
    case "none":
      return "Beze změny";
  }
}
