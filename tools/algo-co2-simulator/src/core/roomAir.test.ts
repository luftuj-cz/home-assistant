import { describe, expect, test } from "vitest";

import { DEFAULT_SIM_SETTINGS } from "./settings.ts";
import { generationM3h, stepRoomAir, type RoomAirState } from "./roomAir.ts";

const OUTDOOR_PPM = 420;
const SECONDS_PER_HOUR = 3600;

function step(room: RoomAirState): RoomAirState {
  const next = stepRoomAir([room], 1, OUTDOOR_PPM).get(room.id);
  if (next === undefined) {
    throw new Error("room missing from step result");
  }
  return { ...room, co2Ppm: next };
}

function bedroom(overrides: Partial<RoomAirState> = {}): RoomAirState {
  const volumeM3 = 14 * 2.6;
  return {
    id: "bedroom",
    volumeM3,
    co2Ppm: OUTDOOR_PPM,
    generationM3h: generationM3h(2, "sleeping", DEFAULT_SIM_SETTINGS.co2PerPersonLph),
    supplyM3h: 0,
    exhaustM3h: 0,
    infiltrationM3h: 0.1 * volumeM3,
    ...overrides,
  };
}

describe("generationM3h", () => {
  test("converts litres per hour per person to m³/h", () => {
    expect(generationM3h(2, "sleeping", DEFAULT_SIM_SETTINGS.co2PerPersonLph)).toBeCloseTo(
      0.026,
      10,
    );
    expect(generationM3h(0, "active", DEFAULT_SIM_SETTINGS.co2PerPersonLph)).toBe(0);
  });
});

describe("stepRoomAir", () => {
  test("two sleepers in a closed 36 m³ bedroom reach 1200 ppm in 1.1–1.2 h", () => {
    let room = bedroom();
    let reachedAtS = -1;

    for (let second = 1; second <= 2 * SECONDS_PER_HOUR; second++) {
      room = step(room);
      if (room.co2Ppm >= 1200) {
        reachedAtS = second;
        break;
      }
    }

    expect(reachedAtS).toBeGreaterThanOrEqual(3960);
    expect(reachedAtS).toBeLessThanOrEqual(4320);
  });

  test("30 m³/h of fresh air settles near 1287 ppm", () => {
    let room = bedroom({ supplyM3h: 30, infiltrationM3h: 0 });

    for (let second = 0; second < 24 * SECONDS_PER_HOUR; second++) {
      room = step(room);
    }

    expect(Math.abs(room.co2Ppm - 1286.7)).toBeLessThan(5);
  });

  test("an empty room decays to outdoor and never below", () => {
    let room = bedroom({ generationM3h: 0, supplyM3h: 100, infiltrationM3h: 0, co2Ppm: 1500 });
    let lowest = room.co2Ppm;

    for (let second = 0; second < 24 * SECONDS_PER_HOUR; second++) {
      room = step(room);
      lowest = Math.min(lowest, room.co2Ppm);
    }

    expect(lowest).toBeGreaterThanOrEqual(OUTDOOR_PPM);
    expect(Math.abs(room.co2Ppm - OUTDOOR_PPM)).toBeLessThan(1);
  });

  test("an exhaust-only room receives transfer air", () => {
    const supplied: RoomAirState = {
      id: "a",
      volumeM3: 50,
      co2Ppm: 800,
      generationM3h: 0,
      supplyM3h: 100,
      exhaustM3h: 0,
      infiltrationM3h: 0,
    };
    const exhausted: RoomAirState = {
      id: "b",
      volumeM3: 10,
      co2Ppm: 420,
      generationM3h: 0,
      supplyM3h: 0,
      exhaustM3h: 100,
      infiltrationM3h: 0,
    };

    const next = stepRoomAir([supplied, exhausted], 1, OUTDOOR_PPM);

    expect(next.get("b")).toBeCloseTo(420 + 38000 / 36000, 8);
  });

  test("a room without valves exchanges only through infiltration", () => {
    const room = bedroom({ generationM3h: 0, co2Ppm: 1000 });

    const next = step(room).co2Ppm;

    const expected = 1000 + ((1 / SECONDS_PER_HOUR) * (420 - 1000) * room.infiltrationM3h) / 36.4;
    expect(next).toBeCloseTo(expected, 10);
    expect(next).toBeLessThan(1000);
  });

  test("extreme occupancy stays finite", () => {
    let room: RoomAirState = {
      id: "crowded",
      volumeM3: 10,
      co2Ppm: OUTDOOR_PPM,
      generationM3h: generationM3h(20, "active", DEFAULT_SIM_SETTINGS.co2PerPersonLph),
      supplyM3h: 0,
      exhaustM3h: 0,
      infiltrationM3h: 1,
    };

    for (let second = 0; second < 24 * SECONDS_PER_HOUR; second++) {
      room = step(room);
    }

    expect(Number.isFinite(room.co2Ppm)).toBe(true);
  });
});
