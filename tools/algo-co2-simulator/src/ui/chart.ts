import type { HistorySample } from "../core/simulation.ts";
import { HISTORY_SAMPLE_S } from "../core/settings.ts";

export interface Domain {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const CO2_AXIS_MIN_PPM = 400;

const SECONDS_PER_DAY = 86400;
const CO2_AXIS_MIN_TOP_PPM = 1600;
const FIRST_TICK_STEP_PPM = 400;
const MAX_TICKS = 6;

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The samples from `windowS` seconds before `nowEpoch` up to `nowEpoch`, oldest first. */
export function windowSamples(
  history: readonly HistorySample[],
  nowEpoch: number,
  windowS: number,
): HistorySample[] {
  const from = nowEpoch - windowS;
  return history.filter((entry) => entry.epochSecond >= from && entry.epochSecond <= nowEpoch);
}

/**
 * At most `maxPoints + 1` samples: every n-th one, always including the newest. The pick follows
 * the sample's own epoch, not its position, so the same samples stay chosen as the window slides
 * and the line does not shimmer.
 */
export function thinSamples(samples: readonly HistorySample[], maxPoints: number): HistorySample[] {
  if (samples.length <= maxPoints) {
    return [...samples];
  }
  const stride = Math.ceil(samples.length / maxPoints);
  const last = samples.length - 1;
  return samples.filter(
    (entry, index) =>
      index === last || Math.round(entry.epochSecond / HISTORY_SAMPLE_S) % stride === 0,
  );
}

export function scaleX(x: number, domain: Domain, width: number): number {
  return ((x - domain.x0) / (domain.x1 - domain.x0)) * width;
}

/** Y points up in the data and down in the SVG box, so the result is measured from the top. */
export function scaleY(y: number, domain: Domain, height: number): number {
  return height - ((y - domain.y0) / (domain.y1 - domain.y0)) * height;
}

/** An SVG `points` value for data in `domain`, drawn into a box `size` wide with y pointing up. */
export function polylinePoints(
  points: readonly { x: number; y: number }[],
  domain: Domain,
  size: { w: number; h: number },
): string {
  return points
    .map(
      (point) =>
        `${rounded(scaleX(point.x, domain, size.w))},${rounded(scaleY(point.y, domain, size.h))}`,
    )
    .join(" ");
}

/** The top of the CO2 axis: 1600 ppm, or the highest value of any room if that is more. */
export function co2YMax(samples: readonly HistorySample[]): number {
  let highest = CO2_AXIS_MIN_TOP_PPM;
  for (const entry of samples) {
    for (const ppm of Object.values(entry.co2Ppm)) {
      highest = Math.max(highest, ppm);
    }
  }
  return highest;
}

/** Round axis values inside [y0, y1], with a step of 400 doubled until at most six fit. */
export function yTicks(y0: number, y1: number): number[] {
  let step = FIRST_TICK_STEP_PPM;
  while ((y1 - y0) / step > MAX_TICKS) {
    step *= 2;
  }
  const ticks: number[] = [];
  for (let value = Math.ceil(y0 / step) * step; value <= y1; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/** The second of the day `epochSecond` falls on, for a run that began at `startSecondOfDay`. */
export function clockSecond(startSecondOfDay: number, epochSecond: number): number {
  return (((startSecondOfDay + epochSecond) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}
