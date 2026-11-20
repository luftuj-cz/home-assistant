import { describe, expect, test } from "vitest";

import { Timestamp } from "../src/index.js";
import { createHouse, type House } from "./house.js";

const DAY_MAXIMUM = 10;
const NIGHT_MAXIMUM = 5;

function secondOfDay(hours: number, minutes = 0, seconds = 0): number {
  return hours * 3600 + minutes * 60 + seconds;
}

function maximumAt(house: House, second: number): number {
  return house.engine.run(new Timestamp(0, second)).maxPower;
}

describe("day window", () => {
  test("the usual window counts both of its ends as day", () => {
    const house = createHouse();

    expect(maximumAt(house, secondOfDay(22))).toBe(DAY_MAXIMUM);
    expect(maximumAt(house, secondOfDay(22, 0, 1))).toBe(NIGHT_MAXIMUM);
    expect(maximumAt(house, secondOfDay(6))).toBe(NIGHT_MAXIMUM);
    expect(maximumAt(house, secondOfDay(7))).toBe(DAY_MAXIMUM);
  });

  test("a day through midnight puts the night in the middle of the day", () => {
    const house = createHouse();
    house.engine.dayStart = secondOfDay(14);
    house.engine.dayEnd = secondOfDay(6);

    expect(maximumAt(house, secondOfDay(23))).toBe(DAY_MAXIMUM);
    expect(maximumAt(house, secondOfDay(3))).toBe(DAY_MAXIMUM);
    expect(maximumAt(house, secondOfDay(10))).toBe(NIGHT_MAXIMUM);
  });

  test("a day through midnight counts both of its ends as day", () => {
    const house = createHouse();
    house.engine.dayStart = secondOfDay(14);
    house.engine.dayEnd = secondOfDay(6);

    expect(maximumAt(house, secondOfDay(6))).toBe(DAY_MAXIMUM);
    expect(maximumAt(house, secondOfDay(6, 0, 1))).toBe(NIGHT_MAXIMUM);
    expect(maximumAt(house, secondOfDay(13, 59, 59))).toBe(NIGHT_MAXIMUM);
    expect(maximumAt(house, secondOfDay(14))).toBe(DAY_MAXIMUM);
  });

  test("the power maximum follows the window", () => {
    const house = createHouse({ hru: 10 });
    house.engine.dayStart = secondOfDay(14);
    house.engine.dayEnd = secondOfDay(6);
    house.sensors.forEach((sensor) => {
      sensor.co2 = 1000;
    });

    const inTheNight = house.engine.run(new Timestamp(0, secondOfDay(10)));

    expect(inTheNight.powerAfter).toBe(NIGHT_MAXIMUM);
  });
});
