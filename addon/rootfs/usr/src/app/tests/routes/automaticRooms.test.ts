import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";
import { setupTempDatabase } from "../helpers/testDb.js";

/** Rooms of automatic control over HTTP: conflicts are 409, and every write tells the runner. */
describe("automatic control rooms API", () => {
  let cleanup: () => void;
  let api: ServedRouter;
  let onRoomsChanged: ReturnType<typeof vi.fn<() => void>>;
  let database: typeof import("../../src/services/database.js");

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    database = temp.database;
    const { silentLogger } = await import("../helpers/httpRouter.js");
    const { createAutomaticRouter } = await import("../../src/routes/automatic.js");
    onRoomsChanged = vi.fn<() => void>();
    api = await serveRouters({
      "/api/automatic": createAutomaticRouter({
        logger: silentLogger() as never,
        onRoomsChanged,
      }),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  const obyvak = {
    name: "Obývák",
    valves: ["number.luftator_obyvak_1"],
    sensors: [{ entityId: "sensor.obyvak_vzduch", attribute: "co2" }],
  };

  it("creates, lists, updates and deletes a room", async () => {
    const created = await api.call("POST", "/api/automatic/rooms", obyvak);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Obývák", setUp: true });
    const id = created.body!.id as number;

    const listed = await api.call("GET", "/api/automatic/rooms");
    expect(listed.body).toEqual([created.body]);

    const updated = await api.call("PUT", `/api/automatic/rooms/${id}`, {
      ...obyvak,
      sensors: [{ entityId: "sensor.obyvak_co2" }],
    });
    expect(updated.body).toMatchObject({
      sensors: [{ entityId: "sensor.obyvak_co2", attribute: null }],
    });

    expect((await api.call("DELETE", `/api/automatic/rooms/${id}`)).status).toBe(204);
    expect((await api.call("GET", "/api/automatic/rooms")).body).toEqual([]);
    expect(onRoomsChanged).toHaveBeenCalledTimes(3);
  });

  it("answers 409 for a duplicate name, a taken valve and a taken sensor", async () => {
    await api.call("POST", "/api/automatic/rooms", obyvak);
    const sameName = await api.call("POST", "/api/automatic/rooms", { ...obyvak, valves: [] });
    expect(sameName.status).toBe(409);
    expect(sameName.body).toMatchObject({ code: "ROOM_NAME_TAKEN" });

    const valve = await api.call("POST", "/api/automatic/rooms", {
      name: "Ložnice",
      valves: ["number.luftator_obyvak_1"],
    });
    expect(valve.body).toMatchObject({ code: "ROOM_VALVE_TAKEN" });

    const sensor = await api.call("POST", "/api/automatic/rooms", {
      name: "Ložnice",
      sensors: [{ entityId: "sensor.obyvak_vzduch", attribute: "co2_2" }],
    });
    expect(sensor.status).toBe(409);
    expect(sensor.body).toMatchObject({ code: "ROOM_SENSOR_TAKEN" });
    expect(onRoomsChanged).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for a room that does not exist", async () => {
    expect((await api.call("PUT", "/api/automatic/rooms/99", obyvak)).status).toBe(404);
    expect((await api.call("DELETE", "/api/automatic/rooms/99")).status).toBe(404);
  });

  it("rejects a room without a name", async () => {
    expect((await api.call("POST", "/api/automatic/rooms", { name: " " })).status).toBe(400);
  });

  it("adds a valve group's valves to a room", async () => {
    const group = database.upsertValveGroup({ name: "Přízemí" });
    database.setGroupMembers(group.id, ["number.luftator_a", "number.luftator_b"]);
    const room = await api.call("POST", "/api/automatic/rooms", { name: "Obývák" });

    const result = await api.call(
      "POST",
      `/api/automatic/rooms/${room.body!.id as number}/groups/${group.id}`,
    );
    expect(result.body).toMatchObject({ valves: ["number.luftator_a", "number.luftator_b"] });
    expect((await api.call("POST", "/api/automatic/rooms/1/groups/999")).status).toBe(404);
  });

  it("lists sensor candidates from Home Assistant, and 503 without it", async () => {
    const { silentLogger } = await import("../helpers/httpRouter.js");
    const { createAutomaticRouter } = await import("../../src/routes/automatic.js");
    const withHa = await serveRouters({
      "/api/automatic": createAutomaticRouter({
        logger: silentLogger() as never,
        homeAssistant: {
          fetchAllStates: async () => [
            { entity_id: "sensor.co2", state: "700", attributes: { unit_of_measurement: "ppm" } },
          ],
        },
      }),
    });
    try {
      const result = await withHa.call("GET", "/api/automatic/sensor-candidates");
      expect(result.body).toEqual([
        expect.objectContaining({ entityId: "sensor.co2", values: [expect.anything()] }),
      ]);
    } finally {
      await withHa.close();
    }
    expect((await api.call("GET", "/api/automatic/sensor-candidates")).status).toBe(503);
  });
});

describe("automatic control status and journal API", () => {
  let cleanup: () => void;
  let api: ServedRouter;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    const { silentLogger } = await import("../helpers/httpRouter.js");
    const { createAutomaticRouter } = await import("../../src/routes/automatic.js");
    api = await serveRouters({
      "/api/automatic": createAutomaticRouter({
        logger: silentLogger() as never,
        activeSource: () => ({ source: "schedule", name: "Plán: Útlum" }),
      }),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  it("reports automatic control as not running, with the source that applies", async () => {
    const result = await api.call("GET", "/api/automatic/status");
    expect(result.body).toMatchObject({
      active: false,
      source: "schedule",
      sourceName: "Plán: Útlum",
    });
  });

  it("journals room changes and returns them newest first", async () => {
    await api.call("POST", "/api/automatic/rooms", { name: "Obývák" });
    await api.call("PUT", "/api/automatic/parameters", { overrides: { th1: 900 } });
    const journal = await api.call("GET", "/api/automatic/journal?limit=10");
    const kinds = (journal.body as unknown as { kind: string }[]).map((entry) => entry.kind);
    expect(kinds).toEqual(["parameters", "rooms"]);
    expect((await api.call("GET", "/api/automatic/journal?limit=0")).status).toBe(400);
  });
});
