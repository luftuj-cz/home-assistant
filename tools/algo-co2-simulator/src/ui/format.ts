import type { DecisionBranch, PowerReview } from "../core/engine.ts";

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

/**
 * A power review in words: which lane, what it decided, and for which rooms. A step that the maximum
 * capped still reads as "přidat"; the power change next to it shows whether anything moved.
 */
export function reviewLabel(review: PowerReview, roomNames: ReadonlyMap<string, string>): string {
  const lane = review.lane === "fast" ? "rychlá" : "pomalá";
  function names(ids: string[]): string {
    return ids.map((id) => roomNames.get(id) ?? id).join(", ");
  }
  if (review.raised) {
    return `kontrola výkonu (${lane}): přidat, žádá ${names(review.asked)}`;
  }
  const held = review.held.length > 0 ? `, ${names(review.held)}` : "";
  return `kontrola výkonu (${lane}): držet${held}`;
}

const ENGINE_MESSAGE_PREFIX = /^\[[^\]]*] /;
const THRESHOLD_MESSAGE =
  /^CO2 in room (\S+) (exceeded|recovered under) threshold (\w+): \((.+)\)$/;
const FLUCTUATION_MESSAGE = /^fluctuation (on|off)$/;

/**
 * An engine log message in Czech, without the engine's own clock prefix. The engine writes its
 * messages in English with room ids; a message this does not know is passed through as it is.
 */
export function engineMessageLabel(
  message: string,
  roomNames: ReadonlyMap<string, string>,
): string {
  const text = message.replace(ENGINE_MESSAGE_PREFIX, "");
  const threshold = THRESHOLD_MESSAGE.exec(text);
  if (threshold !== null) {
    const [, roomId = "", verb, type = "", comparison = ""] = threshold;
    const room = roomNames.get(roomId) ?? roomId;
    const values = comparison.replace(">=", " ≥ ").replace("<", " < ");
    const what = verb === "exceeded" ? "CO2 nad" : "CO2 zpět pod";
    return `${room}: ${what} ${type.toUpperCase()} (${values})`;
  }
  const fluctuation = FLUCTUATION_MESSAGE.exec(text);
  if (fluctuation !== null) {
    return `Pohyb osob: ${fluctuation[1] === "on" ? "zapnuto" : "vypnuto"}`;
  }
  return text;
}
