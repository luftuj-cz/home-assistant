import {
  AutomaticModeEngine,
  Box,
  Building,
  type HRU,
  Room as EngineRoom,
  type RunReport,
  Sensor,
  Timestamp,
  Valve,
  ValveType,
} from "@luftator/algo-co2";
import type { Logger } from "pino";
import type { ValveSnapshot } from "../../core/valveManager.js";
import type { HruVariable } from "../../features/hru/hru.definitions.js";
import type { CachedHruRead, HruReadFailure } from "../../features/hru/hru.service.js";
import type { HruSettings } from "../../types/index.js";
import { appendJournal, type JournalKind } from "../db/automaticJournal.js";
import { listRooms, type Room } from "../db/rooms.js";
import { applyEngineParams, type EngineParams } from "./engineParams.js";
import { getEffectiveParameters, getMaxReadingAgeSeconds } from "./parameters.js";
import { type PowerScale, powerScaleFor } from "./powerScale.js";
import { type ReadingProblem, readingFrom } from "./readings.js";
import type { HassState } from "../homeAssistantClient.js";

/** Why automatic control is the active source but cannot run. */
export type CannotRunReason = "noRooms" | "noReadings" | "noPowerMax" | "hruUnavailable";

/** A cached HRU read older than this counts as no read. */
const HRU_READ_MAX_AGE_MS = 60_000;

export interface RunnerValves {
  getSnapshot(): Promise<ValveSnapshot[]>;
  setValue(entityId: string, value: number): Promise<ValveSnapshot>;
}

export interface RunnerHru {
  getCachedRead(): CachedHruRead | null;
  getReadFailure(): HruReadFailure | null;
  getResolvedConfiguration(): { settings: HruSettings; unit: { variables: HruVariable[] } } | null;
  writeValues(data: Record<string, number>): Promise<void>;
}

export interface RunnerSensors {
  get(entityId: string): HassState | null | undefined;
  /** When the value last changed, in ms, when the store tracks it. */
  changedAt?(entityId: string, attribute: string | null): number | undefined;
}

export interface RunnerDeps {
  valves: RunnerValves;
  hru: RunnerHru;
  sensors: RunnerSensors;
  logger: Logger;
  now?: () => Date;
  journal?: (kind: JournalKind, data: unknown, at: Date) => void;
  /** The set-up rooms come from here; replaceable in tests. */
  rooms?: () => Room[];
}

export interface SensorStatus {
  entityId: string;
  attribute: string | null;
  ppm: number | null;
  problem: ReadingProblem | null;
  ageSeconds: number | null;
}

export type RoomCondition = "belowTh1" | "aboveTh1" | "aboveTh2" | "noReading";

export interface RoomStatus {
  id: number;
  name: string;
  setUp: boolean;
  co2: number | null;
  filteredCo2: number | null;
  condition: RoomCondition | null;
  inCooldown: boolean;
  valves: { entityId: string; position: number | null }[];
  sensors: SensorStatus[];
}

export interface PowerStatus {
  before: number;
  after: number;
  max: number;
  unit: { before: number; after: number; max: number } | null;
}

export interface AutomaticStatus {
  active: boolean;
  reason: CannotRunReason | null;
  startedAt: string | null;
  lastRunAt: string | null;
  /** Local time of day the engine used, HH:MM:SS. */
  engineTime: string | null;
  branch: RunReport["branch"] | null;
  fluctuationActive: boolean;
  powerReview: RunReport["powerReview"];
  power: PowerStatus | null;
  rooms: RoomStatus[];
  lockedValves: { entityId: string; roomId: number; roomName: string }[];
}

interface EngineSetup {
  engine: AutomaticModeEngine;
  hru: RunnerHruAdapter;
  rooms: Room[];
  engineRooms: Map<number, EngineRoom>;
  sensors: Map<string, Sensor>;
  valves: Map<string, Valve>;
}

/** The engine's synchronous HRU over the latest read; writes are made by the runner after `run()`. */
class RunnerHruAdapter implements HRU {
  power = 0;
  requested: number | null = null;

  getPower(): number {
    return this.power;
  }

  setPower(power: number): void {
    this.requested = power;
    this.power = power;
  }
}

function sensorKey(entityId: string): string {
  return entityId;
}

function engineRoomId(room: Room): string {
  return String(room.id);
}

