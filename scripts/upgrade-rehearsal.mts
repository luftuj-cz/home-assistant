/**
 * Upgrade rehearsal: evidence that this build does not change what a real
 * installation does when it updates.
 *
 * Point it at a copy of a production database, or at the add-on's own
 * `data/luftator.db`. The file you name is never written to - everything runs
 * on a temporary copy, WAL included.
 *
 *   npx tsx scripts/upgrade-rehearsal.mts [path/to/luftator.db]
 *
 * What it does:
 *   1. builds a pre-013 fixture from the real data, so the migrations under
 *      test have something realistic to run against
 *   2. records which event the PRE-SEASONS scheduler picks for every weekday
 *      and every minute of the day - 10,080 decisions
 *   3. migrates, then checks the structure survived
 *   4. replays the same grid through the season-scoped scheduler and compares
 *   5. switches the feature on with cloning and compares once more, this time
 *      on the mode applied, since cloning gives the events new ids
 *
 * This exists as a script rather than a test because fixtures only contain the
 * shapes someone thought of: smoke-testing migrations against a real database
 * caught two bugs the unit tests missed.
 */
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(REPO, "addon/rootfs/usr/src/app");

// better-sqlite3 is a backend dependency, so it is resolved from the add-on
// rather than from the repo root where this script lives.
type SqliteDatabase = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
  exec: (sql: string) => void;
  close: () => void;
};
const DatabaseConstructor = createRequire(path.join(APP, "package.json"))("better-sqlite3") as new (
  file: string,
  options?: { readonly?: boolean },
) => SqliteDatabase;
const SOURCE = path.resolve(process.argv[2] ?? path.join(APP, "data/luftator.db"));

if (!existsSync(SOURCE)) {
  console.error(`No database at ${SOURCE}`);
  console.error("Usage: npx tsx scripts/upgrade-rehearsal.mts [path/to/luftator.db]");
  process.exit(1);
}

const WORKING = path.join(mkdtempSync(path.join(tmpdir(), "luftator-rehearsal-")), "luftator.db");
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(`${SOURCE}${suffix}`)) copyFileSync(`${SOURCE}${suffix}`, `${WORKING}${suffix}`);
}
console.log(`rehearsing an upgrade of ${SOURCE}\ncopy: ${WORKING}\n`);

// --------------------------------------------------------------- pre-013 fixture
let unit: string;
let eventCountBefore: number;
{
  const db = new DatabaseConstructor(WORKING);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.exec(`
    DELETE FROM migrations WHERE id IN ('013_timelines', '014_mode_values');
    DROP TABLE IF EXISTS timeline_mode_values;
    DROP TABLE IF EXISTS timelines;
    DELETE FROM app_settings WHERE key IN ('db.schema_version', 'timeline.seasons_enabled');
  `);
  // The column exists only if the copy had already been migrated once.
  const hasTimelineId = (
    db.prepare(`PRAGMA table_info(timeline_events)`).all() as { name: string }[]
  ).some((column) => column.name === "timeline_id");
  if (hasTimelineId) db.exec(`UPDATE timeline_events SET timeline_id = NULL`);

  const settings = db.prepare(`SELECT value FROM app_settings WHERE key = 'hru.settings'`).get() as
    | { value: string }
    | undefined;
  unit = settings ? ((JSON.parse(settings.value).unit as string) ?? "") : "";
  eventCountBefore = (
    db.prepare(`SELECT COUNT(*) AS n FROM timeline_events`).get() as { n: number }
  ).n;
  const modes = (db.prepare(`SELECT COUNT(*) AS n FROM timeline_modes`).get() as { n: number }).n;
  console.log(`fixture: ${eventCountBefore} events, ${modes} modes, unit "${unit}"`);
  db.close();
}

if (!unit) {
  console.error("No HRU unit configured in this database; nothing to rehearse.");
  process.exit(1);
}

