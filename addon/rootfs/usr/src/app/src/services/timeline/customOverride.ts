import type { Logger } from "pino";
import { CUSTOM_OVERRIDE_KEY } from "../../types/index.js";
import { getAppSetting, setAppSetting } from "../database.js";
import {
  countEnabledCustomEvents,
  getCustomTimeline,
  getCustomTimelineEvents,
  type CustomTimeline,
} from "../db/customTimelines.js";
import {
  findModesMissingInEnabledSeasons,
  type MissingModeConfiguration,
} from "./customTimelineRules.js";

/**
 * The single override slot: at most one custom timeline replaces the season
 * schedule, from `startsAt` until `endsAt`, or until ended when `endsAt` is
 * null. `activatedAt` identifies one activation, so re-activating the same
 * timeline fires its scripts again.
 */
export interface CustomTimelineOverride {
  customTimelineId: number;
  startsAt: string;
  endsAt: string | null;
  activatedAt: string;
}

export type OverridePhase = "scheduled" | "active" | "expired";

export type OverrideRejection =
  | "CUSTOM_TIMELINE_NOT_FOUND"
  | "CUSTOM_TIMELINE_OTHER_UNIT"
  | "CUSTOM_TIMELINE_EMPTY"
  | "MODE_NOT_CONFIGURED_IN_ALL_SEASONS"
  | "OVERRIDE_END_BEFORE_START";

/** Why a custom timeline cannot become the override. Shared by REST and MQTT. */
export class CustomOverrideRejectedError extends Error {
  constructor(
    public readonly code: OverrideRejection,
    message: string,
    public readonly missing: MissingModeConfiguration[] = [],
  ) {
    super(message);
    this.name = "CustomOverrideRejectedError";
  }
}

function isValidOverride(value: unknown): value is CustomTimelineOverride {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.customTimelineId === "number" &&
    typeof candidate.startsAt === "string" &&
    (candidate.endsAt === null || typeof candidate.endsAt === "string") &&
    typeof candidate.activatedAt === "string"
  );
}

/** Stored value as-is, for restoring it after a failed apply. */
export function readCustomOverrideRaw(): string {
  return getAppSetting(CUSTOM_OVERRIDE_KEY) ?? "null";
}

export function readCustomOverride(): CustomTimelineOverride | null {
  const raw = getAppSetting(CUSTOM_OVERRIDE_KEY);
  if (!raw || raw === "null") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidOverride(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCustomOverride(override: CustomTimelineOverride | null): void {
  setAppSetting(CUSTOM_OVERRIDE_KEY, override ? JSON.stringify(override) : "null");
}

export function overridePhase(
  override: CustomTimelineOverride,
  now: Date = new Date(),
): OverridePhase {
  if (override.endsAt !== null && new Date(override.endsAt) <= now) return "expired";
  if (new Date(override.startsAt) > now) return "scheduled";
  return "active";
}

/** True while the timeline is the active or the scheduled override. */
export function isOverridingTimeline(customTimelineId: number, now: Date = new Date()): boolean {
  const override = readCustomOverride();
  return (
    override !== null &&
    override.customTimelineId === customTimelineId &&
    overridePhase(override, now) !== "expired"
  );
}

/**
 * Refuses a timeline that could not apply: missing, of another unit, without an
 * enabled event, or using a mode that some enabled season lacks. The last one
 * is a re-check - event writes already enforce it - kept because an HA
 * automation can activate a timeline long after it was last edited.
 */
export function assertActivatable(
  customTimelineId: number,
  currentUnitId: string | null,
): CustomTimeline {
  const timeline = getCustomTimeline(customTimelineId);
  if (!timeline) {
    throw new CustomOverrideRejectedError(
      "CUSTOM_TIMELINE_NOT_FOUND",
      `Custom timeline ${customTimelineId} does not exist`,
    );
  }
  if (timeline.hruId !== currentUnitId) {
    throw new CustomOverrideRejectedError(
      "CUSTOM_TIMELINE_OTHER_UNIT",
      `Custom timeline "${timeline.name}" belongs to another HRU unit`,
    );
  }
  if (countEnabledCustomEvents(timeline.id) === 0) {
    throw new CustomOverrideRejectedError(
      "CUSTOM_TIMELINE_EMPTY",
      `Custom timeline "${timeline.name}" has no enabled event`,
    );
  }
  const usedModes = getCustomTimelineEvents(timeline.id)
    .filter((event) => event.enabled)
    .map((event) => event.modeId);
  const missing = findModesMissingInEnabledSeasons(timeline.hruId, usedModes);
  if (missing.length > 0) {
    throw new CustomOverrideRejectedError(
      "MODE_NOT_CONFIGURED_IN_ALL_SEASONS",
      `Custom timeline "${timeline.name}" uses modes not configured in every enabled season`,
      missing,
    );
  }
  return timeline;
}

interface Applier {
  executeScheduledEventOrThrow(): Promise<void>;
}

/**
 * Writes the slot, applies it on the spot, and restores the previous slot if
 * the apply throws - the same contract the boost routes keep. A restore that
 * itself fails is logged and surfaced as the original error.
 */
async function applyOrRestore(
  next: CustomTimelineOverride | null,
  applier: Applier,
  logger: Logger,
): Promise<void> {
  const previousRaw = readCustomOverrideRaw();
  writeCustomOverride(next);
  try {
    await applier.executeScheduledEventOrThrow();
  } catch (error) {
    setAppSetting(CUSTOM_OVERRIDE_KEY, previousRaw);
    try {
      await applier.executeScheduledEventOrThrow();
    } catch (restoreError) {
      logger.error(
        { restoreError, originalError: error },
        "Failed to restore the previous custom override after an apply failure",
      );
    }
    throw error;
  }
}

export interface ActivationRequest {
  customTimelineId: number;
  startsAt?: string;
  endsAt?: string | null;
}

export async function activateCustomOverride(
  request: ActivationRequest,
  currentUnitId: string | null,
  applier: Applier,
  logger: Logger,
  now: Date = new Date(),
): Promise<CustomTimelineOverride> {
  assertActivatable(request.customTimelineId, currentUnitId);

  // A start that is not in the future means "now": storing a past instant
  // would read back as if the override had been running all along.
  const requestedStart = request.startsAt ? new Date(request.startsAt) : now;
  const startsAt = requestedStart > now ? requestedStart : now;
  const endsAt = request.endsAt ? new Date(request.endsAt) : null;
  if (endsAt && endsAt <= startsAt) {
    throw new CustomOverrideRejectedError(
      "OVERRIDE_END_BEFORE_START",
      "The override must end after it starts",
    );
  }

  const override: CustomTimelineOverride = {
    customTimelineId: request.customTimelineId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt ? endsAt.toISOString() : null,
    activatedAt: now.toISOString(),
  };
  await applyOrRestore(override, applier, logger);
  logger.info({ override }, "Custom timeline override activated");
  return override;
}

export async function endCustomOverride(applier: Applier, logger: Logger): Promise<void> {
  const previous = readCustomOverride();
  if (!previous) return;
  await applyOrRestore(null, applier, logger);
  logger.info({ previous }, "Custom timeline override ended");
}
