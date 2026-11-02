import { hruFlowM3h, splitValveFlows } from "./airflow.ts";
import type { ValveKind } from "./airflow.ts";
import {
  AutomaticModeEngine,
  Box,
  Building,
  Room,
  Sensor,
  ThresholdType,
  Timestamp,
  Valve,
  ValveType,
} from "./engine.ts";
import type { HRU, RunReport } from "./engine.ts";
import { applyEngineParams } from "./engineParams.ts";
import type { EngineParams } from "./engineParams.ts";
import type { House, Scenario } from "./house.ts";
import { generationM3h, stepRoomAir } from "./roomAir.ts";
import type { RoomAirState } from "./roomAir.ts";
import { occupancyAt, stepsDueAt } from "./scenario.ts";
import type { Occupancy } from "./scenario.ts";
import {
  DEFAULT_INITIAL_CO2_PPM,
  HISTORY_LENGTH,
  HISTORY_SAMPLE_S,
  LOG_LIMIT,
} from "./settings.ts";
import type { SimSettings } from "./settings.ts";

const SECONDS_PER_DAY = 86400;

export interface SimulationOptions {
  house: House;
  scenario: Scenario | null;
  startSecondOfDay: number;
  settings: SimSettings;
  engineParams?: EngineParams;
  /** The noise source: a function returning a number in [0, 1), like `Math.random`. */
  random?: () => number;
  journal?: boolean;
  /**
   * Replaces the modelled reading of every working sensor: the number it returns, or `null`,
   * is what the sensor reports. The open-loop engine tests use it to script the readings.
   */
  sensorOverride?: (sensorId: string, epochSecond: number) => number | null;
}

export interface ValveChange {
  valveId: string;
  from: number;
  to: number;
}

export type LogEntry =
  | { kind: "decision"; epochSecond: number; report: RunReport; valveChanges: ValveChange[] }
  | { kind: "engine"; epochSecond: number; message: string };

export interface HistorySample {
  epochSecond: number;
  co2Ppm: Record<string, number>;
  filteredCo2Ppm: Record<string, number | null>;
  powerPct: number;
}

export interface RoomSnapshot {
  id: string;
  name: string;
  co2Ppm: number;
  filteredCo2Ppm: number | null;
  occupancy: Occupancy;
  sensors: { id: string; reading: number | null; broken: boolean }[];
  valves: { id: string; type: ValveKind; position: number }[];
  aboveSince: { th1: number | null; th2: number | null };
  belowSince: { th1: number | null };
  lastChangeEpoch: number | null;
}

export interface SimSnapshot {
  epochSecond: number;
  secondOfDay: number;
  day: number;
  rooms: RoomSnapshot[];
  powerPct: number;
  maxPowerPct: number | null;
  totalFlowM3h: number;
  lastReport: RunReport | null;
}

interface SimValve {
  id: string;
  type: ValveKind;
  valve: Valve;
}

interface SimRoom {
  id: string;
  name: string;
  volumeM3: number;
  co2Ppm: number;
  occupancy: Occupancy;
  engineRoom: Room;
  sensors: Sensor[];
  valves: SimValve[];
}

interface Model {
  building: Building;
  rooms: SimRoom[];
  valves: SimValve[];
}

class SimHru implements HRU {
  constructor(private power: number) {}

  getPower(): number {
    return this.power;
  }

  setPower(power: number): void {
    this.power = power;
  }
}

function copySettings(settings: SimSettings): SimSettings {
  return { ...settings, co2PerPersonLph: { ...settings.co2PerPersonLph } };
}

function startingCo2(scenario: Scenario | null, roomId: string): number {
  return scenario?.initialCo2Ppm[roomId] ?? DEFAULT_INITIAL_CO2_PPM;
}

