import { getDatabase, setupDatabase } from "../database.js";
import { cachedStatement } from "./statementCache.js";

/**
 * What automatic control decided, one row per change, bounded. Measured on the simulator's houses: 58–234 rows
 * a day at about 680 B each, so a week is about 1 MB. The row cap is a guard against a system that churns.
 */
export const JOURNAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const JOURNAL_MAX_ROWS = 20_000;
const PRUNE_EVERY_MS = 60_000;

export type JournalKind =
  | "start"
  | "stop"
  | "cannotRun"
  | "branch"
  | "valves"
  | "power"
  | "parameters"
  | "rooms";

export interface JournalEntry {
  id: number;
  at: string;
  kind: JournalKind;
  data: unknown;
}

let lastPrunedAt = 0;

function db() {
  if (!getDatabase()) setupDatabase();
  const database = getDatabase();
  if (!database) throw new Error("Database not initialised");
  return database;
}

export function appendJournal(kind: JournalKind, data: unknown, at: Date = new Date()): void {
  const database = db();
  cachedStatement(database, "INSERT INTO automatic_journal (at, kind, data) VALUES (?, ?, ?)").run(
    at.toISOString(),
    kind,
    JSON.stringify(data),
  );
  if (at.getTime() - lastPrunedAt >= PRUNE_EVERY_MS || at.getTime() < lastPrunedAt) {
    pruneJournal(at);
  }
}

/** Removes rows older than the retention and rows beyond the cap, oldest first. */
export function pruneJournal(now: Date = new Date(), maxRows: number = JOURNAL_MAX_ROWS): void {
  const database = db();
  lastPrunedAt = now.getTime();
  const cutoff = new Date(now.getTime() - JOURNAL_RETENTION_MS).toISOString();
  cachedStatement(database, "DELETE FROM automatic_journal WHERE at < ?").run(cutoff);
  cachedStatement(
    database,
    `DELETE FROM automatic_journal WHERE id <= (
       SELECT id FROM automatic_journal ORDER BY id DESC LIMIT 1 OFFSET ?
     )`,
  ).run(maxRows);
}

/** The newest entries first. */
export function readJournal(limit: number): JournalEntry[] {
  const rows = cachedStatement(
    db(),
    "SELECT id, at, kind, data FROM automatic_journal ORDER BY id DESC LIMIT ?",
  ).all(limit) as { id: number; at: string; kind: JournalKind; data: string }[];
  return rows.map((row) => {
    let data: unknown = null;
    try {
      data = JSON.parse(row.data);
    } catch {
      data = row.data;
    }
    return { id: row.id, at: row.at, kind: row.kind, data };
  });
}

/** For tests: forget when the journal was last pruned. */
export function resetJournalPruneClock(): void {
  lastPrunedAt = 0;
}
