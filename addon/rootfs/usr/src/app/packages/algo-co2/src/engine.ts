import type { Building, Room, Valve } from "./model.js";

export class Timestamp {
  static now(): Timestamp {
    const now = new Date();
    const currentEpochSecond = Math.floor(now.getTime() / 1000);
    const secondOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    return new Timestamp(currentEpochSecond, secondOfDay);
  }

  static simulate(epochSecond: number, startHour: number): Timestamp {
    return new Timestamp(epochSecond, (epochSecond + startHour * 3600) % (24 * 3600));
  }

  constructor(
    readonly epochSecond: number,
    readonly secondOfDay: number,
  ) {}
}

class JournalEntry {
  constructor(
    readonly timestamp: Timestamp,
    readonly unitPower: number,
    readonly valves: Map<string, number>,
  ) {}
  toString(): string {
    return `${this.timestamp.epochSecond},${this.unitPower},${[...this.valves].map(([key, value]) => `${key}:${value}`).join(",")}`;
  }
}

export enum ThresholdType {
  TH1 = "th1",
  TH2 = "th2",
}

export enum ThresholdDirection {
  Above = "above",
  Below = "below",
}

export interface RoomState {
  filteredCO2: number | null;
  aboveThresholdSince: Map<ThresholdType, number | null>;
  belowThresholdSince: Map<ThresholdType, number | null>;
  lastChangeTimestamp: Timestamp | null;
}

export interface HRU {
  getPower(): number;

  setPower(power: number): void;
}

export interface OnValveChange {
  updateValves(valves: Map<string, number>): void;
}

/** The branch of `run()` that applied; `none` is the hysteresis band or a wait for the time limit. */
export type DecisionBranch = "th2" | "th1" | "allBelow" | "none";

/** What one `run()` saw and did. Room-id lists are unique and in `building.rooms` order. */
export interface RunReport {
  branch: DecisionBranch;
  roomsWithReading: string[];
  /** Above TH2 for `thresholdTimeLimit`. */
  roomsAboveTh2: string[];
  /** Above TH1 for `thresholdTimeLimit`. */
  roomsAboveTh1: string[];
  /** Below TH1 - hysteresis for `thresholdTimeLimit`. */
  roomsBelowTh1: string[];
  /**
   * With a reading and acted on within `thresholdTimeLimit` before this run: the state at the start
   * of the run, so a room acted on in this run is not listed in the same report.
   */
  roomsInCooldown: string[];
  /** The rooms the engine marked as changed in this run. */
  roomsActedOn: string[];
  valvesChanged: boolean;
  powerBefore: number;
  powerAfter: number;
  /** The day or night HRU maximum at this timestamp. */
  maxPower: number;
}

/** The only logging the engine needs; a pino logger satisfies it as is. */
export interface Logger {
  info(message: string): void;
}

export class AutomaticModeEngine {
  thresholds: Map<ThresholdType, number> = new Map([
    [ThresholdType.TH1, 800],
    [ThresholdType.TH2, 1200],
  ]);
  co2Hysteresis: number = 50;
  thresholdTimeLimit: number = 120;
  co2FilterAlpha: number = 0.3;

  hruMinPower: number = 20;
  hruMaxPowerDay: number = 100;
  hruMaxPowerNight: number = 50;
  hruPowerStep: number = 10;

  partialCloseValue: number = 45;
  fullyOpenValue: number = 0;

  dayStart: number = 7 * 60 * 60;
  dayEnd: number = 22 * 60 * 60;

  useJournal: boolean = false;
  private journal: JournalEntry[] = [];

  private readonly roomStates: Map<string, RoomState> = new Map();

  onValveChange: (valves: Map<string, number>) => void = () => {
    // No listener until the application registers one.
  };

