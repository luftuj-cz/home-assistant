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

/**
 * A room's CO2 averaged over the time since its previous power review, and the average of the window
 * before it. A room is falling when the new average is below the reference by more than the margin.
 */
export interface TrendWindow {
  /** Filtered CO2 in whole ppm times the seconds it stood for. */
  sum: number;
  seconds: number;
  /** The average of the previous window; `null` until a first window was closed. */
  reference: number | null;
}

function emptyTrendWindow(): TrendWindow {
  return { sum: 0, seconds: 0, reference: null };
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
  /** The epoch second of the last run in which the room had a reading. */
  lastReadingAt: number | null;
  /** The window of the slow lane, kept while the room is in the above-TH1 state. */
  slowWindow: TrendWindow;
  /** The window of the fast lane, kept while the room is in the above-TH2 state. */
  fastWindow: TrendWindow;
  /** Slow-lane reviews in a row in which this room asked for power. */
  slowAskStreak: number;
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
  /** What the power review of this run decided; `null` in a run without one. */
  powerReview: PowerReview | null;
}

/** One power review: the fast lane (a room above TH2) or the slow lane (a room above TH1). */
export interface PowerReview {
  lane: "fast" | "slow";
  /** Whether a room asked for power; the step itself may have been capped by the maximum. */
  raised: boolean;
  /** The rooms that asked, in `building.rooms` order. */
  asked: string[];
  /** The reviewed rooms that did not ask, in `building.rooms` order. */
  held: string[];
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

function isStepLimit(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/** What `powerReviewStepLimit` falls back to when it is not a whole number of 1 or more. */
const DEFAULT_REVIEW_STEP_LIMIT = 3;

/**
 * A room at its step limit may ask again once its average rose by more than this many margins since
 * the previous review. Twice the margin: one margin is within what sensor noise does to two averages.
 */
const RISING_MARGINS = 2;

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
  hruPowerStepDownInterval: number = 300;
  /** Seconds between slow-lane power reviews while a room is above TH1; not above 0 switches it off. */
  powerReviewInterval: number = 600;
  /** ppm a room's window average must drop between two reviews to count as falling. */
  co2FallingMargin: number = 10;
  /** Slow-lane reviews in a row in which one room may ask for power; a guard for rooms that do not respond. */
  powerReviewStepLimit: number = 3;
  /** Seconds a room above TH1 without a reading still holds the power and its place in the review. */
  missingReadingHold: number = 3600;
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
  /** The previous run: when it was, whether its branch lowers the power, and whether the gate was open. */
  private previousRun: { epochSecond: number; lowering: boolean; gateOpen: boolean } | null = null;
  /** Seconds of an open step-down gate in this lowering stretch that are not yet turned into steps. */
  private stepDownCredit: number = 0;
  /** When the slow lane last started or reviewed; `null` while no room is held above TH1. */
  private reviewClock: number | null = null;
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
        lastReadingAt: null,
        slowWindow: emptyTrendWindow(),
        fastWindow: emptyTrendWindow(),
        slowAskStreak: 0,
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

    const roomsHeldAboveTh1 = this.getRoomsHeldAboveTh1(timestamp);
    if (roomsHeldAboveTh1.length === 0) this.reviewClock = null;

    const powerBefore = this.hru.getPower();
    this.enforcePowerLimits(timestamp);
    let branch: DecisionBranch = "none";
    let roomsActedOn: Room[] = [];
    let valvesChanged = false;
    let powerReview: PowerReview | null = null;
    let stepDownGateOpen = false;

    if (roomsAboveThreshold2ForTimeLimit.length > 0) {
      branch = "th2";
      const roomWithAtLeastThreshold1 = [
        ...new Set([...roomsAboveThreshold1ForTimeLimit, ...roomsAboveThreshold2ForTimeLimit]),
      ];
      valvesChanged = this.applyValveStrategy(roomWithAtLeastThreshold1, timestamp);
      const roomsDue = roomWithAtLeastThreshold1.filter((r) => {
        const lastPowerStepAt = this.getState(r).lastPowerStepAt;
        return (
          lastPowerStepAt === null ||
          lastPowerStepAt <= timestamp.epochSecond - this.thresholdTimeLimit
        );
      });
      for (const room of roomsDue) {
        this.getState(room).lastPowerStepAt = timestamp.epochSecond;
      }
      powerReview = this.reviewFastLane(roomsDue, roomsAboveThreshold2ForTimeLimit);
      if (powerReview?.raised) {
        this.increasePower(timestamp);
        this.markChanged(roomsDue, timestamp);
        roomsActedOn = roomsDue;
        // The slow lane waits one interval after the last fast step.
        this.restartSlowLane(timestamp);
      }
      powerReview =
        this.reviewSlowLane(roomsAboveThreshold1ForTimeLimit, powerReview, timestamp) ??
        powerReview;
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
      powerReview = this.reviewSlowLane(roomsAboveThreshold1ForTimeLimit, null, timestamp);
    } else if (this.fluctuationActive) {
      // No markChanged: a room that crosses TH1 next must not start in cooldown.
      branch = "fluctuation";
      valvesChanged = this.resetValvesToDefault(timestamp);
      stepDownGateOpen = this.isStepDownGateOpen(roomsWithValidMeasurement, roomsHeldAboveTh1);
      this.movePowerTowardsMovePower(timestamp, this.takeStepsDown(timestamp, stepDownGateOpen));
    } else if (roomsBelowThreshold1ForTimeLimit.length === roomsWithValidMeasurement.length) {
      branch = "allBelow";
      valvesChanged = this.resetValvesToDefault(timestamp);
      stepDownGateOpen = this.isStepDownGateOpen(roomsWithValidMeasurement, roomsHeldAboveTh1);
      this.decreasePowerIfPossible(timestamp, this.takeStepsDown(timestamp, stepDownGateOpen));
      this.markChanged(roomsWithValidMeasurement, timestamp);
      roomsActedOn = roomsWithValidMeasurement;
    }

    const lowering = branch === "fluctuation" || branch === "allBelow";
    if (!lowering) this.stepDownCredit = 0;
    this.previousRun = {
      epochSecond: timestamp.epochSecond,
      lowering,
      gateOpen: stepDownGateOpen,
    };

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
      powerReview,
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
    for (const name of [
      "hruPowerStep",
      "hruPowerStepDownInterval",
      "powerReviewInterval",
    ] as const) {
      if (!isFiniteAbove(this[name], 0)) problems.push(`${name} must be a finite number above 0`);
    }
    for (const name of ["co2FallingMargin", "missingReadingHold"] as const) {
      if (!isFiniteAtLeast(this[name], 0))
        problems.push(`${name} must be a finite number, 0 or more`);
    }
    if (!isStepLimit(this.powerReviewStepLimit)) {
      problems.push("powerReviewStepLimit must be a whole number, 1 or more");
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
    const now = timestamp.epochSecond;
    const sincePreviousRun =
      this.previousRun === null ? 0 : Math.max(0, now - this.previousRun.epochSecond);

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

      // The first run after a gap adds no time to the windows: nobody knows what the room did in it.
      const afterGap = state.filteredCO2 === null;
      if (
        afterGap &&
        state.lastReadingAt !== null &&
        now - state.lastReadingAt >= this.getMissingReadingHold()
      ) {
        this.clearPowerReviewState(state);
      }
      state.lastReadingAt = now;

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
      if (!afterGap) this.accumulateTrendWindows(state, sincePreviousRun);
    }
  }

