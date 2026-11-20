import type { Building, Room, Valve } from "./model.js";

export class Timestamp {
  constructor(
    readonly epochSecond: number,
    readonly secondOfDay: number,
  ) {}

  static now(): Timestamp {
    const now = new Date();
    const currentEpochSecond = Math.floor(now.getTime() / 1000);
    const secondOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    return new Timestamp(currentEpochSecond, secondOfDay);
  }

  static simulate(epochSecond: number, startHour: number): Timestamp {
    return new Timestamp(epochSecond, (epochSecond + startHour * 3600) % (24 * 3600));
  }
}

class JournalEntry {
  constructor(
    readonly timestamp: Timestamp,
    readonly unitPower: number,
    readonly valves: Map<string, number>,
  ) {}

  toString(): string {
    const valves = [...this.valves].map(([key, value]) => `${key}:${value}`).join(",");
    return `${this.timestamp.epochSecond},${this.unitPower},${valves}`;
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
  /** Unrounded; the engine compares, reports and logs it rounded to whole ppm. */
  filteredCO2: number | null;
  /** The epoch second `filteredCO2` was last computed at; `null` while there is no filtered value. */
  filteredAt: number | null;
  aboveThresholdSince: Map<ThresholdType, number | null>;
  belowThresholdSince: Map<ThresholdType, number | null>;
  /** Since when the filtered CO2 has been at or above the fluctuation level, without a break. */
  fluctuationAboveSince: number | null;
  /** Since when the filtered CO2 has been below the fluctuation level, without a break. */
  fluctuationBelowSince: number | null;
  lastChangeTimestamp: Timestamp | null;
  /**
   * The epoch second of the last power step in the `th2` branch that this room allowed. Separate from
   * `lastChangeTimestamp` so that the `th1` and `allBelow` branches cannot hold a power step back.
   */
  lastPowerStepAt: number | null;
}

/**
 * The HRU as the engine sees it. Power is on a scale from 0 (zero) to 10 (the unit's maximum), with
 * decimals; converting to and from the unit's own values is the caller's job.
 */
export interface HRU {
  getPower(): number;

  setPower(power: number): void;
}

/** The branch of `run()` that applied; `none` is a state that has not lasted its time limit yet. */
export type DecisionBranch = "th2" | "th1" | "fluctuation" | "allBelow" | "none";

/** What one `run()` saw and did. Room-id lists are unique and in `building.rooms` order. */
export interface RunReport {
  branch: DecisionBranch;
  roomsWithReading: string[];
  /** Above TH2 for `thresholdTimeLimit` (Tzone). */
  roomsAboveTh2: string[];
  /** Above TH1 for `thresholdTimeLimit` (Tzone). */
  roomsAboveTh1: string[];
  /** Below TH1 minus its hysteresis for `belowTimeLimit` (Topen). */
  roomsBelowTh1: string[];
  /**
   * With a reading and acted on within `thresholdTimeLimit` before this run: the state at the start
   * of the run, so a room acted on in this run is not listed in the same report.
   */
  roomsInCooldown: string[];
  /** The rooms the engine marked as changed in this run. */
  roomsActedOn: string[];
  valvesChanged: boolean;
  /** HRU power before and after the run, on the 0–10 scale. */
  powerBefore: number;
  powerAfter: number;
  /** The day or night HRU maximum at this timestamp, on the 0–10 scale. */
  maxPower: number;
  /** Whether fluctuation is active after this run. */
  fluctuationActive: boolean;
  /** At or above the fluctuation level (`TH1 - fluctuationOffset`) for `thresholdTimeLimit`. */
  roomsAboveFluctuation: string[];
}

/** The only logging the engine needs; a pino logger satisfies it as is. */
export interface Logger {
  info(message: string): void;
}

function isFiniteAbove(value: number | undefined, limit: number): value is number {
  return value !== undefined && Number.isFinite(value) && value > limit;
}

function isFiniteAtLeast(value: number | undefined, limit: number): value is number {
  return value !== undefined && Number.isFinite(value) && value >= limit;
}

/** Two decimals: steps such as 0.1 would otherwise drift (0.1 + 0.2 = 0.30000000000000004). */
function roundPower(power: number): number {
  return Math.round(power * 100) / 100;
}

export class AutomaticModeEngine {
  thresholds: Map<ThresholdType, number> = new Map([
    [ThresholdType.TH1, 800],
    [ThresholdType.TH2, 1200],
  ]);
  /** ppm a room must fall below a threshold to count as below it (TH1diff, TH2diff); 0 when unset. */
  co2Hysteresis: Map<ThresholdType, number> = new Map([
    [ThresholdType.TH1, 50],
    [ThresholdType.TH2, 100],
  ]);
  /** Tzone: seconds above a threshold before it counts; also the per-room cooldown. */
  thresholdTimeLimit: number = 120;
  /** Topen: seconds below a threshold, or below the fluctuation level, before it counts. */
  belowTimeLimit: number = 120;
  /** Weight of the newest reading per second; over several seconds it grows as `1 - (1 - alpha)^dt`. */
  co2FilterAlpha: number = 0.3;

