export const SPEEDS = [1, 60, 600] as const;

/** Simulated seconds one frame may advance at most, so a hidden tab cannot freeze the page on return. */
export const MAX_STEPS_PER_FRAME = 3600;

/**
 * Whole simulated seconds due after `realDeltaMs` of real time at `speed`. The fraction of a
 * second that does not make a step yet is returned as `carryS` for the next frame.
 */
export function stepsForFrame(
  realDeltaMs: number,
  speed: number,
  carryS: number,
): { steps: number; carryS: number } {
  const dueS = carryS + (Math.max(0, realDeltaMs) / 1000) * speed;
  const steps = Math.floor(dueS);
  if (steps >= MAX_STEPS_PER_FRAME) {
    return { steps: MAX_STEPS_PER_FRAME, carryS: 0 };
  }
  return { steps, carryS: dueS - steps };
}