  /** Adds the time since the previous run to the windows of the states the room is in. */
  private accumulateTrendWindows(state: RoomState, seconds: number): void {
    const co2 = this.getRoundedCO2(state);
    if (co2 === null || seconds <= 0) return;

    if (state.aboveThresholdSince.get(ThresholdType.TH1) !== null) {
      state.slowWindow.sum += co2 * seconds;
      state.slowWindow.seconds += seconds;
    }
    if (state.aboveThresholdSince.get(ThresholdType.TH2) !== null) {
      state.fastWindow.sum += co2 * seconds;
      state.fastWindow.seconds += seconds;
    }
  }

  /** A fresh start for the lane of `thresholdType`: its window, its reference and, for TH1, the guard. */
  private clearTrendWindow(state: RoomState, thresholdType: ThresholdType): void {
    if (thresholdType === ThresholdType.TH1) {
      state.slowWindow = emptyTrendWindow();
      state.slowAskStreak = 0;
    } else {
      state.fastWindow = emptyTrendWindow();
    }
  }

  private clearPowerReviewState(state: RoomState): void {
    this.clearTrendWindow(state, ThresholdType.TH1);
    this.clearTrendWindow(state, ThresholdType.TH2);
  }

  /**
   * Closes a window: returns its average and the reference it is compared with, then makes the average
   * the new reference. A window with no elapsed time uses the current value.
   */
  private closeTrendWindow(
    window: TrendWindow,
    currentCO2: number,
  ): { average: number; reference: number | null } {
    const average = window.seconds > 0 ? window.sum / window.seconds : currentCO2;
    const reference = window.reference;
    window.sum = 0;
    window.seconds = 0;
    window.reference = average;
    return { average, reference };
  }

