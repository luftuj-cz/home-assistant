import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../helpers/testDb.js";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";

const UNIT = "atrea-am";
const UTLUM = 1;
const KOMFORT = 2;
const BASE = "/api/custom-timelines";

/**
 * The HTTP contract of custom timelines: every rejection the spec lists, with
 * the status and code a client sees.
 */
describe("custom timelines API", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let api: ServedRouter;
  let units: { id: string }[];
  let applyFails: boolean;
  let springId: number;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;

    temp.database.setAppSetting("hru.settings", JSON.stringify({ unit: UNIT }));
    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
    ).run(UNIT);
    springId = temp.database.getActiveSeasonId(UNIT)!;
    for (const [id, name] of [
      [UTLUM, "Útlum"],
      [KOMFORT, "Komfort"],
    ] as const) {
      db.prepare(
        `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (?, ?, '#1971c2', 0, ?)`,
      ).run(id, name, UNIT);
      db.prepare(
        `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, 30)`,
      ).run(id, springId);
    }

    units = [{ id: UNIT }];
    applyFails = false;
    const scheduler = {
      executeScheduledEventOrThrow: vi.fn(async () => {
        if (applyFails) throw new Error("HRU unreachable");
      }),
      isCustomOverrideDegraded: () => false,
    };
    const mqtt = {
      refreshDiscovery: vi.fn(async () => undefined),
      publishCustomOverrideState: vi.fn(async () => undefined),
    };
    const { createCustomTimelinesRouter } = await import("../../src/routes/customTimelines.js");
    const { silentLogger } = await import("../helpers/httpRouter.js");
    api = await serveRouters({
      [BASE]: createCustomTimelinesRouter(
        silentLogger() as never,
        { getAllUnits: () => units } as never,
        scheduler as never,
        mqtt as never,
      ),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  async function create(name: string): Promise<number> {
    const result = await api.call("POST", BASE, { name });
    expect(result.status).toBe(201);
    return result.body!.id as number;
  }

  function event(modeId: number, startTime: string, extra: Record<string, unknown> = {}) {
    return { modeId, dayOfWeek: null, startTime, enabled: true, priority: 0, ...extra };
  }

  async function addEvent(timelineId: number, modeId: number, startTime: string) {
    const result = await api.call("POST", `${BASE}/${timelineId}/events`, event(modeId, startTime));
    expect(result.status).toBe(201);
    return result.body!.id as number;
  }

  function storedOverride(): unknown {
    const row = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'timeline.custom_override'`)
      .get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  describe("timelines", () => {
    it("creates an empty timeline for the selected unit", async () => {
      const id = await create("Dovolená");

      const list = await api.call("GET", BASE);
      expect(list.body!.timelines).toEqual([
        expect.objectContaining({ id, name: "Dovolená", enabledEvents: 0, overridePhase: null }),
      ]);
    });

    it("rejects creating one without a unit", async () => {
      units = [];
      db.prepare(`DELETE FROM app_settings WHERE key = 'hru.settings'`).run();

      const result = await api.call("POST", BASE, { name: "Dovolená" });

      expect(result.status).toBe(400);
      expect(result.body!.code).toBe("HRU_UNIT_REQUIRED");
      expect(db.prepare(`SELECT COUNT(*) AS n FROM custom_timelines`).get()).toEqual({ n: 0 });
    });

    it("rejects a name taken by another timeline, ignoring case beyond ASCII", async () => {
      await create("Dovolená");

      const result = await api.call("POST", BASE, { name: "DOVOLENÁ" });

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("PLAN_NAME_TAKEN");
    });

    it("rejects a name shown by a season", async () => {
      const result = await api.call("POST", BASE, { name: "spring" });

      expect(result.status).toBe(409);
      expect(result.body!.details).toMatchObject({ conflict: { kind: "season" } });
    });

    it("rejects an empty name", async () => {
      const result = await api.call("POST", BASE, { name: "   " });

      expect(result.status).toBe(400);
    });

    it("renames without changing identity", async () => {
      const id = await create("Dovolená");
      await addEvent(id, UTLUM, "08:00");

      const result = await api.call("PATCH", `${BASE}/${id}`, { name: "Chata" });

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ id, name: "Chata" });
      const events = await api.call("GET", `${BASE}/${id}/events`);
      expect(events.body!.events).toHaveLength(1);
    });

    it("hides a timeline of another unit", async () => {
      const id = await create("Dovolená");

      const result = await api.call("GET", `${BASE}/${id}/events?unitId=other-unit`);

      expect(result.status).toBe(404);
    });
  });

  describe("events", () => {
    it("rejects HRU or valve values on an event", async () => {
      const id = await create("Dovolená");

      const result = await api.call(
        "POST",
        `${BASE}/${id}/events`,
        event(UTLUM, "08:00", { hruConfig: { power: 50 } }),
      );

      expect(result.status).toBe(400);
    });

    it("rejects an enabled event whose mode an enabled season lacks, naming the seasons", async () => {
      db.prepare(
        `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
         VALUES ('summer', ?, '06-21', '06-20', 1, 1)`,
      ).run(UNIT);
      db.prepare(`UPDATE timelines SET span_start = '03-20' WHERE id = ?`).run(springId);
      const id = await create("Dovolená");

      const result = await api.call("POST", `${BASE}/${id}/events`, event(UTLUM, "08:00"));

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("MODE_NOT_CONFIGURED_IN_ALL_SEASONS");
      expect(result.body!.details).toMatchObject({
        missing: [{ modeId: UTLUM, seasons: [{ seasonKey: "summer" }] }],
      });

      const disabled = await api.call(
        "POST",
        `${BASE}/${id}/events`,
        event(UTLUM, "08:00", { enabled: false }),
      );
      expect(disabled.status).toBe(201);
    });

    it("rejects an unknown mode", async () => {
      const id = await create("Dovolená");

      const result = await api.call("POST", `${BASE}/${id}/events`, event(999, "08:00"));

      expect(result.status).toBe(400);
      expect(result.body!.code).toBe("UNKNOWN_MODE");
    });

    it("rejects two events at the same time on the same day", async () => {
      const id = await create("Dovolená");
      await addEvent(id, UTLUM, "08:00");

      const result = await api.call("POST", `${BASE}/${id}/events`, event(KOMFORT, "08:00"));

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("DUPLICATE_EVENT_TIME");
    });

    it("fills the week with the mode at midnight on every day", async () => {
      const id = await create("Dovolená");
      await addEvent(id, UTLUM, "08:00");
      await addEvent(id, KOMFORT, "20:00");

      const result = await api.call("POST", `${BASE}/${id}/fill`, { modeId: KOMFORT });

      expect(result.status).toBe(200);
      const events = result.body!.events as {
        startTime: string;
        dayOfWeek: number;
        hruConfig: unknown;
      }[];
      expect(events.map((entry) => entry.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(events.every((entry) => entry.startTime === "00:00")).toBe(true);
      expect(events.every((entry) => (entry.hruConfig as { mode: number }).mode === KOMFORT)).toBe(
        true,
      );
    });
  });

  describe("override", () => {
    it("refuses a timeline without an enabled event", async () => {
      const id = await create("Dovolená");

      const result = await api.call("PUT", `${BASE}/override`, { customTimelineId: id });

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("CUSTOM_TIMELINE_EMPTY");
      expect(storedOverride()).toBeNull();
    });

    it("activates now and indefinitely", async () => {
      const id = await create("Dovolená");
      await addEvent(id, UTLUM, "08:00");

      const result = await api.call("PUT", `${BASE}/override`, { customTimelineId: id });

      expect(result.status).toBe(200);
      expect(result.body!.override).toMatchObject({
        customTimelineId: id,
        name: "Dovolená",
        phase: "active",
        endsAt: null,
        appliesToCurrentUnit: true,
      });
    });

    it("schedules a start in the future", async () => {
      const id = await create("Dovolená");
      await addEvent(id, UTLUM, "08:00");
      const startsAt = new Date(Date.now() + 86_400_000).toISOString();

      const result = await api.call("PUT", `${BASE}/override`, { customTimelineId: id, startsAt });

      expect(result.body!.override).toMatchObject({ phase: "scheduled", startsAt });
    });

    it("rejects an end before the start", async () => {
      const id = await create("Dovolená");
      await addEvent(id, UTLUM, "08:00");

      const result = await api.call("PUT", `${BASE}/override`, {
        customTimelineId: id,
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      });

      expect(result.status).toBe(400);
      expect(result.body!.code).toBe("OVERRIDE_END_BEFORE_START");
    });

    it("restores the previous state when applying fails", async () => {
      const id = await create("Dovolená");
      await addEvent(id, UTLUM, "08:00");
      applyFails = true;

      const result = await api.call("PUT", `${BASE}/override`, { customTimelineId: id });

      expect(result.status).toBe(500);
      expect(storedOverride()).toBeNull();
    });

    it("protects the overriding timeline and its last enabled event", async () => {
      const id = await create("Dovolená");
      const eventId = await addEvent(id, UTLUM, "08:00");
      await api.call("PUT", `${BASE}/override`, { customTimelineId: id });

      const deleteTimeline = await api.call("DELETE", `${BASE}/${id}`);
      const deleteEvent = await api.call("DELETE", `${BASE}/${id}/events/${eventId}`);
      const disableEvent = await api.call(
        "PUT",
        `${BASE}/${id}/events/${eventId}`,
        event(UTLUM, "08:00", { enabled: false }),
      );

      expect(deleteTimeline.body!.code).toBe("CUSTOM_TIMELINE_OVERRIDING");
      expect(deleteEvent.body!.code).toBe("CUSTOM_TIMELINE_LAST_EVENT");
      expect(disableEvent.body!.code).toBe("CUSTOM_TIMELINE_LAST_EVENT");
    });

    it("ends the override and then allows deleting the timeline", async () => {
      const id = await create("Dovolená");
      await addEvent(id, UTLUM, "08:00");
      await api.call("PUT", `${BASE}/override`, { customTimelineId: id });

      const ended = await api.call("DELETE", `${BASE}/override`);
      const deleted = await api.call("DELETE", `${BASE}/${id}`);

      expect(ended.status).toBe(204);
      expect(storedOverride()).toBeNull();
      expect(deleted.status).toBe(204);
    });

    it("replaces the override when another timeline is activated", async () => {
      const dovolena = await create("Dovolená");
      const chata = await create("Chata");
      await addEvent(dovolena, UTLUM, "08:00");
      await addEvent(chata, KOMFORT, "08:00");
      await api.call("PUT", `${BASE}/override`, { customTimelineId: dovolena });

      await api.call("PUT", `${BASE}/override`, { customTimelineId: chata });

      expect(storedOverride()).toMatchObject({ customTimelineId: chata });
    });
  });
});