function timeOfDay(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function position(snapshot: ValveSnapshot | undefined): number | null {
  if (!snapshot) return null;
  const value = Number(snapshot.state);
  return Number.isFinite(value) ? value : null;
}

/**
 * Runs LUFTaTOR Algo CO2 against the set-up rooms. It has no timer: the scheduler activates it when automatic
 * control becomes the active source, ticks it every 10 s, and deactivates it when another source wins. Each
 * activation starts a fresh engine from the real valve positions, as the engine's README requires after a pause.
 */
export class AutomaticRunner {
  private setup: EngineSetup | null = null;
  private needsRebuild = false;
  private startedAt: Date | null = null;
  private lastRunAt: Date | null = null;
  private lastReport: RunReport | null = null;
  private reason: CannotRunReason | null = null;
  private readonly lastKnownPositions = new Map<string, number>();
  private readonly sensorStatus = new Map<string, SensorStatus>();
  private writtenPower: { unitValue: number; at: number } | null = null;
  private scale: PowerScale | null = null;
  /** Read from the settings when an engine is built, not at construction (the database may not be up yet). */
  private params: EngineParams | null = null;

  constructor(private readonly deps: RunnerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private journal(kind: JournalKind, data: unknown): void {
    try {
      (this.deps.journal ?? appendJournal)(kind, data, this.now());
    } catch (error) {
      this.deps.logger.warn({ error, kind }, "Automatic control: could not write the journal");
    }
  }

  private rooms(): Room[] {
    return (this.deps.rooms ?? listRooms)();
  }

  isActive(): boolean {
    return this.startedAt !== null;
  }

  getReason(): CannotRunReason | null {
    return this.isActive() ? this.reason : null;
  }

  /** Starts a stretch of automatic control. No-op while active. */
  async activate(): Promise<void> {
    if (this.isActive()) return;
    this.startedAt = this.now();
    this.reason = null;
    this.lastReport = null;
    await this.build();
    this.journal("start", { rooms: this.setup?.rooms.map((room) => room.name) ?? [] });
    this.deps.logger.info("Automatic control: started");
  }

  /** Ends the stretch; `source` names what took over, for the journal. */
  deactivate(source?: string): void {
    if (!this.isActive()) return;
    this.setup = null;
    this.startedAt = null;
    this.reason = null;
    this.lastReport = null;
    this.writtenPower = null;
    this.journal("stop", { source: source ?? null });
    this.deps.logger.info({ source }, "Automatic control: stopped");
  }

  /** The rooms changed: the next tick builds a fresh engine. */
  roomsChanged(): void {
    this.needsRebuild = true;
  }

  /** The parameters changed: the running engine takes them at once, keeping its timers. */
  parametersChanged(): void {
    this.params = getEffectiveParameters();
    if (this.setup) applyEngineParams(this.setup.engine, this.params);
  }

  private async build(): Promise<void> {
    this.needsRebuild = false;
    this.params = getEffectiveParameters();
    const rooms = this.rooms().filter((room) => room.setUp);
    const engineRooms = new Map<number, EngineRoom>();
    const sensors = new Map<string, Sensor>();
    const valves = new Map<string, Valve>();

    let snapshot: ValveSnapshot[] = [];
    try {
      snapshot = await this.deps.valves.getSnapshot();
    } catch (error) {
      this.deps.logger.warn({ error }, "Automatic control: no valve snapshot to start from");
    }
    const byId = new Map(snapshot.map((valve) => [valve.entity_id, valve]));

    for (const room of rooms) {
      const roomSensors = room.sensors.map((source) => {
        const sensor = new Sensor(sensorKey(source.entityId));
        sensors.set(source.entityId, sensor);
        return sensor;
      });
      const engineRoom = new EngineRoom(engineRoomId(room), roomSensors);
      engineRooms.set(room.id, engineRoom);
      for (const entityId of room.valves) {
        const valve = new Valve(entityId, 0, engineRoom, ValveType.Supply);
        const real = position(byId.get(entityId));
        if (real !== null) {
          valve.value = real;
          this.lastKnownPositions.set(entityId, real);
        }
        valves.set(entityId, valve);
      }
    }

    const hru = new RunnerHruAdapter();
    const engine = new AutomaticModeEngine(
      new Building([...engineRooms.values()], [new Box([...valves.values()])]),
      hru,
      { info: (message: string) => this.deps.logger.debug({ message }, "Algo CO2") },
    );
    applyEngineParams(engine, this.params);
    this.setup = { engine, hru, rooms, engineRooms, sensors, valves };
  }

  private updateReadings(setup: EngineSetup, now: Date): boolean {
    const maxAge = getMaxReadingAgeSeconds();
    let any = false;
    this.sensorStatus.clear();
    for (const room of setup.rooms) {
      for (const source of room.sensors) {
        const reading = readingFrom(
          this.deps.sensors.get(source.entityId),
          source.attribute,
          now.getTime(),
          maxAge,
          this.deps.sensors.changedAt?.(source.entityId, source.attribute),
        );
        const sensor = setup.sensors.get(source.entityId);
        if (sensor) sensor.co2 = reading.ppm;
        if (reading.ppm !== null) any = true;
        this.sensorStatus.set(source.entityId, {
          entityId: source.entityId,
          attribute: source.attribute,
          ppm: reading.ppm,
          problem: reading.problem ?? null,
          ageSeconds: reading.ageSeconds === undefined ? null : Math.round(reading.ageSeconds),
        });
      }
    }
    return any;
  }

  /** The unit's current power on the engine's scale, or null without a usable read. */
  private currentPower(
    scale: PowerScale,
    nowMs: number,
  ): { power: number; unitValue: number } | null {
    const cached = this.deps.hru.getCachedRead();
    const failure = this.deps.hru.getReadFailure();
    if (!cached || nowMs - cached.fetchedAt > HRU_READ_MAX_AGE_MS) return null;
    if (failure && failure.at > cached.fetchedAt) return null;
    let unitValue = cached.result.values[scale.variable];
    if (unitValue === undefined || !Number.isFinite(unitValue)) return null;
    // A write the monitor has not read back yet: the unit has it, the cache does not.
    if (this.writtenPower && this.writtenPower.at > cached.fetchedAt) {
      unitValue = this.writtenPower.unitValue;
    }
    return { power: scale.fromUnit(unitValue), unitValue };
  }

  private setReason(reason: CannotRunReason | null): void {
    if (reason === this.reason) return;
    this.journal("cannotRun", { reason, previous: this.reason });
    if (reason) this.deps.logger.warn({ reason }, "Automatic control cannot run");
    else this.deps.logger.info({ previous: this.reason }, "Automatic control can run again");
    // A stretch that could not run starts again from a fresh engine.
    if (reason === null && this.reason !== null) this.needsRebuild = true;
    this.reason = reason;
  }

  /**
   * One run. Returns the reason automatic control cannot run, or null when it ran. The caller applies the safe
   * state while a reason is returned.
   */
  async tick(): Promise<CannotRunReason | null> {
    if (!this.isActive()) await this.activate();
    if (this.needsRebuild || !this.setup) await this.build();
    const setup = this.setup!;
    const now = this.now();

    const config = this.deps.hru.getResolvedConfiguration();
    this.scale = config ? powerScaleFor(config.unit.variables, config.settings) : null;
    const hasReading = this.updateReadings(setup, now);
    const current = this.scale ? this.currentPower(this.scale, now.getTime()) : null;

    let reason: CannotRunReason | null = null;
    if (setup.rooms.length === 0) reason = "noRooms";
    else if (!this.scale) reason = "noPowerMax";
    else if (!current) reason = "hruUnavailable";
    else if (!hasReading) reason = "noReadings";
    this.setReason(reason);
    // Clearing a reason marks a rebuild (setReason): the engine did not run meanwhile, and its timers would
    // describe the house before the gap.
    if (reason) return reason;
    if (this.needsRebuild) {
      await this.build();
      return this.tick();
    }

    const scale = this.scale!;
    const { engine, hru } = setup;
    hru.power = current!.power;
    hru.requested = null;
    this.params ??= getEffectiveParameters();
    engine.hruPowerStep = scale.effectiveStep(this.params.hruPowerStep);

    const secondOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const previousBranch = this.lastReport?.branch ?? null;
    const report = engine.run(new Timestamp(Math.floor(now.getTime() / 1000), secondOfDay));
    this.lastReport = report;
    this.lastRunAt = now;

    const moved = await this.writeValves(setup);
    const power = await this.writePower(scale, hru, current!.unitValue);

    const rooms = this.roomSummary(setup);
    if (report.branch !== previousBranch) {
      this.journal("branch", { from: previousBranch, to: report.branch, rooms });
    }
    if (moved.length > 0) this.journal("valves", { valves: moved, rooms });
    if (report.powerAfter !== report.powerBefore || power) {
      this.journal("power", {
        before: report.powerBefore,
        after: report.powerAfter,
        unit: power,
        review: report.powerReview,
        rooms,
      });
    }
    return null;
  }

  private async writeValves(setup: EngineSetup) {
    const moved: { entityId: string; from: number | null; to: number }[] = [];
    for (const [entityId, valve] of setup.valves) {
      const known = this.lastKnownPositions.get(entityId) ?? null;
      if (known === valve.value) continue;
      try {
        await this.deps.valves.setValue(entityId, valve.value);
        this.lastKnownPositions.set(entityId, valve.value);
        moved.push({ entityId, from: known, to: valve.value });
      } catch (error) {
        // Left as unknown, so the next tick tries again.
        this.deps.logger.error({ error, entityId }, "Automatic control: could not move a valve");
      }
    }
    return moved;
  }

  private async writePower(scale: PowerScale, hru: RunnerHruAdapter, currentUnit: number) {
    if (hru.requested === null) return null;
    const unitValue = scale.toUnit(hru.requested);
    if (unitValue === currentUnit) return null;
    try {
      await this.deps.hru.writeValues({ [scale.variable]: unitValue });
      this.writtenPower = { unitValue, at: this.now().getTime() };
      return { from: currentUnit, to: unitValue };
    } catch (error) {
      // The engine reads the old power back and asks again on its own.
      this.deps.logger.error({ error, unitValue }, "Automatic control: could not write the power");
      return null;
    }
  }

  private roomSummary(setup: EngineSetup) {
    return setup.rooms.map((room) => {
      const id = engineRoomId(room);
      return {
        id: room.id,
        name: room.name,
        co2: setup.engineRooms.get(room.id)?.getCO2() ?? null,
        filtered: setup.engine.getFilteredCO2(id),
        aboveTh1: this.lastReport?.roomsAboveTh1.includes(id) ?? false,
        aboveTh2: this.lastReport?.roomsAboveTh2.includes(id) ?? false,
      };
    });
  }

  /** Every valve of a set-up room, while automatic control runs. */
  lockedValves(): AutomaticStatus["lockedValves"] {
    if (!this.isActive()) return [];
    return this.rooms()
      .filter((room) => room.setUp)
      .flatMap((room) =>
        room.valves.map((entityId) => ({ entityId, roomId: room.id, roomName: room.name })),
      );
  }

  status(): AutomaticStatus {
    const report = this.isActive() ? this.lastReport : null;
    const setup = this.isActive() ? this.setup : null;
    const scale = this.scale;
    const rooms: RoomStatus[] = this.rooms().map((room) => {
      const id = engineRoomId(room);
      const engineRoom = setup?.engineRooms.get(room.id);
      const co2 = engineRoom?.getCO2() ?? null;
      let condition: RoomCondition | null = null;
      if (report && engineRoom) {
        if (!report.roomsWithReading.includes(id)) condition = "noReading";
        else if (report.roomsAboveTh2.includes(id)) condition = "aboveTh2";
        else if (report.roomsAboveTh1.includes(id)) condition = "aboveTh1";
        else condition = "belowTh1";
      }
      return {
        id: room.id,
        name: room.name,
        setUp: room.setUp,
        co2,
        filteredCo2: setup && engineRoom ? setup.engine.getFilteredCO2(id) : null,
        condition,
        inCooldown: report?.roomsInCooldown.includes(id) ?? false,
        valves: room.valves.map((entityId) => ({
          entityId,
          position: this.lastKnownPositions.get(entityId) ?? null,
        })),
        sensors: room.sensors.map(
          (source) =>
            this.sensorStatus.get(source.entityId) ?? {
              entityId: source.entityId,
              attribute: source.attribute,
              ppm: null,
              problem: null,
              ageSeconds: null,
            },
        ),
      };
    });

    return {
      active: this.isActive(),
      reason: this.getReason(),
      startedAt: this.startedAt?.toISOString() ?? null,
      lastRunAt: report ? (this.lastRunAt?.toISOString() ?? null) : null,
      engineTime: report && this.lastRunAt ? timeOfDay(this.lastRunAt) : null,
      branch: report?.branch ?? null,
      fluctuationActive: report?.fluctuationActive ?? false,
      powerReview: report?.powerReview ?? null,
      power: report
        ? {
            before: report.powerBefore,
            after: report.powerAfter,
            max: report.maxPower,
            unit: scale
              ? {
                  before: scale.toUnit(report.powerBefore),
                  after: scale.toUnit(report.powerAfter),
                  max: scale.toUnit(report.maxPower),
                }
              : null,
          }
        : null,
      rooms,
      lockedValves: this.lockedValves(),
    };
  }

  /** The power conversion of the configured unit, for the parameters page. */
  currentScale(): PowerScale | null {
    const config = this.deps.hru.getResolvedConfiguration();
    return config ? powerScaleFor(config.unit.variables, config.settings) : null;
  }
}
