/**
 * A user-created weekly timeline that can override the season schedule. It
 * holds events only; the modes it runs apply the values of the active season.
 */
export interface CustomTimelineSummary {
  id: number;
  hruId: string;
  name: string;
  enabledEvents: number;
  totalEvents: number;
  /** Whether this timeline is the override, and in which phase. */
  overridePhase: "scheduled" | "active" | null;
}

/** The single override slot as the API describes it. */
export interface CustomOverride {
  customTimelineId: number;
  startsAt: string;
  /** Null: runs until ended. */
  endsAt: string | null;
  activatedAt: string;
  phase: "scheduled" | "active";
  name: string | null;
  appliesToCurrentUnit: boolean;
  /** Stored and due, but not applying: the season schedule runs instead. */
  degraded: boolean;
}

export interface CustomTimelinesResponse {
  timelines: CustomTimelineSummary[];
  override: CustomOverride | null;
}

/**
 * Which timeline an event belongs to. Event ids are only unique per kind, so
 * every event call has to say which one it means.
 */
export type TimelineRef = { kind: "season"; id?: number } | { kind: "custom"; id: number };