/** A standard normal draw by the Box–Muller transform. */
function gaussian(random: () => number): number {
  const u1 = 1 - random();
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Builds the engine's own model of the house, with every valve and sensor value set explicitly. */
function buildModel(house: House): Model {
  const rooms: SimRoom[] = house.rooms.map((houseRoom) => {
    const sensors = houseRoom.sensorIds.map((sensorId) => new Sensor(sensorId));
    return {
      id: houseRoom.id,
      name: houseRoom.name,
      volumeM3: houseRoom.rect.w * houseRoom.rect.d * houseRoom.heightM,
      co2Ppm: DEFAULT_INITIAL_CO2_PPM,
      occupancy: { people: 0, activity: "sitting" },
      engineRoom: new Room(houseRoom.id, sensors),
      sensors,
      valves: [],
    };
  });
  const roomsById = new Map(rooms.map((room) => [room.id, room]));

  const valves: SimValve[] = [];
  const boxes = house.boxes.map((houseBox) => {
    const engineValves = houseBox.valves.map((houseValve) => {
      const room = roomsById.get(houseValve.roomId);
      if (room === undefined) {
        throw new Error(`Valve ${houseValve.id} belongs to unknown room ${houseValve.roomId}`);
      }
      const valve = new Valve(
        houseValve.id,
        houseValve.defaultPosition,
        room.engineRoom,
        houseValve.type === "supply" ? ValveType.Supply : ValveType.Exhaust,
      );
      valve.value = houseValve.defaultPosition;
      const simValve = { id: houseValve.id, type: houseValve.type, valve };
      room.valves.push(simValve);
      valves.push(simValve);
      return valve;
    });
    return new Box(engineValves);
  });

  return {
    building: new Building(
      rooms.map((room) => room.engineRoom),
      boxes,
    ),
    rooms,
    valves,
  };
}

export class Simulation {
  readonly engine: AutomaticModeEngine;

  private readonly house: House;
  private readonly scenario: Scenario | null;
  private readonly startSecondOfDay: number;
  private readonly random: () => number;
  private readonly sensorOverride: SimulationOptions["sensorOverride"];
  private readonly hru: SimHru;
  private readonly rooms: SimRoom[];
  private readonly valves: SimValve[];
  private readonly brokenSensors = new Set<string>();
  private readonly log: LogEntry[] = [];
  private readonly history: HistorySample[] = [];
  private settings: SimSettings;
  private epoch = 0;
  private lastSensorEpoch = 0;
  private lastRunEpoch = 0;
  private lastReport: RunReport | null = null;

  constructor(options: SimulationOptions) {
    this.house = options.house;
    this.scenario = options.scenario;
    this.startSecondOfDay = options.startSecondOfDay;
    this.random = options.random ?? Math.random;
    this.sensorOverride = options.sensorOverride;
    this.settings = copySettings(options.settings);

    const model = buildModel(options.house);
    this.rooms = model.rooms;
    this.valves = model.valves;
    this.hru = new SimHru(0);
    this.engine = new AutomaticModeEngine(model.building, this.hru, {
      info: (message) => this.recordEngineMessage(message),
    });
    if (options.engineParams !== undefined) {
      applyEngineParams(this.engine, options.engineParams);
    }
    this.hru.setPower(options.house.hru.initialPowerPct ?? this.engine.hruMinPower);
    this.engine.useJournal = options.journal ?? false;

    const occupancy = occupancyAt(
      options.scenario,
      this.rooms.map((room) => room.id),
      this.secondOfDay,
    );
    for (const room of this.rooms) {
      room.co2Ppm = startingCo2(options.scenario, room.id);
      room.occupancy = occupancy.get(room.id) ?? room.occupancy;
    }

    this.performStep();
  }

  get epochSecond(): number {
    return this.epoch;
  }

  private get secondOfDay(): number {
    return (this.startSecondOfDay + this.epoch) % SECONDS_PER_DAY;
  }

  step(): void {
    this.epoch += 1;
    this.performStep();
  }

  advance(seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
      this.step();
    }
  }

  setOccupancy(roomId: string, occupancy: Occupancy): void {
    this.requireRoom(roomId).occupancy = { people: occupancy.people, activity: occupancy.activity };
  }

  setSensorBroken(sensorId: string, broken: boolean): void {
    const { room, sensor } = this.locateSensor(sensorId);
    if (broken) {
      this.brokenSensors.add(sensorId);
    } else {
      this.brokenSensors.delete(sensorId);
    }
    sensor.co2 = this.readSensor(room, sensor);
  }

  setSettings(settings: SimSettings): void {
    this.settings = copySettings(settings);
  }

  setEngineParams(params: EngineParams): void {
    applyEngineParams(this.engine, params);
  }

  snapshot(): SimSnapshot {
    return {
      epochSecond: this.epoch,
      secondOfDay: this.secondOfDay,
      day: Math.floor((this.startSecondOfDay + this.epoch) / SECONDS_PER_DAY) + 1,
      rooms: this.rooms.map((room) => this.snapshotRoom(room)),
      powerPct: this.hru.getPower(),
      maxPowerPct: this.lastReport?.maxPower ?? null,
      totalFlowM3h: this.totalFlowM3h(),
      lastReport: this.lastReport,
    };
  }

  getLog(): readonly LogEntry[] {
    return this.log;
  }

  getHistory(): readonly HistorySample[] {
    return this.history;
  }

  private snapshotRoom(room: SimRoom): RoomSnapshot {
    const state = this.engine.getRoomState(room.id);
    return {
      id: room.id,
      name: room.name,
      co2Ppm: room.co2Ppm,
      filteredCo2Ppm: this.engine.getFilteredCO2(room.id),
      occupancy: { people: room.occupancy.people, activity: room.occupancy.activity },
      sensors: room.sensors.map((sensor) => ({
        id: sensor.id,
        reading: sensor.co2,
        broken: this.brokenSensors.has(sensor.id),
      })),
      valves: room.valves.map((simValve) => ({
        id: simValve.id,
        type: simValve.type,
        position: simValve.valve.value,
      })),
      aboveSince: {
        th1: state?.aboveThresholdSince.get(ThresholdType.TH1) ?? null,
        th2: state?.aboveThresholdSince.get(ThresholdType.TH2) ?? null,
      },
      belowSince: { th1: state?.belowThresholdSince.get(ThresholdType.TH1) ?? null },
      lastChangeEpoch: state?.lastChangeTimestamp?.epochSecond ?? null,
    };
  }

  private requireRoom(roomId: string): SimRoom {
    const room = this.rooms.find((candidate) => candidate.id === roomId);
    if (room === undefined) {
      throw new Error(`Unknown room ${roomId} in house ${this.house.id}`);
    }
    return room;
  }

  private locateSensor(sensorId: string): { room: SimRoom; sensor: Sensor } {
    for (const room of this.rooms) {
      const sensor = room.sensors.find((candidate) => candidate.id === sensorId);
      if (sensor !== undefined) {
        return { room, sensor };
      }
    }
    throw new Error(`Unknown sensor ${sensorId} in house ${this.house.id}`);
  }

  private totalFlowM3h(): number {
    return hruFlowM3h(this.house.hru.nominalFlowM3h, this.hru.getPower());
  }

  private recordEngineMessage(message: string): void {
    if (message.includes("threshold")) {
      this.log.push({ kind: "engine", epochSecond: this.epoch, message });
    }
  }

  private performStep(): void {
    if (this.epoch > 0) {
      this.applyScenarioSteps();
      this.advanceAir();
    }
    if (this.epoch === 0 || this.epoch - this.lastSensorEpoch >= this.settings.sensorIntervalS) {
      this.writeSensors();
    }
    if (this.epoch === 0 || this.epoch - this.lastRunEpoch >= this.settings.enginePeriodS) {
      this.runEngine();
    }
    if (this.epoch % HISTORY_SAMPLE_S === 0) {
      this.sampleHistory();
    }
  }

  private applyScenarioSteps(): void {
    for (const step of stepsDueAt(this.scenario, this.secondOfDay)) {
      this.setOccupancy(step.roomId, { people: step.people, activity: step.activity });
    }
  }

  /** One second of room air, from the current valve positions, HRU power and occupancy. */
  private advanceAir(): void {
    const flows = splitValveFlows(
      this.valves.map((simValve) => ({
        id: simValve.id,
        type: simValve.type,
        position: simValve.valve.value,
      })),
      this.totalFlowM3h(),
      this.settings.valveFullyClosedPosition,
      this.settings.valveHalfClosedFlowShare,
    );

    const states: RoomAirState[] = this.rooms.map((room) => {
      let supplyM3h = 0;
      let exhaustM3h = 0;
      for (const simValve of room.valves) {
        const flow = flows.get(simValve.id) ?? 0;
        if (simValve.type === "supply") {
          supplyM3h += flow;
        } else {
          exhaustM3h += flow;
        }
      }
      return {
        id: room.id,
        volumeM3: room.volumeM3,
        co2Ppm: room.co2Ppm,
        generationM3h: generationM3h(
          room.occupancy.people,
          room.occupancy.activity,
          this.settings.co2PerPersonLph,
        ),
        supplyM3h,
        exhaustM3h,
        infiltrationM3h: this.settings.infiltrationAch * room.volumeM3,
      };
    });

    const next = stepRoomAir(states, 1, this.settings.outdoorCo2Ppm);
    for (const room of this.rooms) {
      room.co2Ppm = next.get(room.id) ?? room.co2Ppm;
    }
  }

  private writeSensors(): void {
    for (const room of this.rooms) {
      for (const sensor of room.sensors) {
        sensor.co2 = this.readSensor(room, sensor);
      }
    }
    this.lastSensorEpoch = this.epoch;
  }

  private readSensor(room: SimRoom, sensor: Sensor): number | null {
    if (this.brokenSensors.has(sensor.id)) {
      return null;
    }
    if (this.sensorOverride !== undefined) {
      return this.sensorOverride(sensor.id, this.epoch);
    }
    const noise = this.settings.sensorNoise
      ? gaussian(this.random) * this.settings.sensorNoiseSigmaPpm
      : 0;
    return Math.round(room.co2Ppm + noise);
  }

  private runEngine(): void {
    const positionsBefore = new Map(
      this.valves.map((simValve) => [simValve.id, simValve.valve.value]),
    );

    const report = this.engine.run(new Timestamp(this.epoch, this.secondOfDay));
    this.lastReport = report;
    this.lastRunEpoch = this.epoch;

    if (report.valvesChanged || report.powerAfter !== report.powerBefore) {
      const valveChanges: ValveChange[] = [];
      for (const simValve of this.valves) {
        const from = positionsBefore.get(simValve.id) ?? simValve.valve.value;
        if (from !== simValve.valve.value) {
          valveChanges.push({ valveId: simValve.id, from, to: simValve.valve.value });
        }
      }
      this.log.push({ kind: "decision", epochSecond: this.epoch, report, valveChanges });
    }

    if (this.log.length > LOG_LIMIT) {
      this.log.splice(0, this.log.length - LOG_LIMIT);
    }
  }

  private sampleHistory(): void {
    const co2Ppm: Record<string, number> = {};
    const filteredCo2Ppm: Record<string, number | null> = {};
    for (const room of this.rooms) {
      co2Ppm[room.id] = room.co2Ppm;
      filteredCo2Ppm[room.id] = this.engine.getFilteredCO2(room.id);
    }
    this.history.push({
      epochSecond: this.epoch,
      co2Ppm,
      filteredCo2Ppm,
      powerPct: this.hru.getPower(),
    });
    if (this.history.length > HISTORY_LENGTH) {
      this.history.splice(0, this.history.length - HISTORY_LENGTH);
    }
  }
}