// -------------------------------------------------------- the pre-change scheduler
interface EventRow {
  id: number;
  start_time: string;
  day_of_week: number | null;
  hru_config: string | null;
  enabled: number;
  priority: number;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":");
  return (Number.parseInt(hours ?? "0", 10) || 0) * 60 + (Number.parseInt(minutes ?? "0", 10) || 0);
}

/** pickActiveEvent as it was before seasons: identical, minus the season filter. */
function pickActiveEventLegacy(
  events: EventRow[],
  modeIds: Set<string>,
  nowMinutes: number,
  today: number,
): EventRow | null {
  for (let back = 0; back < 7; back++) {
    const targetDay = (today - back + 7) % 7;
    const dayCandidates = events.filter(
      (event) => event.enabled && (event.day_of_week === null || event.day_of_week === targetDay),
    );
    let filtered = dayCandidates.filter((event) => {
      const mode = event.hru_config ? (JSON.parse(event.hru_config).mode ?? null) : null;
      return mode !== null && modeIds.has(String(mode));
    });
    if (back === 0) {
      filtered = filtered.filter((event) => timeToMinutes(event.start_time) <= nowMinutes);
    }
    if (filtered.length > 0) {
      filtered.sort((first, second) => {
        const firstTime = timeToMinutes(first.start_time);
        const secondTime = timeToMinutes(second.start_time);
        if (secondTime !== firstTime) return secondTime - firstTime;
        return (second.priority ?? 0) - (first.priority ?? 0);
      });
      return filtered[0] ?? null;
    }
  }
  return null;
}

const before = new Map<string, { id: number | null; mode: string | null }>();
{
  const db = new DatabaseConstructor(WORKING, { readonly: true });
  const events = db
    .prepare(`SELECT * FROM timeline_events WHERE hru_id = ?`)
    .all(unit) as EventRow[];
  const modeIds = new Set(
    (db.prepare(`SELECT id FROM timeline_modes`).all() as { id: number }[]).map((mode) =>
      String(mode.id),
    ),
  );
  for (let day = 0; day < 7; day++) {
    for (let minute = 0; minute < 24 * 60; minute++) {
      const picked = pickActiveEventLegacy(events, modeIds, minute, day);
      const mode = picked?.hru_config ? (JSON.parse(picked.hru_config).mode ?? null) : null;
      before.set(`${day}|${minute}`, {
        id: picked?.id ?? null,
        mode: mode === null ? null : String(mode),
      });
    }
  }
  db.close();
}
console.log(`recorded ${before.size} scheduler decisions before migrating\n`);