  constructor(
    private readonly model: Building,
    private readonly hru: HRU,
    private readonly logger: Logger,
  ) {
    for (const room of model.rooms) {
      const thresholdTimes = new Map<ThresholdType, number | null>();
      const belowThresholdTimes = new Map<ThresholdType, number | null>();
      for (const thresholdType of Object.values(ThresholdType)) {
        thresholdTimes.set(thresholdType, null);
        belowThresholdTimes.set(thresholdType, null);
      }
      this.roomStates.set(room.id, {
        filteredCO2: null,
        aboveThresholdSince: thresholdTimes,
        belowThresholdSince: belowThresholdTimes,
        lastChangeTimestamp: null,
      });
    }
  }

  run(timestamp: Timestamp): RunReport {
    this.updateFilteredCO2Values(timestamp);

    const roomsWithValidMeasurement = this.model.rooms.filter((r) => r.getCO2() !== null);

    // brat v potaz popuze ty mistnosti, ktere neovlivnili stav posledni 2 minuty
    const roomsWithoutActionForTimeLimit = new Set(
      roomsWithValidMeasurement
        .filter((r) => {
          const state = this.getState(r);
          return (
            state.lastChangeTimestamp === null ||
            state.lastChangeTimestamp.epochSecond <= timestamp.epochSecond - this.thresholdTimeLimit
          );
        })
        .map((r) => r.id),
    );

    const roomsAboveThreshold1ForTimeLimit = this.getRoomsPastThreshold(
      roomsWithValidMeasurement,
      ThresholdDirection.Above,
      ThresholdType.TH1,
      timestamp.epochSecond,
      this.thresholdTimeLimit,
    );
    const roomsAboveThreshold2ForTimeLimit = this.getRoomsPastThreshold(
      roomsWithValidMeasurement,
      ThresholdDirection.Above,
      ThresholdType.TH2,
      timestamp.epochSecond,
      this.thresholdTimeLimit,
    );
    const roomsBelowThreshold1ForTimeLimit = this.getRoomsPastThreshold(
      roomsWithValidMeasurement,
      ThresholdDirection.Below,
      ThresholdType.TH1,
      timestamp.epochSecond,
      this.thresholdTimeLimit,
    );

    const powerBefore = this.hru.getPower();
    let branch: DecisionBranch = "none";
    let roomsActedOn: Room[] = [];
    let valvesChanged = false;

    if (roomsAboveThreshold2ForTimeLimit.length > 0) {
      branch = "th2";
      const roomWithAtLeastThreshold1 = [
        ...roomsAboveThreshold1ForTimeLimit,
        ...roomsAboveThreshold2ForTimeLimit,
      ];
      valvesChanged = this.applyValveStrategy(roomWithAtLeastThreshold1, timestamp);
      const roomsToUpdate = roomWithAtLeastThreshold1.filter((r) =>
        roomsWithoutActionForTimeLimit.has(r.id),
      );
      if (roomsToUpdate.length > 0) {
        this.increasePower(timestamp);
        this.markChanged(roomsToUpdate, timestamp);
        roomsActedOn = roomsToUpdate;
      }
    } else if (roomsAboveThreshold1ForTimeLimit.length > 0) {
      branch = "th1";
      const roomsToUpdate = roomsAboveThreshold1ForTimeLimit.filter((r) =>
        roomsWithoutActionForTimeLimit.has(r.id),
      );
      if (roomsToUpdate.length > 0) {
        valvesChanged = this.applyValveStrategy(roomsToUpdate, timestamp);
        this.markChanged(roomsToUpdate, timestamp);
        roomsActedOn = roomsToUpdate;
      }
    } else if (roomsBelowThreshold1ForTimeLimit.length === roomsWithValidMeasurement.length) {
      branch = "allBelow";
      valvesChanged = this.resetValvesToDefault(timestamp);
      this.decreasePowerIfPossible(timestamp);
      this.markChanged(roomsWithValidMeasurement, timestamp);
      roomsActedOn = roomsWithValidMeasurement;
    }

    return {
      branch,
      roomsWithReading: this.toRoomIds(roomsWithValidMeasurement),
      roomsAboveTh2: this.toRoomIds(roomsAboveThreshold2ForTimeLimit),
      roomsAboveTh1: this.toRoomIds(roomsAboveThreshold1ForTimeLimit),
      roomsBelowTh1: this.toRoomIds(roomsBelowThreshold1ForTimeLimit),
      roomsInCooldown: this.toRoomIds(
        roomsWithValidMeasurement.filter((r) => !roomsWithoutActionForTimeLimit.has(r.id)),
      ),
      roomsActedOn: this.toRoomIds(roomsActedOn),
      valvesChanged,
      powerBefore,
      powerAfter: this.hru.getPower(),
      maxPower: this.getHruMaxPower(timestamp),
    };
  }