  /** `co2FallingMargin`; an unusable value counts as 0. */
  private getFallingMargin(): number {
    return isFiniteAtLeast(this.co2FallingMargin, 0) ? this.co2FallingMargin : 0;
  }

  /** Lower than the reference by more than `co2FallingMargin`. */
  private isFalling(average: number, reference: number): boolean {
    return average < reference - this.getFallingMargin();
  }

  /** Clearly getting worse: higher than the reference by more than twice `co2FallingMargin`. */
  private isRising(average: number, reference: number): boolean {
    return average > reference + RISING_MARGINS * this.getFallingMargin();
  }

  private getMissingReadingHold(): number {
    return isFiniteAtLeast(this.missingReadingHold, 0) ? this.missingReadingHold : 0;
  }

  /**
   * Rooms in the above-TH1 state that still count: with a reading, or without one for less than
   * `missingReadingHold`. They keep the review clock running and the step-down gate closed.
   */
  private getRoomsHeldAboveTh1(timestamp: Timestamp): Room[] {
    const hold = this.getMissingReadingHold();
    return this.model.rooms.filter((room) => {
      const state = this.getState(room);
      if (state.aboveThresholdSince.get(ThresholdType.TH1) === null) return false;
      if (state.filteredCO2 !== null) return true;
      return state.lastReadingAt !== null && timestamp.epochSecond - state.lastReadingAt < hold;
    });
  }

  /**
   * The fast lane: of the rooms due for a TH2 step, those in the above-TH2 state are reviewed. A room
   * asks on its first review of an episode, or when its average is at or above TH2 and not falling.
   * `null` when no room took part.
   */
  private reviewFastLane(roomsDue: Room[], roomsAboveTh2: Room[]): PowerReview | null {
    const th2 = this.thresholds.get(ThresholdType.TH2);
    const aboveTh2 = new Set(roomsAboveTh2);
    const asked: Room[] = [];
    const held: Room[] = [];
    for (const room of roomsDue) {
      const state = this.getState(room);
      const co2 = this.getRoundedCO2(state);
      if (co2 === null || !aboveTh2.has(room)) continue;

      const { average, reference } = this.closeTrendWindow(state.fastWindow, co2);
      const asks =
        reference === null ||
        (th2 !== undefined && average >= th2 && !this.isFalling(average, reference));
      (asks ? asked : held).push(room);
    }
    if (asked.length === 0 && held.length === 0) return null;
    return {
      lane: "fast",
      raised: asked.length > 0,
      asked: this.toRoomIds(asked),
      held: this.toRoomIds(held),
    };
  }

  /** Sets the review clock to now and makes what every room above TH1 accumulated its reference. */
  private restartSlowLane(timestamp: Timestamp): void {
    this.reviewClock = timestamp.epochSecond;
    for (const room of this.model.rooms) {
      const state = this.getState(room);
      const co2 = this.getRoundedCO2(state);
      if (co2 === null || state.aboveThresholdSince.get(ThresholdType.TH1) === null) continue;
      this.closeTrendWindow(state.slowWindow, co2);
    }
  }

  /**
   * The slow lane, in a `th1` or `th2` run. The first such run after the clock was cleared only starts
   * it. Once `powerReviewInterval` has passed, the rooms above TH1 are reviewed and the power rises by
   * one step when one of them asks: it had a reference, its average is at or above TH1, it is not
   * falling, and it has not asked `powerReviewStepLimit` times in a row, unless it is clearly rising.
   * Returns `null` without a review.
   */
  private reviewSlowLane(
    roomsAboveTh1: Room[],
    fastReview: PowerReview | null,
    timestamp: Timestamp,
  ): PowerReview | null {
    if (fastReview?.raised) return null;
    if (this.reviewClock === null) {
      this.restartSlowLane(timestamp);
      return null;
    }
    const interval = this.powerReviewInterval;
    if (!Number.isFinite(interval) || interval <= 0) return null;
    if (timestamp.epochSecond - this.reviewClock < interval) return null;

    const th1 = this.thresholds.get(ThresholdType.TH1);
    const stepLimit = isStepLimit(this.powerReviewStepLimit)
      ? this.powerReviewStepLimit
      : DEFAULT_REVIEW_STEP_LIMIT;
    const asked: Room[] = [];
    const held: Room[] = [];
    const counted: RoomState[] = [];
    for (const room of roomsAboveTh1) {
      const state = this.getState(room);
      const co2 = this.getRoundedCO2(state);
      if (co2 === null) continue;

      const { average, reference } = this.closeTrendWindow(state.slowWindow, co2);
      const falling = reference !== null && this.isFalling(average, reference);
      // A room that is getting worse is not the stuck sensor the limit is there for.
      const rising = reference !== null && this.isRising(average, reference);
      const underTh1 = th1 !== undefined && average < th1;
      // Better than it was, or no longer over the threshold: the room starts with a clean count.
      if (falling || underTh1) state.slowAskStreak = 0;
      const asks =
        reference !== null &&
        !falling &&
        th1 !== undefined &&
        !underTh1 &&
        (state.slowAskStreak < stepLimit || rising);
      if (asks) {
        asked.push(room);
        if (!rising) counted.push(state);
      } else {
        held.push(room);
      }
    }
    this.reviewClock = timestamp.epochSecond;
    // Only a step that reached the HRU uses up the limit: asking at the maximum costs nothing.
    if (asked.length > 0 && this.increasePower(timestamp)) {
      for (const state of counted) state.slowAskStreak += 1;
    }
    return {
      lane: "slow",
      raised: asked.length > 0,
      asked: this.toRoomIds(asked),
      held: this.toRoomIds(held),
    };
  }