  // HRU powers are on the 0–10 scale (0 = zero, 10 = the unit's maximum), see `HRU`.
  hruMinPower: number = 2;
  hruMaxPowerDay: number = 10;
  hruMaxPowerNight: number = 5;
  hruPowerStep: number = 1;
  /**
   * Seconds one step down takes while the `allBelow` or `fluctuation` branch keeps applying. Anything
   * that is not a finite number above 0 means no limit: the power goes straight to the branch's floor.
   */
  hruPowerStepDownInterval: number = 1;
  /** HRU power held while fluctuation is active (Pmove). */
  hruMovePower: number = 4;

  /** Fluctuation: several rooms slightly raised by people moving around the house. */
  fluctuationEnabled: boolean = true;
  /** How far below TH1 the fluctuation level lies, in ppm. */
  fluctuationOffset: number = 100;

  partialCloseValue: number = 45;
  fullyOpenValue: number = 0;

  dayStart: number = 7 * 60 * 60;
  dayEnd: number = 22 * 60 * 60;

  useJournal: boolean = false;
  private journal: JournalEntry[] = [];

  private readonly roomStates: Map<string, RoomState> = new Map();
  private fluctuationActive: boolean = false;
  /** The previous run: when it was and whether its branch lowers the power step by step. */
  private previousRun: { epochSecond: number; lowering: boolean } | null = null;
  /** Seconds of a lowering stretch not yet turned into steps down. */
  private stepDownCredit: number = 0;
  /**
   * Powers written and not yet read back from the HRU, with the epoch second of the write. More than
   * one can wait at a time: with a unit that is off, the minimum and Pmove are both written.
   */
  private readonly pendingPowerWrites: Map<number, number> = new Map();

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
        filteredAt: null,
        aboveThresholdSince: thresholdTimes,
        belowThresholdSince: belowThresholdTimes,
        fluctuationAboveSince: null,
        fluctuationBelowSince: null,
        lastChangeTimestamp: null,
        lastPowerStepAt: null,
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
      this.belowTimeLimit,
    );
    const roomsAboveFluctuationForTimeLimit = roomsWithValidMeasurement.filter((r) =>
      this.isPastTimeLimit(
        this.getState(r).fluctuationAboveSince,
        timestamp,
        this.thresholdTimeLimit,
      ),
    );
    this.updateFluctuationState(
      roomsWithValidMeasurement,
      roomsAboveFluctuationForTimeLimit,
      roomsAboveThreshold1ForTimeLimit.length > 0 || roomsAboveThreshold2ForTimeLimit.length > 0,
      timestamp,
    );

    const powerBefore = this.hru.getPower();
    this.enforcePowerLimits(timestamp);
    let branch: DecisionBranch = "none";
    let roomsActedOn: Room[] = [];
    let valvesChanged = false;