  /** The ids of the given rooms, without repeats, in the order of `building.rooms`. */
  private toRoomIds(rooms: Room[]): string[] {
    const ids = new Set(rooms.map((r) => r.id));
    return this.model.rooms.filter((r) => ids.has(r.id)).map((r) => r.id);
  }

  private getState(room: Room): RoomState {
    const state = this.roomStates.get(room.id);
    if (state === undefined) {
      throw new Error(`Room ${room.id} was not in the building when the engine was created`);
    }
    return state;
  }

  private markChanged(rooms: Room[], timestamp: Timestamp): void {
    for (const room of rooms) {
      this.getState(room).lastChangeTimestamp = timestamp;
    }
  }

  private updateFilteredCO2Values(timestamp: Timestamp): void {
    for (const room of this.model.rooms) {
      const rawCO2 = room.getCO2();
      const state = this.getState(room);

      if (rawCO2 === null) {
        state.filteredCO2 = null;
        continue;
      }

      if (state.filteredCO2 === null) {
        state.filteredCO2 = rawCO2;
      } else {
        state.filteredCO2 = Math.round(
          this.co2FilterAlpha * rawCO2 + (1 - this.co2FilterAlpha) * state.filteredCO2,
        );
      }

      this.updateThresholdTimers(room, state, timestamp);
    }
  }

  private getHruMaxPower(timestamp: Timestamp): number {
    if (timestamp.secondOfDay < this.dayStart || timestamp.secondOfDay > this.dayEnd) {
      return this.hruMaxPowerNight;
    } else {
      return this.hruMaxPowerDay;
    }
  }

