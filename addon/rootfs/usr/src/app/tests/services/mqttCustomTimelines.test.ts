import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../helpers/testDb.js";

vi.mock("mqtt", () => ({ default: { connect: vi.fn() } }));

type StoreModule = typeof import("../../src/services/db/customTimelines.js");
type OverrideModule = typeof import("../../src/services/timeline/customOverride.js");

const UNIT = "atrea-am";
const SLUG = "atrea_am";
const UTLUM = 1;

interface Internals {
  client: unknown;
  connected: boolean;
  cachedDiscoveryUnit: unknown;
  updateCustomTimelineDiscovery: (
    unitId: string,
    device: object,
    availability: object[],
  ) => Promise<number>;
  handleIncomingMessage: (topic: string, payload: string) => Promise<void>;
}

/**
 * The Home Assistant side of custom timelines, checked against what is actually
 * published: one switch per timeline identified by its id, commands that
 * activate and end the override, and the override in the state payload.
 */
describe("MQTT custom timeline switches", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let store: StoreModule;
  let overrides: OverrideModule;
  let internals: Internals;
  let service: { publishState: (state: Record<string, unknown>) => Promise<void> };
  let published: { topic: string; payload: string }[];
  let errors: string[];
  let timelineId: number;
  let applied: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    store = await import("../../src/services/db/customTimelines.js");
    overrides = await import("../../src/services/timeline/customOverride.js");

    temp.database.setAppSetting("hru.settings", JSON.stringify({ unit: UNIT }));
    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order, name)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0, 'Topná sezóna')`,
    ).run(UNIT);
    const seasonId = temp.database.getActiveSeasonId(UNIT)!;
    db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (?, 'Útlum', '#1971c2', 0, ?)`,
    ).run(UTLUM, UNIT);
    db.prepare(
      `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, 30)`,
    ).run(UTLUM, seasonId);
    timelineId = store.createCustomTimeline(UNIT, "Dovolená").id;

    published = [];
    errors = [];
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: (_context: unknown, message?: string) => errors.push(message ?? ""),
    };
    applied = vi.fn(async () => undefined);
    const { SettingsRepository } =
      await import("../../src/features/settings/settings.repository.js");
    const { MqttService } = await import("../../src/services/mqttService.js");
    const mqtt = new MqttService(
      {} as never,
      new SettingsRepository(logger as never),
      { executeScheduledEventOrThrow: applied, isCustomOverrideDegraded: () => false } as never,
      logger as never,
      { getAllUnits: () => [{ id: UNIT }] } as never,
    );
    service = mqtt as never;
    internals = mqtt as unknown as Internals;
    internals.client = {
      publishAsync: (topic: string, payload: string) => {
        published.push({ topic, payload });
        return Promise.resolve();
      },
    };
    internals.connected = true;
    internals.cachedDiscoveryUnit = { code: UNIT, name: "Atrea", variables: [] };
  });

  afterEach(() => {
    cleanup();
  });

  function configTopic(id: number) {
    return `homeassistant/switch/luftuj_hru_${SLUG}/custom_timeline_${id}/config`;
  }

  function stateTopic(id: number) {
    return `luftuj/hru/${SLUG}/custom_timeline/${id}/state`;
  }

  function commandTopic(id: number) {
    return `luftuj/hru/${SLUG}/custom_timeline/${id}/set`;
  }

  function lastOn(topic: string) {
    return published.filter((message) => message.topic === topic).at(-1);
  }

  function addEvent() {
    store.upsertCustomTimelineEvent({
      customTimelineId: timelineId,
      modeId: UTLUM,
      dayOfWeek: null,
      startTime: "00:00",
      enabled: true,
      priority: 0,
    });
  }

  async function discover() {
    await internals.updateCustomTimelineDiscovery(SLUG, {}, []);
  }

  it("publishes one switch per timeline, identified by its id", async () => {
    await discover();

    const config = JSON.parse(lastOn(configTopic(timelineId))!.payload) as Record<string, string>;
    expect(config).toMatchObject({
      name: "Dovolená",
      unique_id: `luftuj_hru_${SLUG}_custom_timeline_${timelineId}`,
      command_topic: commandTopic(timelineId),
      state_topic: stateTopic(timelineId),
    });
    expect(lastOn(stateTopic(timelineId))?.payload).toBe("OFF");
  });

  it("keeps the entity when the timeline is renamed", async () => {
    await discover();
    store.renameCustomTimeline(timelineId, "Chata");

    await discover();

    const config = JSON.parse(lastOn(configTopic(timelineId))!.payload) as Record<string, string>;
    expect(config.name).toBe("Chata");
    expect(config.unique_id).toBe(`luftuj_hru_${SLUG}_custom_timeline_${timelineId}`);
  });

  it("removes the switch of a deleted timeline", async () => {
    await discover();
    store.deleteCustomTimeline(timelineId);

    await discover();

    expect(lastOn(configTopic(timelineId))?.payload).toBe("");
  });

  it("ON activates the timeline indefinitely and reports the switch on", async () => {
    addEvent();
    await discover();

    await internals.handleIncomingMessage(commandTopic(timelineId), "ON");

    expect(overrides.readCustomOverride()).toMatchObject({
      customTimelineId: timelineId,
      endsAt: null,
    });
    expect(applied).toHaveBeenCalled();
    expect(lastOn(stateTopic(timelineId))?.payload).toBe("ON");
  });

  it("OFF ends only the override it names", async () => {
    addEvent();
    const other = store.createCustomTimeline(UNIT, "Chata").id;
    await discover();
    await internals.handleIncomingMessage(commandTopic(timelineId), "ON");

    await internals.handleIncomingMessage(commandTopic(other), "OFF");
    expect(overrides.readCustomOverride()).not.toBeNull();

    await internals.handleIncomingMessage(commandTopic(timelineId), "OFF");
    expect(overrides.readCustomOverride()).toBeNull();
    expect(lastOn(stateTopic(timelineId))?.payload).toBe("OFF");
  });

  it("a rejected ON is logged and the switch is reported off again", async () => {
    await discover();
    published = [];

    await internals.handleIncomingMessage(commandTopic(timelineId), "ON");

    expect(overrides.readCustomOverride()).toBeNull();
    expect(errors.some((message) => message.includes("custom timeline switch rejected"))).toBe(
      true,
    );
    expect(lastOn(stateTopic(timelineId))?.payload).toBe("OFF");
  });

  it("puts the override and the season's own name into the state payload", async () => {
    addEvent();
    await discover();
    await internals.handleIncomingMessage(commandTopic(timelineId), "ON");

    await service.publishState({ active_season: "spring" });

    const payload = JSON.parse(lastOn(`luftuj/hru/${SLUG}/state`)!.payload) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      active_season: "Topná sezóna",
      active_season_key: "spring",
      custom_timeline_id: timelineId,
      custom_timeline_name: "Dovolená",
      custom_timeline_until: null,
    });
  });
});