    if (roomsAboveThreshold2ForTimeLimit.length > 0) {
      branch = "th2";
      const roomWithAtLeastThreshold1 = [
        ...new Set([...roomsAboveThreshold1ForTimeLimit, ...roomsAboveThreshold2ForTimeLimit]),
      ];
      valvesChanged = this.applyValveStrategy(roomWithAtLeastThreshold1, timestamp);
      const roomsToUpdate = roomWithAtLeastThreshold1.filter((r) => {
        const lastPowerStepAt = this.getState(r).lastPowerStepAt;
        return (
          lastPowerStepAt === null ||
          lastPowerStepAt <= timestamp.epochSecond - this.thresholdTimeLimit
        );
      });
      if (roomsToUpdate.length > 0) {
        this.increasePower(timestamp);
        for (const room of roomsToUpdate) {
          this.getState(room).lastPowerStepAt = timestamp.epochSecond;
        }
        this.markChanged(roomsToUpdate, timestamp);
        roomsActedOn = roomsToUpdate;
      }
    } else if (roomsAboveThreshold1ForTimeLimit.length > 0) {
      branch = "th1";
      const roomsToUpdate = roomsAboveThreshold1ForTimeLimit.filter((r) =>
        roomsWithoutActionForTimeLimit.has(r.id),
      );
      if (roomsToUpdate.length > 0) {
        // Every room above TH1 stays open; closing the ones in cooldown made them take turns.
        valvesChanged = this.applyValveStrategy(roomsAboveThreshold1ForTimeLimit, timestamp);
        this.markChanged(roomsToUpdate, timestamp);
        roomsActedOn = roomsToUpdate;
      }
    } else if (this.fluctuationActive) {
      // No markChanged: a room that crosses TH1 next must not start in cooldown.
      branch = "fluctuation";
      valvesChanged = this.resetValvesToDefault(timestamp);
      this.movePowerTowardsMovePower(timestamp, this.takeStepsDown(timestamp));
    } else if (roomsBelowThreshold1ForTimeLimit.length === roomsWithValidMeasurement.length) {
      branch = "allBelow";
      valvesChanged = this.resetValvesToDefault(timestamp);
      this.decreasePowerIfPossible(timestamp, this.takeStepsDown(timestamp));
      this.markChanged(roomsWithValidMeasurement, timestamp);
      roomsActedOn = roomsWithValidMeasurement;
    }

