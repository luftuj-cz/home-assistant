import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the published payload, not the resolver underneath it: checking the
 * resolver alone let a bug through, where `hru.bypassAuto` translated fine in
 * isolation while the bypass sensor still received the raw key.
 */

const language = { value: "cs" };

vi.mock("mqtt", () => ({ default: { connect: vi.fn() } }));
vi.mock("../../src/services/database.js", () => ({
  getAppSetting: () => language.value,
  getActiveSeasonId: () => undefined,
}));

const { MqttService } = await import("../../src/services/mqttService.js");

const UNIT = {
  code: "brink",
  name: "Brink",
  variables: [
    {
      name: "bypass",
      type: "select",
      label: { text: "hru.bypass", translate: true },
      options: [
        { value: 0, label: { text: "hru.bypassAuto", translate: true } },
        { value: 1, label: { text: "hru.bypassClosed", translate: true } },
      ],
    },
    {
      name: "mode",
      class: "mode",
      type: "select",
      label: { text: "hru.mode", translate: true },
      options: [
        { value: 1, label: { text: "hru.modes.ventilation", translate: true } },
        { value: 5, label: { text: "Mode target", translate: false } },
      ],
    },
  ],
};

function makeService() {
  const published: { topic: string; payload: string }[] = [];
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const service = new MqttService({} as never, {} as never, {} as never, logger as never);

  const internals = service as unknown as {
    client: unknown;
    connected: boolean;
    cachedDiscoveryUnit: unknown;
  };
  internals.client = {
    publishAsync: (topic: string, payload: string) => {
      published.push({ topic, payload });
      return Promise.resolve();
    },
  };
  internals.connected = true;
  internals.cachedDiscoveryUnit = UNIT;

  return { service, published };
}

async function publish(state: Record<string, unknown>) {
  const { service, published } = makeService();
  await service.publishState(state);
  return JSON.parse(published[0]!.payload) as Record<string, unknown>;
}

describe("publishState localisation", () => {
  beforeEach(() => {
    language.value = "cs";
  });

  it("translates a select variable that is not the mode", async () => {
    const payload = await publish({ bypass: "hru.bypassAuto" });
    expect(payload.bypass).toBe("Automaticky");
  });

  it("translates the mode as well", async () => {
    const payload = await publish({ mode: 1, mode_formatted: "hru.modes.ventilation" });
    expect(payload.mode_formatted).toBe("Větrání");
    expect(payload.mode_display).toBe("Větrání");
  });

  it("leaves a translate:false label as written", async () => {
    const payload = await publish({ mode: "Mode target" });
    expect(payload.mode).toBe("Mode target");
  });

  it("shows the season name but keeps the key for automations", async () => {
    const payload = await publish({ active_season: "summer" });
    expect(payload.active_season).toBe("Léto");
    expect(payload.active_season_key).toBe("summer");
  });

  it("leaves the season placeholder alone when seasons are off", async () => {
    const payload = await publish({ active_season: "-" });
    expect(payload.active_season).toBe("-");
    expect(payload.active_season_key).toBe("-");
  });

  it("publishes English when the interface language is English", async () => {
    language.value = "en";
    const payload = await publish({ bypass: "hru.bypassAuto", active_season: "summer" });
    expect(payload.bypass).toBe("Automatic");
    expect(payload.active_season).toBe("Summer");
  });

  it("does not translate a value that is not one of the variable's options", async () => {
    // A real key, but not a bypass option.
    const payload = await publish({ bypass: "hru.modes.ventilation" });
    expect(payload.bypass).toBe("hru.modes.ventilation");
  });

  it("passes an unmatched select reading through", async () => {
    const payload = await publish({ bypass: "7" });
    expect(payload.bypass).toBe("7");
  });

  it("omits the season fields when the state carries no season", async () => {
    const payload = await publish({ power: 10 });
    expect("active_season" in payload).toBe(false);
    expect("active_season_key" in payload).toBe(false);
  });

  it("passes numeric readings through untouched", async () => {
    const payload = await publish({ power: 45, temperature: 21.5 });
    expect(payload.power).toBe(45);
    expect(payload.temperature).toBe(21.5);
  });
});
