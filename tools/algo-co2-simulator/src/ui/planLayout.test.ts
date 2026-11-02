import { describe, expect, test } from "vitest";

import type { HouseRoom } from "../core/house.ts";
import type { RoomSnapshot } from "../core/simulation.ts";
import { ROOM_TEXT, layoutRoomText, planViewBox, roomCo2Band, valveState } from "./planLayout.ts";
import type { MeasureEm, RoomTextLine } from "./planLayout.ts";

function room(id: string, x: number, y: number, w: number, d: number): HouseRoom {
  return { id, name: id, rect: { x, y, w, d }, heightM: 2.6, sensorIds: [] };
}

describe("planViewBox", () => {
  test("planViewBox covers every room plus padding", () => {
    const rooms = [room("a", 0, 0, 6, 5), room("b", 6, 0, 4, 3)];

    expect(planViewBox(rooms, 0.5)).toEqual({ x: -0.5, y: -0.5, w: 11, h: 6 });
  });
});

function snapshotRoom(co2Ppm: number, brokenSensors: boolean[]): RoomSnapshot {
  return {
    id: "r",
    name: "r",
    co2Ppm,
    filteredCo2Ppm: null,
    occupancy: { people: 0, activity: "sitting" },
    sensors: brokenSensors.map((broken, index) => ({ id: `s${index}`, reading: co2Ppm, broken })),
    valves: [],
    aboveSince: { th1: null, th2: null },
    belowSince: { th1: null },
    lastChangeEpoch: null,
  };
}

describe("roomCo2Band", () => {
  test("roomCo2Band bands the actual CO2 by the given thresholds", () => {
    expect(roomCo2Band(snapshotRoom(700, [false]), 800, 1000)).toBe("ok");
    expect(roomCo2Band(snapshotRoom(900, [false]), 800, 1000)).toBe("warn");
    expect(roomCo2Band(snapshotRoom(1200, [false]), 800, 1000)).toBe("bad");
  });

  test("roomCo2Band keeps a room with one working sensor banded", () => {
    expect(roomCo2Band(snapshotRoom(1200, [true, false]), 800, 1000)).toBe("bad");
  });

  test("roomCo2Band says none when every sensor is broken, whatever the CO2", () => {
    expect(roomCo2Band(snapshotRoom(1200, [true, true]), 800, 1000)).toBe("none");
  });

  test("roomCo2Band says none for a room without a sensor", () => {
    expect(roomCo2Band(snapshotRoom(1200, []), 800, 1000)).toBe("none");
  });
});

describe("valveState", () => {
  test("valveState says open up to the fully open position", () => {
    expect(valveState(0, 0, 90)).toBe("otevřeno");
    expect(valveState(10, 10, 90)).toBe("otevřeno");
    expect(valveState(5, 10, 90)).toBe("otevřeno");
  });

  test("valveState says closed from the fully closed position", () => {
    expect(valveState(90, 0, 90)).toBe("zavřeno");
    expect(valveState(120, 0, 90)).toBe("zavřeno");
  });

  test("valveState says partly in between", () => {
    expect(valveState(1, 0, 90)).toBe("částečně");
    expect(valveState(45, 0, 90)).toBe("částečně");
    expect(valveState(89, 0, 90)).toBe("částečně");
  });
});

// Every character is half an em wide: close to the real font and easy to reason about.
function halfEmPerChar(text: string): number {
  return text.length * 0.5;
}

const measure: MeasureEm = halfEmPerChar;

const DETAILS = [
  { key: "co2", text: "512 ppm" },
  { key: "people", text: "0 os." },
  { key: "wc_odtah", text: "odtah 0 · otevřeno" },
];

function texts(lines: readonly RoomTextLine[]): string[] {
  return lines.map((line) => line.text);
}

function expectInside(lines: readonly RoomTextLine[], w: number, d: number): void {
  for (const line of lines) {
    expect(ROOM_TEXT.insetM + measure(line.text, line.weight) * line.fontSize).toBeLessThanOrEqual(
      w - ROOM_TEXT.insetM,
    );
    expect(line.y + ROOM_TEXT.descentEm * line.fontSize).toBeLessThanOrEqual(d);
  }
}

describe("layoutRoomText", () => {
  test("layoutRoomText leaves a roomy room at the base sizes", () => {
    const lines = layoutRoomText("Obývák", DETAILS, { w: 6, d: 5 }, measure);

    expect(texts(lines)).toEqual(["Obývák", "512 ppm", "0 os.", "odtah 0 · otevřeno"]);
    expect(lines.map((line) => line.fontSize)).toEqual([0.36, 0.3, 0.3, 0.3]);
    expect(lines.map((line) => line.y)).toEqual(
      [0.5, 0.92, 1.34, 1.76].map((y) => expect.closeTo(y)),
    );
    expect(lines[0]?.weight).toBe(600);
  });

  test("layoutRoomText breaks a line that is too wide at the separator", () => {
    const lines = layoutRoomText("WC", DETAILS, { w: 1.5, d: 2 }, measure);

    expect(texts(lines)).toEqual(["WC", "512 ppm", "0 os.", "odtah 0", "otevřeno"]);
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });

  test("layoutRoomText shrinks the text until every line fits a narrow room", () => {
    const lines = layoutRoomText("Koupelna", DETAILS, { w: 1.5, d: 2 }, measure);

    expect(lines[1]?.fontSize).toBeLessThan(ROOM_TEXT.lineSizeM);
    expectInside(lines, 1.5, 2);
  });

  test("layoutRoomText fits a four-digit reading in the WC", () => {
    const details = [{ key: "co2", text: "1532 ppm" }, ...DETAILS.slice(1)];

    expectInside(layoutRoomText("WC", details, { w: 1.5, d: 2 }, measure), 1.5, 2);
  });

  test("layoutRoomText never shrinks below the minimum scale", () => {
    const lines = layoutRoomText("Komora", DETAILS, { w: 0.5, d: 0.5 }, measure);

    expect(lines[0]?.fontSize).toBeCloseTo(ROOM_TEXT.nameSizeM * ROOM_TEXT.minScale);
    expect(lines[1]?.fontSize).toBeCloseTo(ROOM_TEXT.lineSizeM * ROOM_TEXT.minScale);
  });
});
