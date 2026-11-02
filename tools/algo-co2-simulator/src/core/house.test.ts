import { describe, expect, test } from "vitest";

import { parseHouse } from "./house.ts";
import { PRESET_HOUSES } from "./presets.ts";

function minimalHouse(): Record<string, unknown> {
  return {
    name: "Minimální dům",
    hru: { nominalFlowM3h: 100 },
    rooms: [
      { id: "a", name: "A", rect: { x: 0, y: 0, w: 4, d: 3 }, sensors: ["sensor_a"] },
      { id: "b", name: "B", rect: { x: 4, y: 0, w: 3, d: 3 }, sensors: [] },
    ],
    boxes: [
      { id: "box", valves: [{ id: "a_privod", room: "a", type: "supply", defaultPosition: 0 }] },
    ],
    scenarios: [
      {
        id: "den",
        name: "Den",
        initialCo2Ppm: { a: 700 },
        steps: [{ at: "22:00", room: "a", people: 2, activity: "sleeping" }],
      },
    ],
  };
}

function presetById(id: string) {
  const house = PRESET_HOUSES.find((candidate) => candidate.id === id);
  if (house === undefined) {
    throw new Error(`missing preset ${id}`);
  }
  return house;
}

describe("presets", () => {
  test("every preset parses", () => {
    expect(PRESET_HOUSES.map((house) => house.id)).toEqual(["testovaci-dum", "rodinny-dum"]);
    for (const house of PRESET_HOUSES) {
      expect(house.rooms.length).toBeGreaterThan(0);
      expect(house.scenarios.map((scenario) => scenario.id)).toEqual([
        "pracovni-den",
        "navsteva",
        "noc-dva",
      ]);
    }
  });

  test("Testovací dům matches the engine test topology", () => {
    const house = presetById("testovaci-dum");

    expect(house.name).toBe("Testovací dům");
    expect(house.hru.nominalFlowM3h).toBe(200);
    expect(house.rooms.map((room) => room.id)).toEqual(["obyvak", "pracovna", "loznice"]);
    expect(house.rooms.flatMap((room) => room.sensorIds)).toEqual([
      "sensor_obyvak",
      "sensor_pracovna",
      "sensor_loznice",
    ]);
    expect(house.boxes).toHaveLength(1);
    expect(house.boxes.flatMap((box) => box.valves.map((valve) => valve.id))).toEqual([
      "obyvak_privod_1",
      "obyvak_privod_2",
      "loznice_privod_1",
      "loznice_privod_2",
      "pracovna_privod",
    ]);
    for (const valve of house.boxes.flatMap((box) => box.valves)) {
      expect(valve.type).toBe("supply");
      expect(valve.defaultPosition).toBe(0);
    }
  });

  test("Rodinný dům keeps koupelna and wc without sensors and chodba without valves", () => {
    const house = presetById("rodinny-dum");
    const valves = house.boxes.flatMap((box) => box.valves);
    function room(id: string) {
      return house.rooms.find((candidate) => candidate.id === id);
    }

    expect(house.hru.nominalFlowM3h).toBe(350);
    for (const id of ["koupelna", "wc"]) {
      expect(room(id)?.sensorIds).toEqual([]);
      expect(valves.filter((valve) => valve.roomId === id).map((valve) => valve.type)).toEqual([
        "exhaust",
      ]);
    }
    expect(room("chodba")?.sensorIds).toEqual([]);
    expect(valves.filter((valve) => valve.roomId === "chodba")).toEqual([]);
    for (const supplyRoom of house.rooms.filter(
      (candidate) => !["koupelna", "wc", "chodba"].includes(candidate.id),
    )) {
      expect(supplyRoom.sensorIds).toHaveLength(1);
      expect(
        valves.filter((valve) => valve.roomId === supplyRoom.id).map((valve) => valve.type),
      ).toContain("supply");
    }
  });
});

