import {
  listSeasonalModes as daoList,
  getSeasonalMode as daoGet,
  upsertSeasonalMode as daoUpsert,
  deleteSeasonalMode as daoDelete,
  type Season,
  type SeasonalMode,
} from "../../services/db/seasonalModes.js";
import { resolveSeason, type Hemisphere } from "../../services/seasonResolver.js";

export class SeasonalModesRepository {
  list(hruId: string | null): SeasonalMode[] {
    return daoList(hruId);
  }

  get(season: Season, hruId: string | null): SeasonalMode | null {
    return daoGet(season, hruId);
  }

  getActiveForSeason(season: Season, hruId: string | null): SeasonalMode | null {
    return daoGet(season, hruId);
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
    daoUpsert(row);
  }

  remove(season: Season, hruId: string | null): void {
    daoDelete(season, hruId);
  }
}

export { resolveSeason, type Hemisphere, type Season, type SeasonalMode };