    const lowering = branch === "fluctuation" || branch === "allBelow";
    if (!lowering) this.stepDownCredit = 0;
    this.previousRun = { epochSecond: timestamp.epochSecond, lowering };

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
      fluctuationActive: this.fluctuationActive,
      roomsAboveFluctuation: this.toRoomIds(roomsAboveFluctuationForTimeLimit),
    };
  }

  /**
   * What is wrong with the current parameter values, one message per problem; empty when nothing is.
   * The engine never calls this itself and runs whatever the values are: the caller decides.
   */
  getParameterProblems(): string[] {
    const problems: string[] = [];
    const th1 = this.thresholds.get(ThresholdType.TH1);
    const th2 = this.thresholds.get(ThresholdType.TH2);
    const th1Valid = isFiniteAbove(th1, 0);
    const th2Valid = isFiniteAbove(th2, 0);
    if (!th1Valid) problems.push("thresholds TH1 must be a finite number above 0");
    if (!th2Valid) problems.push("thresholds TH2 must be a finite number above 0");
    if (th1Valid && th2Valid && th2 <= th1) problems.push("thresholds TH2 must be above TH1");

    const hysteresis1 = this.co2Hysteresis.get(ThresholdType.TH1) ?? 0;
    const hysteresis2 = this.co2Hysteresis.get(ThresholdType.TH2) ?? 0;
    if (!isFiniteAtLeast(hysteresis1, 0) || (th1Valid && hysteresis1 >= th1)) {
      problems.push("co2Hysteresis TH1 must be a finite number from 0 to below TH1");
    }
    if (!isFiniteAtLeast(hysteresis2, 0) || (th2Valid && hysteresis2 >= th2)) {
      problems.push("co2Hysteresis TH2 must be a finite number from 0 to below TH2");
    } else if (th1Valid && th2Valid && th2 > th1 && th2 - hysteresis2 <= th1) {
      problems.push("co2Hysteresis TH2 must leave TH2 minus the hysteresis above TH1");
    }
    if (
      !isFiniteAtLeast(this.fluctuationOffset, 0) ||
      (th1Valid && this.fluctuationOffset >= th1)
    ) {
      problems.push("fluctuationOffset must be a finite number from 0 to below TH1");
    }

    for (const name of ["thresholdTimeLimit", "belowTimeLimit"] as const) {
      if (!isFiniteAtLeast(this[name], 0))
        problems.push(`${name} must be a finite number, 0 or more`);
    }
    if (!isFiniteAbove(this.co2FilterAlpha, 0) || this.co2FilterAlpha > 1) {
      problems.push("co2FilterAlpha must be above 0 and at most 1");
    }
    for (const name of ["hruPowerStep", "hruPowerStepDownInterval"] as const) {
      if (!isFiniteAbove(this[name], 0)) problems.push(`${name} must be a finite number above 0`);
    }

    const powers = ["hruMinPower", "hruMaxPowerDay", "hruMaxPowerNight", "hruMovePower"] as const;
    const powerValid = new Map<string, boolean>();
    for (const name of powers) {
      const valid = isFiniteAtLeast(this[name], 0) && this[name] <= 10;
      powerValid.set(name, valid);
      if (!valid) problems.push(`${name} must be a finite number from 0 to 10`);
    }
    for (const name of ["hruMaxPowerDay", "hruMaxPowerNight"] as const) {
      if (powerValid.get("hruMinPower") && powerValid.get(name) && this.hruMinPower > this[name]) {
        problems.push(`hruMinPower must not be above ${name}`);
      }
    }
    if (powerValid.get("hruMovePower") && powerValid.get("hruMinPower")) {
      if (this.hruMovePower < this.hruMinPower) {
        problems.push("hruMovePower must not be below hruMinPower");
      }
    }
    if (powerValid.get("hruMovePower") && powerValid.get("hruMaxPowerDay")) {
      if (this.hruMovePower > this.hruMaxPowerDay) {
        problems.push("hruMovePower must not be above hruMaxPowerDay");
      }
    }

    const openValid = isFiniteAtLeast(this.fullyOpenValue, 0);
    const partialValid = isFiniteAtLeast(this.partialCloseValue, 0);
    if (!openValid) problems.push("fullyOpenValue must be a finite number, 0 or more");
    if (!partialValid) problems.push("partialCloseValue must be a finite number, 0 or more");
    if (openValid && partialValid && this.partialCloseValue <= this.fullyOpenValue) {
      problems.push("partialCloseValue must be greater than fullyOpenValue");
    }

    const dayBoundsValid = (["dayStart", "dayEnd"] as const).map((name) => {
      const valid = Number.isInteger(this[name]) && this[name] >= 0 && this[name] <= 86399;
      if (!valid) problems.push(`${name} must be a whole second of the day, 0 to 86399`);
      return valid;
    });
    if (dayBoundsValid.every(Boolean) && this.dayStart === this.dayEnd) {
      problems.push("dayStart and dayEnd must differ");
    }
    return problems;
  }

  getHruCurrentPower(): number {
    return this.hru.getPower();
  }

  /** The filtered CO2 of a room in whole ppm, as the engine compares it with the thresholds. */
  getFilteredCO2(roomId: string): number | null {
    const state = this.roomStates.get(roomId);
    return state === undefined ? null : this.getRoundedCO2(state);
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

  private isPastTimeLimit(since: number | null, timestamp: Timestamp, limit: number): boolean {
    return since !== null && timestamp.epochSecond - since >= limit;
  }

  /**
   * Switches fluctuation on when two or more rooms have been at the fluctuation level for Tzone and no
   * room is above TH1 or TH2; keeps it on until every room has been below the level for Topen, so it
   * does not flap around the level.
   */
  private updateFluctuationState(
    roomsWithReading: Room[],
    roomsAboveFluctuation: Room[],
    anyRoomAboveThreshold: boolean,
    timestamp: Timestamp,
  ): void {
    const wasActive = this.fluctuationActive;
    if (!this.fluctuationEnabled || roomsWithReading.length === 0) {
      this.fluctuationActive = false;
    } else if (wasActive) {
      this.fluctuationActive = !roomsWithReading.every((r) =>
        this.isPastTimeLimit(
          this.getState(r).fluctuationBelowSince,
          timestamp,
          this.belowTimeLimit,
        ),
      );
    } else {
      this.fluctuationActive = roomsAboveFluctuation.length >= 2 && !anyRoomAboveThreshold;
    }
    if (this.fluctuationActive !== wasActive) {
      this.logger.info(
        `[${this.formatDayTime(timestamp)}] fluctuation ${this.fluctuationActive ? "on" : "off"}`,
      );
    }
  }

  /** `TH1 - fluctuationOffset`; without a TH1 no room can reach it. */
  private getFluctuationLevel(): number {
    return (this.thresholds.get(ThresholdType.TH1) ?? Infinity) - this.fluctuationOffset;
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
        state.filteredAt = null;
        state.fluctuationAboveSince = null;
        state.fluctuationBelowSince = null;
        continue;
      }

      if (state.filteredCO2 === null || state.filteredAt === null) {
        state.filteredCO2 = rawCO2;
        state.filteredAt = timestamp.epochSecond;
      } else if (timestamp.epochSecond > state.filteredAt) {
        const weight = this.getFilterWeight(timestamp.epochSecond - state.filteredAt);
        // Kept unrounded: a rounded state stops moving once the remaining distance rounds to nothing.
        state.filteredCO2 = weight * rawCO2 + (1 - weight) * state.filteredCO2;
        state.filteredAt = timestamp.epochSecond;
      }

      this.updateThresholdTimers(room, state, timestamp);
      this.updateFluctuationTimers(state, timestamp);
    }
  }

  /**
   * The filtered value in whole ppm. Everything that compares or shows it goes through here: unrounded,
   * a moving average only ever approaches a steady reading, so `>= threshold` would never become true
   * for a room that sits exactly on the threshold.
   */
  private getRoundedCO2(state: RoomState): number | null {
    return state.filteredCO2 === null ? null : Math.round(state.filteredCO2);
  }

  /** Unlike the TH timers there is no hysteresis: crossing the level restarts the other timer. */
  private updateFluctuationTimers(state: RoomState, timestamp: Timestamp): void {
    const co2 = this.getRoundedCO2(state);
    if (co2 === null) return;

    if (co2 >= this.getFluctuationLevel()) {
      state.fluctuationBelowSince = null;
      state.fluctuationAboveSince ??= timestamp.epochSecond;
    } else {
      state.fluctuationAboveSince = null;
      state.fluctuationBelowSince ??= timestamp.epochSecond;
    }
  }

  /**
   * The weight of the newest reading after `elapsedSeconds`: what applying `co2FilterAlpha` once per
   * second would add up to. One second returns alpha itself, so a 1 s period is exact.
   */
  private getFilterWeight(elapsedSeconds: number): number {
    if (elapsedSeconds === 1) return this.co2FilterAlpha;
    return 1 - Math.pow(1 - this.co2FilterAlpha, elapsedSeconds);
  }

  /**
   * Day runs from `dayStart` to `dayEnd`, both included. With `dayStart` after `dayEnd` it runs through
   * midnight, and night is the stretch in between.
   */
  private isDay(secondOfDay: number): boolean {
    if (this.dayStart <= this.dayEnd) {
      return secondOfDay >= this.dayStart && secondOfDay <= this.dayEnd;
    }
    return secondOfDay >= this.dayStart || secondOfDay <= this.dayEnd;
  }

  private getHruMaxPower(timestamp: Timestamp): number {
    return this.isDay(timestamp.secondOfDay) ? this.hruMaxPowerDay : this.hruMaxPowerNight;
  }

  private formatDayTime(timestamp: Timestamp): string {
    const hours = Math.floor(timestamp.secondOfDay / 3600);
    const minutes = Math.floor((timestamp.secondOfDay % 3600) / 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }

  private updateThresholdTimers(room: Room, state: RoomState, timestamp: Timestamp): void {
    const co2 = this.getRoundedCO2(state);
    if (co2 === null) return;

    for (const thresholdType of Object.values(ThresholdType)) {
      const thresholdUpper = this.thresholds.get(thresholdType);
      // An unset threshold can never be crossed.
      if (thresholdUpper === undefined) continue;
      const thresholdLower = thresholdUpper - (this.co2Hysteresis.get(thresholdType) ?? 0);
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
      } else if (belowSince === null && aboveSince === null) {
        // A room without a state yet: under the threshold it is below, even inside the hysteresis band.
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

  /**
   * Brings a power outside the limits back in one write, whatever the branch: down to the day or night
   * maximum, up to `hruMinPower`. Where the minimum is above the maximum, the maximum wins. Not an
   * action on a room: nothing is marked as changed.
   */
  private enforcePowerLimits(timestamp: Timestamp): void {
    const hruCurrentPower = this.hru.getPower();
    // The HRU followed a write, so it is responding: nothing is waiting any more.
    if (this.pendingPowerWrites.has(hruCurrentPower)) this.pendingPowerWrites.clear();

    const maxPower = roundPower(this.getHruMaxPower(timestamp));
    // An unavailable HRU reports `NaN`: there is nothing to compare, so nothing is written.
    if (!Number.isFinite(hruCurrentPower) || !Number.isFinite(maxPower)) return;
    const minPower = roundPower(Math.min(this.hruMinPower, maxPower));

    if (hruCurrentPower > maxPower) {
      this.writePower(
        timestamp,
        maxPower,
        `lowering HRU power from ${hruCurrentPower} to ${maxPower} (maximum)`,
      );
    } else if (hruCurrentPower < minPower) {
      this.writePower(
        timestamp,
        minPower,
        `raising HRU power from ${hruCurrentPower} to ${minPower} (minimum)`,
      );
    }
  }

  /**
   * The one place a power is written. A write the HRU does not follow (a unit that is off, a dropped
   * write, a unit that rounds to its own steps) is not repeated on every run: the same value is written
   * again only after `thresholdTimeLimit`. A unit that follows is not affected, because the next run
   * reads the value back and clears the memory.
   */
  private writePower(timestamp: Timestamp, power: number, description: string): void {
    const writtenAt = this.pendingPowerWrites.get(power);
    if (writtenAt !== undefined && timestamp.epochSecond - writtenAt < this.thresholdTimeLimit) {
      return;
    }
    this.logger.info(`[${this.formatDayTime(timestamp)}] ${description}`);
    this.hru.setPower(power);
    this.pendingPowerWrites.set(power, timestamp.epochSecond);
    this.recordJournalEntry(timestamp);
  }

  private increasePower(timestamp: Timestamp): void {
    const hruCurrentPower = this.hru.getPower();
    const newPower = roundPower(
      Math.min(hruCurrentPower + this.hruPowerStep, this.getHruMaxPower(timestamp)),
    );
    // Only upwards: an HRU whose read-back lags can still report a power above the maximum here.
    if (newPower > hruCurrentPower) {
      this.writePower(
        timestamp,
        newPower,
        `increasing HRU power from ${hruCurrentPower} to ${newPower}`,
      );
    }
  }

  /**
   * How many steps down this run may take, see `hruPowerStepDownInterval`. The first run of a lowering
   * stretch takes one; later runs take one per full interval since the previous run, and the rest of
   * the time is carried over. Call once per run, in a lowering branch only.
   */
  private takeStepsDown(timestamp: Timestamp): number {
    const interval = this.hruPowerStepDownInterval;
    if (!Number.isFinite(interval) || interval <= 0) return Infinity;

    const previous = this.previousRun;
    if (previous?.lowering) {
      this.stepDownCredit += Math.max(0, timestamp.epochSecond - previous.epochSecond);
    } else {
      this.stepDownCredit = interval;
    }
    const steps = Math.floor(this.stepDownCredit / interval);
    this.stepDownCredit -= steps * interval;
    return steps;
  }

  /** `power` lowered by `steps` steps, not below `floor`; an unlimited step count gives the floor. */
  private lowerPower(power: number, steps: number, floor: number): number {
    if (!Number.isFinite(steps)) return Math.min(power, floor);
    return Math.max(power - steps * this.hruPowerStep, floor);
  }

  private decreasePowerIfPossible(timestamp: Timestamp, steps: number): void {
    const hruCurrentPower = this.hru.getPower();
    if (steps > 0 && hruCurrentPower > this.hruMinPower) {
      const newPower = roundPower(this.lowerPower(hruCurrentPower, steps, this.hruMinPower));
      this.writePower(
        timestamp,
        newPower,
        `decreasing HRU power from ${hruCurrentPower} to ${newPower}`,
      );
    }
  }

  /**
   * Raises the power to Pmove in one write, or lowers it by `steps` steps without going below Pmove.
   * Pmove is kept at or above `hruMinPower` and capped by the day or night maximum.
   */
  private movePowerTowardsMovePower(timestamp: Timestamp, steps: number): void {
    const target = Math.min(
      Math.max(this.hruMovePower, this.hruMinPower),
      this.getHruMaxPower(timestamp),
    );
    const hruCurrentPower = this.hru.getPower();
    const newPower = roundPower(
      hruCurrentPower < target ? target : this.lowerPower(hruCurrentPower, steps, target),
    );
    if (newPower === hruCurrentPower) return;

    this.writePower(
      timestamp,
      newPower,
      `moving HRU power from ${hruCurrentPower} to ${newPower} (fluctuation)`,
    );
  }
}
