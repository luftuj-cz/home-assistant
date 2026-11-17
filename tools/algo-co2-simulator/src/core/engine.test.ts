import { describe, expect, test } from "vitest";

import {
  AutomaticModeEngine,
  Box,
  Building,
  Room,
  Sensor,
  Timestamp,
  Valve,
  ValveType,
} from "./engine.ts";

describe("engine", () => {
  test("engine import runs the real engine", () => {
    const sensor = new Sensor("sensor_a");
    sensor.co2 = null;
    const room = new Room("a", [sensor]);
    const building = new Building(
      [room],
      [new Box([new Valve("valve_a", 0, room, ValveType.Supply)])],
    );
    let power = 20;
    const engine = new AutomaticModeEngine(
      building,
      {
        getPower() {
          return power;
        },
        setPower(next) {
          power = next;
        },
      },
      {
        info() {
          // The report is what this test asserts on.
        },
      },
    );

    const report = engine.run(new Timestamp(0, 28800));

    expect(report.branch).toBe("allBelow");
  });
});
