import { BadRequestError, NotFoundError } from "../../shared/errors/apiErrors.js";
import { resolveSeason, type Hemisphere, type Season } from "../../services/seasonResolver.js";
import type { SeasonalMode } from "../../services/db/seasonalModes.js";
import type { TimelineMode } from "../../types/index.js";

export interface ActiveSeasonalOverride {
  season: Season;
  baseModeId: number;
  modeName: string;
  baseMode: TimelineMode;
  power: number | undefined;
  temperature: number | undefined;
  variables: Record<string, number | string | boolean> | undefined;
  luftatorConfig: Record<string, number> | undefined;
}

export interface SettingsLike {
  getSeasonHemisphere(): Hemisphere;
}

export interface TimelineLike {
  getTimelineMode(id: number): TimelineMode | null;
}

export interface SeasonalModeRepoLike {
  getActiveForSeason(season: Season, hruId: string | null): SeasonalMode | null;
  upsert(row: {
    season: Season;
    hruId: string | null;
    baseModeId: number;
    power?: number | null;
    temperature?: number | null;
    variables?: Record<string, number | string | boolean> | null;
    luftatorConfig?: Record<string, number> | null;
    enabled: boolean;
  }): void;
}

export class SeasonalModesService {
  constructor(
    private readonly repo: SeasonalModeRepoLike,
    private readonly settings: SettingsLike,
    private readonly timeline: TimelineLike,
  ) {}

  getActiveOverride(now: Date, hruId: string | null): ActiveSeasonalOverride | null {
    const hemisphere = this.settings.getSeasonHemisphere();
    const season = resolveSeason(now, hemisphere);
    const row = this.repo.getActiveForSeason(season, hruId);
    if (!row || !row.enabled) return null;
    const mode = this.timeline.getTimelineMode(row.baseModeId);
    if (!mode) return null;
    return {
      season,
      baseModeId: row.baseModeId,
      modeName: mode.name,
      baseMode: mode,
      power: row.power ?? undefined,
      temperature: row.temperature ?? undefined,
      variables: row.variables ?? undefined,
      luftatorConfig: row.luftatorConfig ?? undefined,
    };
  }

  upsert(row: {
    season: Season;
    hruId: string | null;
    baseModeId: number;
    power?: number | null;
    temperature?: number | null;
    variables?: Record<string, number | string | boolean> | null;
    luftatorConfig?: Record<string, number> | null;
    enabled: boolean;
  }): void {
    const mode = this.timeline.getTimelineMode(row.baseModeId);
    if (!mode) {
      throw new NotFoundError(`Mode ${row.baseModeId} not found`);
    }
    if (mode.hruId && mode.hruId !== row.hruId) {
      throw new BadRequestError(
        `Mode ${row.baseModeId} does not belong to HRU ${row.hruId ?? "global"}`,
        "MODE_HRU_MISMATCH",
      );
    }
    this.repo.upsert(row);
  }
}