describe("parseHouse", () => {
  test("parseHouse fills defaults", () => {
    const house = parseHouse("minimalni", minimalHouse());

    expect(house.id).toBe("minimalni");
    expect(house.hru).toEqual({ nominalFlowM3h: 100, initialPowerPct: null });
    expect(house.rooms.map((room) => room.heightM)).toEqual([2.6, 2.6]);
    expect(house.scenarios[0]?.initialCo2Ppm).toEqual({ a: 700, b: 500 });
    expect(house.scenarios[0]?.steps).toEqual([
      { atSecondOfDay: 22 * 3600, roomId: "a", people: 2, activity: "sleeping" },
    ]);
  });

  test("parseHouse rejects a valve in an unknown room", () => {
    const json = minimalHouse();
    json.boxes = [
      { id: "box", valves: [{ id: "v", room: "neexistuje", type: "supply", defaultPosition: 0 }] },
    ];

    expect(() => parseHouse("x", json)).toThrow(/room/);
  });

  test("parseHouse rejects a step in an unknown room", () => {
    const json = minimalHouse();
    json.scenarios = [
      {
        id: "den",
        name: "Den",
        initialCo2Ppm: {},
        steps: [{ at: "08:00", room: "neexistuje", people: 1, activity: "sitting" }],
      },
    ];

    expect(() => parseHouse("x", json)).toThrow(/steps\[0\]\.room/);
  });

  test("parseHouse rejects duplicate ids", () => {
    const duplicateRoom = minimalHouse();
    (duplicateRoom.rooms as Record<string, unknown>[])[1]!.id = "a";
    expect(() => parseHouse("x", duplicateRoom)).toThrow(/duplicate.*"a"/);

    const duplicateSensor = minimalHouse();
    (duplicateSensor.rooms as Record<string, unknown>[])[1]!.sensors = ["sensor_a"];
    expect(() => parseHouse("x", duplicateSensor)).toThrow(/duplicate.*"sensor_a"/);

    const duplicateValve = minimalHouse();
    duplicateValve.boxes = [
      {
        id: "box",
        valves: [
          { id: "v", room: "a", type: "supply", defaultPosition: 0 },
          { id: "v", room: "b", type: "exhaust", defaultPosition: 0 },
        ],
      },
    ];
    expect(() => parseHouse("x", duplicateValve)).toThrow(/duplicate.*"v"/);
  });

  test("parseHouse rejects a bad time", () => {
    const json = minimalHouse();
    json.scenarios = [
      {
        id: "den",
        name: "Den",
        initialCo2Ppm: {},
        steps: [{ at: "24:00", room: "a", people: 1, activity: "sitting" }],
      },
    ];

    expect(() => parseHouse("x", json)).toThrow(/steps\[0\]\.at/);
  });

  test("parseHouse rejects a room without area", () => {
    const json = minimalHouse();
    (json.rooms as Record<string, unknown>[])[0]!.rect = { x: 0, y: 0, w: 0, d: 3 };

    expect(() => parseHouse("x", json)).toThrow(/rooms\[0\]\.rect\.w/);
  });

  test("parseHouse rejects non-positive heights and flows", () => {
    const flat = minimalHouse();
    (flat.rooms as Record<string, unknown>[])[1]!.heightM = 0;
    expect(() => parseHouse("x", flat)).toThrow(/rooms\[1\]\.heightM/);

    const noFlow = minimalHouse();
    noFlow.hru = { nominalFlowM3h: 0 };
    expect(() => parseHouse("x", noFlow)).toThrow(/hru\.nominalFlowM3h/);
  });

  test("parseHouse rejects a negative valve position and an out-of-range initial power", () => {
    const negative = minimalHouse();
    negative.boxes = [
      { id: "box", valves: [{ id: "v", room: "a", type: "supply", defaultPosition: -1 }] },
    ];
    expect(() => parseHouse("x", negative)).toThrow(/defaultPosition/);

    const tooMuch = minimalHouse();
    tooMuch.hru = { nominalFlowM3h: 100, initialPowerPct: 101 };
    expect(() => parseHouse("x", tooMuch)).toThrow(/initialPowerPct/);
  });

  test("parseHouse rejects fractional or negative people", () => {
    for (const people of [1.5, -1]) {
      const json = minimalHouse();
      json.scenarios = [
        {
          id: "den",
          name: "Den",
          initialCo2Ppm: {},
          steps: [{ at: "08:00", room: "a", people, activity: "sitting" }],
        },
      ];
      expect(() => parseHouse("x", json)).toThrow(/people/);
    }
  });

  test("parseHouse rejects an initial concentration for an unknown room", () => {
    const json = minimalHouse();
    json.scenarios = [{ id: "den", name: "Den", initialCo2Ppm: { neexistuje: 600 }, steps: [] }];

    expect(() => parseHouse("x", json)).toThrow(/initialCo2Ppm/);
  });

  test("parseHouse rejects an unknown key", () => {
    const typos: [path: (string | number)[], key: string][] = [
      [[], "nazev"],
      [["hru"], "nominalFlow"],
      [["rooms", 0], "heigthM"],
      [["rooms", 0, "rect"], "depth"],
      [["boxes", 0], "valvez"],
      [["boxes", 0, "valves", 0], "defaultPositon"],
      [["scenarios", 0], "initialCO2Ppm"],
      [["scenarios", 0, "steps", 0], "persons"],
    ];

    for (const [path, key] of typos) {
      const json = minimalHouse();
      let target: unknown = json;
      for (const segment of path) {
        target = (target as Record<string | number, unknown>)[segment];
      }
      (target as Record<string, unknown>)[key] = 1;

      expect(() => parseHouse("x", json), path.join(".")).toThrow(new RegExp(key));
    }
  });

  test("parseHouse rejects input that is not an object", () => {
    expect(() => parseHouse("x", null)).toThrow(/expected object/);
  });
});
