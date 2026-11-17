import { z } from "zod";

import { DEFAULT_INITIAL_CO2_PPM, DEFAULT_ROOM_HEIGHT_M } from "./settings.ts";
import type { Activity } from "./settings.ts";
import type { ValveKind } from "./airflow.ts";

/** Metres: position of the top-left corner, width along x, depth along y. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface HouseRoom {
  id: string;
  name: string;
  rect: Rect;
  heightM: number;
  sensorIds: string[];
}

export interface HouseValve {
  id: string;
  roomId: string;
  type: ValveKind;
  defaultPosition: number;
}

export interface HouseBox {
  id: string;
  valves: HouseValve[];
}

export interface ScenarioStep {
  atSecondOfDay: number;
  roomId: string;
  people: number;
  activity: Activity;
}

export interface Scenario {
  id: string;
  name: string;
  /** CO2 at the start of the run, in ppm, for every room of the house. */
  initialCo2Ppm: Record<string, number>;
  steps: ScenarioStep[];
}

export interface House {
  id: string;
  name: string;
  hru: { nominalFlowM3h: number; initialPower: number | null };
  rooms: HouseRoom[];
  boxes: HouseBox[];
  scenarios: Scenario[];
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

const idSchema = z.string().min(1);

const houseSchema = z.strictObject({
  name: z.string(),
  hru: z.strictObject({
    nominalFlowM3h: z.number().positive(),
    initialPower: z.number().min(0).max(10).nullable().default(null),
  }),
  rooms: z.array(
    z.strictObject({
      id: idSchema,
      name: z.string(),
      rect: z.strictObject({
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        d: z.number().positive(),
      }),
      heightM: z.number().positive().default(DEFAULT_ROOM_HEIGHT_M),
      sensors: z.array(idSchema),
    }),
  ),
  boxes: z.array(
    z.strictObject({
      id: idSchema,
      valves: z.array(
        z.strictObject({
          id: idSchema,
          room: idSchema,
          type: z.enum(["supply", "exhaust"]),
          defaultPosition: z.number().min(0),
        }),
      ),
    }),
  ),
  scenarios: z.array(
    z.strictObject({
      id: idSchema,
      name: z.string(),
      initialCo2Ppm: z.record(z.string(), z.number()).default({}),
      steps: z.array(
        z.strictObject({
          at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected a time of day as HH:MM"),
          room: idSchema,
          people: z.number().int().min(0),
          activity: z.enum(["sleeping", "sitting", "active"]),
        }),
      ),
    }),
  ),
});

type RawHouse = z.infer<typeof houseSchema>;

function formatPath(path: readonly PropertyKey[]): string {
  let formatted = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
    } else {
      formatted += formatted === "" ? String(segment) : `.${String(segment)}`;
    }
  }
  return formatted === "" ? "house" : formatted;
}

function claimId(seen: Set<string>, id: string, path: string, problems: string[]): void {
  if (seen.has(id)) {
    problems.push(`${path}: duplicate id "${id}"`);
  }
  seen.add(id);
}

/** Checks what the schema cannot: unique ids and references to rooms that exist. */
function findReferenceProblems(raw: RawHouse): string[] {
  const problems: string[] = [];
  const roomIds = new Set<string>();
  const sensorIds = new Set<string>();
  const valveIds = new Set<string>();

  for (const [roomIndex, room] of raw.rooms.entries()) {
    claimId(roomIds, room.id, `rooms[${roomIndex}].id`, problems);
    for (const [sensorIndex, sensorId] of room.sensors.entries()) {
      claimId(sensorIds, sensorId, `rooms[${roomIndex}].sensors[${sensorIndex}]`, problems);
    }
  }

  for (const [boxIndex, box] of raw.boxes.entries()) {
    for (const [valveIndex, valve] of box.valves.entries()) {
      const path = `boxes[${boxIndex}].valves[${valveIndex}]`;
      claimId(valveIds, valve.id, `${path}.id`, problems);
      if (!roomIds.has(valve.room)) {
        problems.push(`${path}.room: unknown room "${valve.room}"`);
      }
    }
  }

  for (const [scenarioIndex, scenario] of raw.scenarios.entries()) {
    const path = `scenarios[${scenarioIndex}]`;
    for (const roomId of Object.keys(scenario.initialCo2Ppm)) {
      if (!roomIds.has(roomId)) {
        problems.push(`${path}.initialCo2Ppm: unknown room "${roomId}"`);
      }
    }
    for (const [stepIndex, step] of scenario.steps.entries()) {
      if (!roomIds.has(step.room)) {
        problems.push(`${path}.steps[${stepIndex}].room: unknown room "${step.room}"`);
      }
    }
  }

  return problems;
}

function secondOfDay(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE;
}

function toHouse(id: string, raw: RawHouse): House {
  return {
    id,
    name: raw.name,
    hru: raw.hru,
    rooms: raw.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      rect: room.rect,
      heightM: room.heightM,
      sensorIds: room.sensors,
    })),
    boxes: raw.boxes.map((box) => ({
      id: box.id,
      valves: box.valves.map((valve) => ({
        id: valve.id,
        roomId: valve.room,
        type: valve.type,
        defaultPosition: valve.defaultPosition,
      })),
    })),
    scenarios: raw.scenarios.map((scenario) => {
      const listed = new Map(Object.entries(scenario.initialCo2Ppm));
      return {
        id: scenario.id,
        name: scenario.name,
        initialCo2Ppm: Object.fromEntries(
          raw.rooms.map((room) => [room.id, listed.get(room.id) ?? DEFAULT_INITIAL_CO2_PPM]),
        ),
        steps: scenario.steps.map((step) => ({
          atSecondOfDay: secondOfDay(step.at),
          roomId: step.room,
          people: step.people,
          activity: step.activity,
        })),
      };
    }),
  };
}

/** Validates a house file and fills its defaults. Throws an Error naming the offending field. */
export function parseHouse(id: string, json: unknown): House {
  const result = houseSchema.safeParse(json);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${formatPath(issue.path)}: ${issue.message}`,
    );
    throw new Error(`Invalid house "${id}": ${problems.join("; ")}`);
  }

  const problems = findReferenceProblems(result.data);
  if (problems.length > 0) {
    throw new Error(`Invalid house "${id}": ${problems.join("; ")}`);
  }

  return toHouse(id, result.data);
}
