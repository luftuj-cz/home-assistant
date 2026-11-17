import type { Activity } from "./settings.ts";

export interface RoomAirState {
  id: string;
  volumeM3: number;
  co2Ppm: number;
  generationM3h: number;
  supplyM3h: number;
  exhaustM3h: number;
  infiltrationM3h: number;
}

const SECONDS_PER_HOUR = 3600;
const PPM_PER_FRACTION = 1e6;

/** CO2 emitted by the occupants of a room, in m³/h. */
export function generationM3h(
  people: number,
  activity: Activity,
  co2PerPersonLph: Record<Activity, number>,
): number {
  return (people * co2PerPersonLph[activity]) / 1000;
}

/**
 * Advances every room by one explicit Euler step and returns the new concentrations by room id.
 * A room with an exhaust surplus draws transfer air, at the flow-weighted mean concentration
 * of the rooms with a supply surplus (outdoor air when there are none).
 */
export function stepRoomAir(
  rooms: readonly RoomAirState[],
  dtS: number,
  outdoorPpm: number,
): Map<string, number> {
  let surplusTotal = 0;
  let surplusWeighted = 0;
  for (const room of rooms) {
    const surplus = Math.max(0, room.supplyM3h - room.exhaustM3h);
    surplusTotal += surplus;
    surplusWeighted += surplus * room.co2Ppm;
  }
  const transferPpm = surplusTotal === 0 ? outdoorPpm : surplusWeighted / surplusTotal;

  const next = new Map<string, number>();
  for (const room of rooms) {
    const fresh = room.supplyM3h + room.infiltrationM3h;
    const transfer = Math.max(0, room.exhaustM3h - room.supplyM3h);
    const outflow = fresh + transfer;
    const rate =
      (room.generationM3h * PPM_PER_FRACTION +
        outdoorPpm * fresh +
        transferPpm * transfer -
        room.co2Ppm * outflow) /
      room.volumeM3;
    next.set(room.id, room.co2Ppm + (dtS / SECONDS_PER_HOUR) * rate);
  }
  return next;
}