  private formatDayTime(timestamp: Timestamp): string {
    const hours = Math.floor(timestamp.secondOfDay / 3600);
    const minutes = Math.floor((timestamp.secondOfDay % 3600) / 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }

  private updateThresholdTimers(room: Room, state: RoomState, timestamp: Timestamp): void {
    const co2 = state.filteredCO2;
    if (co2 === null) return;

    for (const thresholdType of Object.values(ThresholdType)) {
      const thresholdUpper = this.thresholds.get(thresholdType);
      // An unset threshold can never be crossed.
      if (thresholdUpper === undefined) continue;
      const thresholdLower = thresholdUpper - this.co2Hysteresis;
      const aboveSince = state.aboveThresholdSince.get(thresholdType);
      const belowSince = state.belowThresholdSince.get(thresholdType);

      if (co2 >= thresholdUpper && aboveSince === null) {
        state.aboveThresholdSince.set(thresholdType, timestamp.epochSecond);
        state.belowThresholdSince.set(thresholdType, null);
        this.logger.info(
          `[${this.formatDayTime(timestamp)}] CO2 in room ${room.id} exceeded threshold ${thresholdType}: (${co2}>=${thresholdUpper})`,
        );
      } else if (co2 < thresholdLower && aboveSince !== null) {
        state.aboveThresholdSince.set(thresholdType, null);
        state.belowThresholdSince.set(thresholdType, timestamp.epochSecond);
        this.logger.info(
          `[${this.formatDayTime(timestamp)}] CO2 in room ${room.id} recovered under threshold ${thresholdType}: (${co2}<${thresholdLower})`,
        );
      } else if (co2 < thresholdLower && belowSince === null && aboveSince === null) {
        state.belowThresholdSince.set(thresholdType, timestamp.epochSecond);
      }
    }
  }

  private getRoomsPastThreshold(
    roomsToTest: Room[],
    direction: ThresholdDirection,
    thresholdType: ThresholdType,
    currentTimestamp: number,
    timeLimit: number,
  ): Room[] {
    const rooms: Room[] = [];

    for (const room of roomsToTest) {
      const state = this.getState(room);

      const sinceMap =
        direction === ThresholdDirection.Above
          ? state.aboveThresholdSince
          : state.belowThresholdSince;
      const since = sinceMap.get(thresholdType);
      if (since !== null && since !== undefined && currentTimestamp - since >= timeLimit) {
        rooms.push(room);
      }
    }
    return rooms;
  }

  private applyValveStrategy(affectedRooms: Room[], timestamp: Timestamp): boolean {
    const affectedRoomIds = new Set(affectedRooms.map((r) => r.id));
    const allValves = this.model.getAllValves();

    const valveMap = new Map<string, number>();
    let changed = false;
    for (const valve of allValves) {
      const valveRoomId = valve.room.id;
      const invalidCO2Measurement = valve.room.getCO2() === null;
      if (affectedRoomIds.has(valveRoomId) || invalidCO2Measurement) {
        if (this.setValve(valve, this.fullyOpenValue)) {
          changed = true;
          valveMap.set(valve.id, this.fullyOpenValue);
        }
      } else if (this.setValve(valve, this.partialCloseValue)) {
        changed = true;
        valveMap.set(valve.id, this.partialCloseValue);
      }
    }
    if (changed) {
      this.logger.info(
        `[${this.formatDayTime(timestamp)}] valves changed ${Array.from(valveMap.entries())
          .map((e) => `${e[0]}=${e[1]}`)
          .join(",")}`,
      );
      this.recordJournalEntry(timestamp);
    }
    return changed;
  }

  private resetValvesToDefault(timestamp: Timestamp): boolean {
    const allValves = this.model.getAllValves();
    let changed: boolean = false;
    for (const valve of allValves) {
      if (this.setValve(valve, valve.defaultValue)) {
        changed = true;
      }
    }
    if (changed) {
      this.logger.info(`[${this.formatDayTime(timestamp)}] opening all valves`);
      this.recordJournalEntry(timestamp);
    }
    return changed;
  }

  private recordJournalEntry(timestamp: Timestamp): void {
    if (!this.useJournal) return;
    const valves = new Map<string, number>();
    for (const valve of this.model.getAllValves()) {
      valves.set(valve.id, valve.value);
    }
    this.journal.push(new JournalEntry(timestamp, this.hru.getPower(), valves));
  }

  private setValve(valve: Valve, value: number): boolean {
    if (valve.value !== value) {
      valve.value = value;
      return true;
    }
    return false;
  }

  private increasePower(timestamp: Timestamp): void {
    const hruCurrentPower = this.hru.getPower();
    const newPower = Math.min(hruCurrentPower + this.hruPowerStep, this.getHruMaxPower(timestamp));
    if (newPower !== hruCurrentPower) {
      this.logger.info(
        `[${this.formatDayTime(timestamp)}] increasing HRU power from ${hruCurrentPower} to ${newPower}`,
      );
      this.hru.setPower(newPower);
      this.recordJournalEntry(timestamp);
    }
  }

  private decreasePowerIfPossible(timestamp: Timestamp): void {
    const hruCurrentPower = this.hru.getPower();
    if (hruCurrentPower > this.hruMinPower) {
      const newPower = Math.max(hruCurrentPower - this.hruPowerStep, this.hruMinPower);
      this.logger.info(
        `[${this.formatDayTime(timestamp)}] decreasing HRU power from ${hruCurrentPower} to ${newPower}`,
      );
      this.hru.setPower(newPower);
      this.recordJournalEntry(timestamp);
    }
  }

  getHruCurrentPower(): number {
    return this.hru.getPower();
  }

  getFilteredCO2(roomId: string): number | null {
    return this.roomStates.get(roomId)?.filteredCO2 ?? null;
  }

  getRoomState(roomId: string): RoomState | undefined {
    return this.roomStates.get(roomId);
  }

  clearJournal(): void {
    this.journal = [];
  }

  getJournalString(): string {
    return this.journal.map((entry) => `${entry.toString()}`).join(";");
  }
}