// ------------------------------------------------------------------- the upgrade
process.env.LUFTATOR_DB_PATH = WORKING;
const database = await import(`${APP}/src/services/database.js`);
database.setupDatabase();
const db = database.getDatabase()!;

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function scalar(sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

const eventCountAfter = scalar(`SELECT COUNT(*) AS n FROM timeline_events`);
check(
  "every event survived the migration",
  eventCountAfter === eventCountBefore,
  `${eventCountBefore} -> ${eventCountAfter}`,
);

check(
  "every event points at a season that exists",
  scalar(
    `SELECT COUNT(*) AS n FROM timeline_events
     WHERE timeline_id IS NULL OR timeline_id NOT IN (SELECT id FROM timelines)`,
  ) === 0,
);

const seasons = db
  .prepare(`SELECT season_key, span_start, enabled FROM timelines WHERE hru_id = ?`)
  .all(unit) as { season_key: string; span_start: string; enabled: number }[];
check(
  "one season, spring, covering the year",
  seasons.length === 1 && seasons[0]?.season_key === "spring" && seasons[0]?.span_start === "01-01",
  JSON.stringify(seasons),
);

const modeRows = db.prepare(`SELECT id, name, variables, power FROM timeline_modes`).all() as {
  id: number;
  name: string;
  variables: string | null;
  power: number | null;
}[];
check(
  "legacy mode columns left populated",
  modeRows.every((mode) => mode.variables !== null || mode.power !== null),
  modeRows.map((mode) => mode.name).join(", "),
);
check(
  "every mode has values in the default season",
  scalar(`SELECT COUNT(*) AS n FROM timeline_mode_values`) === modeRows.length,
);

const version = db
  .prepare(`SELECT value FROM app_settings WHERE key = 'db.schema_version'`)
  .get() as { value: string } | undefined;
const { latestSchemaVersion } = await import(`${APP}/src/services/db/migrations.js`);
check(
  "schema version stamped",
  version?.value === String(latestSchemaVersion()),
  `version ${version?.value}`,
);

const flag = db
  .prepare(`SELECT value FROM app_settings WHERE key = 'timeline.seasons_enabled'`)
  .get() as { value: string } | undefined;
check("seasons feature stays off after the update", flag === undefined || flag.value !== "true");

// ------------------------------------------------ behaviour, minute by minute
const { pickActiveEvent } = await import(`${APP}/src/services/timeline/eventPicker.js`);

function compareGrid(label: string, by: "id" | "mode"): void {
  const differences: string[] = [];
  for (let day = 0; day < 7; day++) {
    for (let minute = 0; minute < 24 * 60; minute++) {
      const picked = pickActiveEvent(unit, minute, day);
      const expected = before.get(`${day}|${minute}`)!;
      const actual =
        by === "id"
          ? (picked?.id ?? null)
          : picked?.hruConfig?.mode === undefined
            ? null
            : String(picked.hruConfig.mode);
      const wanted = by === "id" ? expected.id : expected.mode;
      if (String(actual ?? "") !== String(wanted ?? "")) {
        const hour = String(Math.floor(minute / 60)).padStart(2, "0");
        differences.push(
          `day ${day} ${hour}:${String(minute % 60).padStart(2, "0")}: ${wanted} -> ${actual}`,
        );
      }
    }
  }
  check(
    `${label} (${before.size} slots)`,
    differences.length === 0,
    differences.slice(0, 3).join("; "),
  );
}

compareGrid("scheduler picks the same event in every slot", "id");

// ------------------------------------------- and then the user switches it on
const { enableSeasonsFeature } = await import(`${APP}/src/services/db/seasonsFeature.js`);
enableSeasonsFeature(unit, true);

check(
  "enabling seeds four enabled seasons",
  scalar(`SELECT COUNT(*) AS n FROM timelines WHERE hru_id = ? AND enabled = 1`, unit) === 4,
);

const perSeason = db
  .prepare(
    `SELECT t.season_key, COUNT(e.id) AS n
     FROM timelines t LEFT JOIN timeline_events e ON e.timeline_id = t.id
     WHERE t.hru_id = ? GROUP BY t.id`,
  )
  .all(unit) as { season_key: string; n: number }[];
check(
  "cloning gives every season the same schedule",
  perSeason.length === 4 && perSeason.every((row) => row.n === eventCountBefore),
  JSON.stringify(perSeason),
);

const unconfigured = db
  .prepare(
    `SELECT t.season_key, COUNT(m.id) - COUNT(v.mode_id) AS missing
     FROM timelines t CROSS JOIN timeline_modes m
     LEFT JOIN timeline_mode_values v ON v.mode_id = m.id AND v.timeline_id = t.id
     WHERE t.hru_id = ? GROUP BY t.id`,
  )
  .all(unit) as { season_key: string; missing: number }[];
check(
  "no mode is left unconfigured in any season",
  unconfigured.every((row) => row.missing === 0),
  JSON.stringify(unconfigured),
);

// Cloning gives the events new ids, so compare the mode that gets applied.
compareGrid("with seasons on, the same mode applies in every slot", "mode");

database.closeDatabase();

if (failures.length > 0) {
  console.error(`\nUPGRADE REHEARSAL FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nUPGRADE REHEARSAL PASSED");
