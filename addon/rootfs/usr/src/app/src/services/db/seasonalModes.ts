import { getDatabase, getModuleLogger, getStatements, setupDatabase } from "../database.js";

export type Season = "spring" | "summer" | "autumn" | "winter";
const GLOBAL_HRU_ID = "__global__";

export interface SeasonalModeRecord {
  season: Season;
  hru_id: string | null;
  base_mode_id: number;
  power: number | null;
  temperature: number | null;
  variables: string | null;
  luftator_config: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface SeasonalMode {
  season: Season;
  hruId: string | null;
  baseModeId: number;
  power: number | null;
  temperature: number | null;
  variables: Record<string, number | string | boolean> | null;
  luftatorConfig: Record<string, number> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapRecord(record: SeasonalModeRecord): SeasonalMode {
  let variables: Record<string, number | string | boolean> | undefined;
  if (record.variables) {
    try {
      variables = JSON.parse(record.variables);
    } catch (err) {
      getModuleLogger()?.error({ err, season: record.season }, "Failed to parse variables JSON");
    }
  }

  let luftatorConfig: Record<string, number> | undefined;
  if (record.luftator_config) {
    try {
      luftatorConfig = JSON.parse(record.luftator_config);
    } catch (err) {
      getModuleLogger()?.error(
        { err, season: record.season },
        "Failed to parse luftator_config JSON",
      );
    }
  }

  return {
    season: record.season,
    hruId: record.hru_id === GLOBAL_HRU_ID ? null : record.hru_id,
    baseModeId: record.base_mode_id,
    power: record.power,
    temperature: record.temperature,
    variables: variables ?? null,
    luftatorConfig: luftatorConfig ?? null,
    enabled: Boolean(record.enabled),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function toDbHruId(hruId?: string | null): string {
  return hruId && hruId.length > 0 ? hruId : GLOBAL_HRU_ID;
}

export function listSeasonalModes(hruId?: string | null): SeasonalMode[] {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }
  const dbHruId = toDbHruId(hruId);
  const records = statements.getSeasonalModes.all(
    dbHruId,
    GLOBAL_HRU_ID,
    dbHruId,
  ) as SeasonalModeRecord[];
  return records.map(mapRecord);
}

export function getSeasonalMode(season: Season, hruId?: string | null): SeasonalMode | null {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }
  const dbHruId = toDbHruId(hruId);
  const record = statements.getSeasonalMode.get(season, dbHruId, GLOBAL_HRU_ID, dbHruId) as
    | SeasonalModeRecord
    | undefined;
  if (!record) return null;
  return mapRecord(record);
}

export function upsertSeasonalMode(row: {
  season: Season;
  hruId?: string | null;
  baseModeId: number;
  power?: number | null;
  temperature?: number | null;
  variables?: Record<string, number | string | boolean> | null;
  luftatorConfig?: Record<string, number> | null;
  enabled?: boolean;
}): SeasonalMode {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }

  statements.upsertSeasonalMode.run({
    season: row.season,
    hruId: toDbHruId(row.hruId),
    baseModeId: row.baseModeId,
    power: row.power ?? null,
    temperature: row.temperature ?? null,
    variables: row.variables ? JSON.stringify(row.variables) : null,
    luftatorConfig: row.luftatorConfig ? JSON.stringify(row.luftatorConfig) : null,
    enabled: row.enabled === false ? 0 : 1,
  });

  getModuleLogger()?.debug({ season: row.season, hruId: row.hruId }, "Upserted seasonal mode");

  return {
    season: row.season,
    hruId: row.hruId ?? null,
    baseModeId: row.baseModeId,
    power: row.power ?? null,
    temperature: row.temperature ?? null,
    variables: row.variables ?? null,
    luftatorConfig: row.luftatorConfig ?? null,
    enabled: row.enabled !== false,
    createdAt: "",
    updatedAt: "",
  };
}

export function deleteSeasonalMode(season: Season, hruId?: string | null): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }
  statements.deleteSeasonalMode.run(season, toDbHruId(hruId));
  getModuleLogger()?.debug({ season, hruId }, "Deleted seasonal mode");
}
