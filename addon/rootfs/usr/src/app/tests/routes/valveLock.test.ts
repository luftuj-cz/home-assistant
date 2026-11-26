import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";
import { setupTempDatabase } from "../helpers/testDb.js";

/** While automatic control runs, the valves of its rooms refuse manual writes. */
describe("valves held by automatic control", () => {
  let cleanup: () => void;
  let api: ServedRouter;
  let setValue: ReturnType<typeof vi.fn>;
  let locked: Map<string, string>;
  let database: typeof import("../../src/services/database.js");

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    database = temp.database;
    const { silentLogger } = await import("../helpers/httpRouter.js");
    const { createValvesRouter } = await import("../../src/routes/valves.js");
    const { createValveGroupsRouter } = await import("../../src/routes/valveGroups.js");
    locked = new Map([["number.luftator_obyvak", "Obývák"]]);
    setValue = vi.fn(async (entityId: string, value: number) => ({
      entity_id: entityId,
      state: String(value),
      attributes: {},
    }));
    const valveManager = { getSnapshot: async () => [], setValue } as never;
    function lookup(entityId: string) {
      return locked.get(entityId) ?? null;
    }
    api = await serveRouters({
      "/api/valves": createValvesRouter(valveManager, silentLogger() as never, lookup),
      "/api/valve-groups": createValveGroupsRouter(valveManager, silentLogger() as never, lookup),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  it("refuses a manual write to a locked valve with 409", async () => {
    const result = await api.call("POST", "/api/valves/number.luftator_obyvak", { value: 30 });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ code: "VALVE_LOCKED" });
    expect(setValue).not.toHaveBeenCalled();
  });

  it("writes a valve outside the rooms, and every valve once nothing is locked", async () => {
    expect(
      (await api.call("POST", "/api/valves/number.luftator_chodba", { value: 30 })).status,
    ).toBe(200);
    locked.clear();
    expect(
      (await api.call("POST", "/api/valves/number.luftator_obyvak", { value: 30 })).status,
    ).toBe(200);
  });

  it("leaves locked valves out of a group write and reports them", async () => {
    const group = database.upsertValveGroup({ name: "Přízemí" });
    database.setGroupMembers(group.id, ["number.luftator_obyvak", "number.luftator_chodba"]);
    const result = await api.call("POST", `/api/valve-groups/${group.id}/bulk-set`, { value: 20 });
    expect(result.status).toBe(207);
    expect(result.body).toMatchObject({ succeeded: 1, locked: ["number.luftator_obyvak"] });
    expect(setValue).toHaveBeenCalledTimes(1);
  });
});
