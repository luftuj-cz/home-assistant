/**
 * The four seasons are a fixed set: they cannot be created, deleted or renamed,
 * only enabled, disabled and re-bounded. The key is the stable identifier;
 * display names come from the translation catalogue.
 */
export const SEASON_KEYS = ["spring", "summer", "autumn", "winter"] as const;

export type SeasonKey = (typeof SEASON_KEYS)[number];

export interface Season {
  id: number;
  seasonKey: SeasonKey;
  hruId: string | null;
  /** MM-DD. The day this season begins. */
  spanStart: string;
  /** MM-DD. Derived: the day before the next enabled season begins. */
  spanEnd: string;
  enabled: boolean;
  sortOrder: number;
}

/** A season as returned by `GET /api/seasons`, with progress information. */
export interface SeasonSummary extends Season {
  isActive: boolean;
  unconfiguredModes: number;
  enabledEvents: number;
}

export interface SeasonsResponse {
  featureEnabled: boolean;
  activeSeasonId: number | null;
  seasons: SeasonSummary[];
}

export interface DisableImpact {
  seasonKey: SeasonKey;
  timelineId: number;
  enabledEvents: number;
  /** True for the season that becomes the whole-year schedule. */
  wouldBeKept: boolean;
}

export interface DisableImpactResponse {
  keepSeasonKey: SeasonKey;
  seasons: DisableImpact[];
}
