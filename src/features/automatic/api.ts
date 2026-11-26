import { parseApiError } from "@luftuj/shared/utils/apiError";
import { resolveApiUrl } from "@luftuj/shared/utils/api";

/** Automatic control (LUFTaTOR Algo CO2): the API of `/api/automatic`. */

export interface RoomSensor {
  entityId: string;
  /** The attribute with the CO₂ value, or null for the entity's state. */
  attribute: string | null;
}

export interface Room {
  id: number;
  name: string;
  sortOrder: number;
  valves: string[];
  sensors: RoomSensor[];
  setUp: boolean;
}

export interface RoomInput {
  name: string;
  valves: string[];
  sensors: RoomSensor[];
}

export interface CandidateValue {
  attribute: string | null;
  value: number;
  unit: string | null;
}

export interface SensorCandidate {
  entityId: string;
  name: string;
  deviceClass: string | null;
  unit: string | null;
  lastReported: string | null;
  values: CandidateValue[];
}

export type CannotRunReason = "noRooms" | "noReadings" | "noPowerMax" | "hruUnavailable";
export type ReadingProblem = "missing" | "unavailable" | "notNumber" | "wrongUnit" | "stale";
export type RoomCondition = "belowTh1" | "aboveTh1" | "aboveTh2" | "noReading";
export type DecisionBranch = "th2" | "th1" | "fluctuation" | "allBelow" | "none";

export interface SensorStatus {
  entityId: string;
  attribute: string | null;
  ppm: number | null;
  problem: ReadingProblem | null;
  ageSeconds: number | null;
}

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

export interface PowerReview {
  lane: "fast" | "slow";
  raised: boolean;
  asked: string[];
  held: string[];
}

export interface AutomaticStatus {
  active: boolean;
  reason: CannotRunReason | null;
  startedAt: string | null;
  lastRunAt: string | null;
  engineTime: string | null;
  branch: DecisionBranch | null;
  fluctuationActive: boolean;
  powerReview: PowerReview | null;
  power: {
    before: number;
    after: number;
    max: number;
    unit: { before: number; after: number; max: number } | null;
  } | null;
  rooms: RoomStatus[];
  lockedValves: { entityId: string; roomId: number; roomName: string }[];
  source: string | null;
  sourceName: string;
}

export interface EngineParams {
  th1: number;
  th2: number;
  th1Hysteresis: number;
  th2Hysteresis: number;
  thresholdTimeLimit: number;
  belowTimeLimit: number;
  co2FilterAlpha: number;
  hruMinPower: number;
  hruMaxPowerDay: number;
  hruMaxPowerNight: number;
  hruPowerStep: number;
  hruPowerStepDownInterval: number;
  powerReviewInterval: number;
  co2FallingMargin: number;
  powerReviewStepLimit: number;
  missingReadingHold: number;
  hruMovePower: number;
  fluctuationEnabled: boolean;
  fluctuationOffset: number;
  partialCloseValue: number;
  fullyOpenValue: number;
  /** Seconds of the day. */
  dayStart: number;
  /** Seconds of the day. */
  dayEnd: number;
}

export type LocalizedText = string | { text: string; translate: boolean };

export interface ParametersPayload {
  values: EngineParams;
  defaults: EngineParams;
  overrides: Partial<EngineParams>;
  problems: string[];
  maxReadingAgeSeconds: number;
  defaultMaxReadingAgeSeconds: number;
  power: {
    variable: string;
    unit: LocalizedText | null;
    min: number;
    max: number;
    step: number;
    effectiveStep: number | null;
    equivalents: Partial<Record<keyof EngineParams, number>>;
  } | null;
}

export interface JournalEntry {
  id: number;
  at: string;
  kind: "start" | "stop" | "cannotRun" | "branch" | "valves" | "power" | "parameters" | "rooms";
  data: Record<string, unknown> | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(path), {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw await parseApiError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function fetchRooms(): Promise<Room[]> {
  return json("/api/automatic/rooms");
}

export function createRoom(input: RoomInput): Promise<Room> {
  return json("/api/automatic/rooms", { method: "POST", body: JSON.stringify(input) });
}

export function updateRoom(id: number, input: RoomInput): Promise<Room> {
  return json(`/api/automatic/rooms/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteRoom(id: number): Promise<void> {
  return json(`/api/automatic/rooms/${id}`, { method: "DELETE" });
}

export function fetchSensorCandidates(): Promise<SensorCandidate[]> {
  return json("/api/automatic/sensor-candidates");
}

export function fetchAutomaticStatus(): Promise<AutomaticStatus> {
  return json("/api/automatic/status");
}

export function fetchParameters(): Promise<ParametersPayload> {
  return json("/api/automatic/parameters");
}

export function saveParameters(body: {
  overrides: Partial<EngineParams>;
  maxReadingAgeSeconds: number | null;
}): Promise<ParametersPayload> {
  return json("/api/automatic/parameters", { method: "PUT", body: JSON.stringify(body) });
}

export function fetchJournal(limit = 50): Promise<JournalEntry[]> {
  return json(`/api/automatic/journal?limit=${limit}`);
}
