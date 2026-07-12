import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../helpers/testDb.js";

describe("valve groups repository", () => {
  let testDb: Awaited<ReturnType<typeof setupTempDatabase>>;

  beforeEach(async () => {
    testDb = await setupTempDatabase();
  });

  afterEach(() => testDb.cleanup());

  it("creates a group and lists it with no members", () => {
    const group = testDb.database.upsertValveGroup({ name: "Living room" });
    expect(group.id).toBeGreaterThan(0);
    expect(group.name).toBe("Living room");
    expect(group.entityIds).toEqual([]);

    const groups = testDb.database.getValveGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Living room");
  });

  it("rejects duplicate group names", () => {
    testDb.database.upsertValveGroup({ name: "Bedroom" });
    expect(() => testDb.database.upsertValveGroup({ name: "Bedroom" })).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it("renames a group via upsert with id", () => {
    const created = testDb.database.upsertValveGroup({ name: "Kitchen" });
    const updated = testDb.database.upsertValveGroup({
      id: created.id,
      name: "Kitchen renamed",
      sortOrder: 2,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Kitchen renamed");
    expect(updated.sortOrder).toBe(2);
  });

  it("assigns valves to a group, ensuring one group per valve", () => {
    const groupA = testDb.database.upsertValveGroup({ name: "Group A" });
    const groupB = testDb.database.upsertValveGroup({ name: "Group B" });

    testDb.database.setGroupMembers(groupA.id, [
      "number.luftator_ctrl_1",
      "number.luftator_ctrl_2",
    ]);
    let a = testDb.database.getValveGroup(groupA.id);
    expect(a?.entityIds.sort()).toEqual(["number.luftator_ctrl_1", "number.luftator_ctrl_2"]);

    // Moving a valve into group B removes it from group A
    testDb.database.setGroupMembers(groupB.id, ["number.luftator_ctrl_1"]);
    a = testDb.database.getValveGroup(groupA.id);
    const b = testDb.database.getValveGroup(groupB.id);
    expect(a?.entityIds).toEqual(["number.luftator_ctrl_2"]);
    expect(b?.entityIds).toEqual(["number.luftator_ctrl_1"]);
  });

  it("removes a single valve from its group", () => {
    const group = testDb.database.upsertValveGroup({ name: "Group" });
    testDb.database.setGroupMembers(group.id, ["number.luftator_ctrl_1"]);
    testDb.database.removeValveFromGroup("number.luftator_ctrl_1");
    const refreshed = testDb.database.getValveGroup(group.id);
    expect(refreshed?.entityIds).toEqual([]);
  });

  it("deletes a group and cascades membership removal", () => {
    const group = testDb.database.upsertValveGroup({ name: "To delete" });
    testDb.database.setGroupMembers(group.id, ["number.luftator_ctrl_1"]);

    testDb.database.deleteValveGroup(group.id);

    expect(testDb.database.getValveGroup(group.id)).toBeNull();
    const memberRows = testDb.db
      .prepare("SELECT * FROM valve_group_members WHERE group_id = ?")
      .all(group.id);
    expect(memberRows).toHaveLength(0);
  });

  it("sorts groups by sortOrder then name", () => {
    testDb.database.upsertValveGroup({ name: "Zebra", sortOrder: 0 });
    testDb.database.upsertValveGroup({ name: "Apple", sortOrder: 1 });
    testDb.database.upsertValveGroup({ name: "Banana", sortOrder: 0 });

    const groups = testDb.database.getValveGroups();
    expect(groups.map((g) => g.name)).toEqual(["Banana", "Zebra", "Apple"]);
  });
});