  /**
   * The power may come down only while every room with a reading is below TH1 minus its hysteresis
   * right now, and no room is held above TH1 (which then means its reading is missing).
   */
  private isStepDownGateOpen(roomsWithReading: Room[], roomsHeldAboveTh1: Room[]): boolean {
    if (roomsHeldAboveTh1.length > 0) return false;
    const th1 = this.thresholds.get(ThresholdType.TH1);
    if (th1 === undefined) return true;
    const lower = th1 - (this.co2Hysteresis.get(ThresholdType.TH1) ?? 0);
    return roomsWithReading.every((room) => {
      const co2 = this.getRoundedCO2(this.getState(room));
      return co2 === null || co2 < lower;
    });
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
        this.clearTrendWindow(state, thresholdType);
        this.logger.info(
          `[${this.formatDayTime(timestamp)}] CO2 in room ${room.id} exceeded threshold ${thresholdType}: (${co2}>=${thresholdUpper})`,
        );
      } else if (co2 < thresholdLower && aboveSince !== null) {
        state.aboveThresholdSince.set(thresholdType, null);
        state.belowThresholdSince.set(thresholdType, timestamp.epochSecond);
        this.clearTrendWindow(state, thresholdType);
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
  private writePower(timestamp: Timestamp, power: number, description: string): boolean {
    const writtenAt = this.pendingPowerWrites.get(power);
    if (writtenAt !== undefined && timestamp.epochSecond - writtenAt < this.thresholdTimeLimit) {
      return false;
    }
    this.logger.info(`[${this.formatDayTime(timestamp)}] ${description}`);
    this.hru.setPower(power);
    this.pendingPowerWrites.set(power, timestamp.epochSecond);
    this.recordJournalEntry(timestamp);
    return true;
  }

  /** One step up, capped by the day or night maximum. Returns whether a higher power was written. */
  private increasePower(timestamp: Timestamp): boolean {
    const hruCurrentPower = this.hru.getPower();
    const newPower = roundPower(
      Math.min(hruCurrentPower + this.hruPowerStep, this.getHruMaxPower(timestamp)),
    );
    // Only upwards: an HRU whose read-back lags can still report a power above the maximum here.
    // `NaN` from an unavailable HRU is not higher than anything, so nothing is written.
    const higher = newPower > hruCurrentPower;
    if (!higher) return false;
    return this.writePower(
      timestamp,
      newPower,
      `increasing HRU power from ${hruCurrentPower} to ${newPower}`,
    );
  }

  /**
   * How many steps down this run may take, see `hruPowerStepDownInterval`. None while the gate is
   * closed. One step per full interval of open gate within the lowering stretch, the rest of the time
   * carried over; a closed gate pauses the count and leaving the lowering branches clears it. So the
   * first step comes after a full interval of open gate. Call once per run, in a lowering branch only.
   */
  private takeStepsDown(timestamp: Timestamp, gateOpen: boolean): number {
    const previous = this.previousRun;
    // A lowering stretch starts from nothing; inside one, a closed gate only pauses the count.
    if (!previous?.lowering) this.stepDownCredit = 0;
    if (!gateOpen) return 0;

    const interval = this.hruPowerStepDownInterval;
    if (!Number.isFinite(interval) || interval <= 0) return Infinity;

    // Only time between two runs with the gate open counts.
    if (previous?.lowering && previous.gateOpen) {
      this.stepDownCredit += Math.max(0, timestamp.epochSecond - previous.epochSecond);
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
