import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type JournalModule = typeof import("../../../src/services/db/automaticJournal.js");

describe("automatic control journal", () => {
  let cleanup: () => void;
  let journal: JournalModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    journal = await import("../../../src/services/db/automaticJournal.js");
    journal.resetJournalPruneClock();
  });

  afterEach(() => cleanup());

  it("returns the newest entries first, limited", () => {
    const start = Date.parse("2026-11-26T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      journal.appendJournal("power", { after: i }, new Date(start + i * 1000));
    }
    const entries = journal.readJournal(3);
    expect(entries.map((entry) => entry.data)).toEqual([{ after: 4 }, { after: 3 }, { after: 2 }]);
    expect(entries[0]).toMatchObject({ kind: "power", at: "2026-11-26T10:00:04.000Z" });
  });

  it("removes entries older than 7 days once a minute has passed", () => {
    const old = new Date("2026-11-10T10:00:00Z");
    journal.appendJournal("branch", { to: "th1" }, old);
    const now = new Date("2026-11-26T10:00:00Z");
    journal.appendJournal("branch", { to: "th2" }, now);
    expect(journal.readJournal(10).map((entry) => entry.data)).toEqual([{ to: "th2" }]);
  });

  it("keeps at most the row cap, oldest removed first", () => {
    const now = new Date("2026-11-26T10:00:00Z");
    for (let i = 0; i < 5; i++) journal.appendJournal("valves", { i }, now);
    journal.pruneJournal(now, 3);
    expect(journal.readJournal(100).map((entry) => entry.data)).toEqual([
      { i: 4 },
      { i: 3 },
      { i: 2 },
    ]);
    expect(journal.JOURNAL_MAX_ROWS).toBe(20_000);
  });
});
