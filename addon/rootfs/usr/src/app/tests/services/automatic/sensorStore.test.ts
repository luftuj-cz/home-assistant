import { afterEach, describe, expect, it, vi } from "vitest";
import { SensorReadingStore } from "../../../src/services/automatic/sensorStore.js";
import { HomeAssistantClient, type HassState } from "../../../src/services/homeAssistantClient.js";
import { silentLogger } from "../../helpers/httpRouter.js";

function hass(entityId: string, value: string): HassState {
  return { entity_id: entityId, state: value, attributes: {} };
}

function fakeSource(states: Record<string, HassState | null>) {
  let stateListener: ((state: HassState) => void) | null = null;
  let statusListener: ((state: "disconnected" | "connecting" | "connected") => void) | null = null;
  return {
    fetchState: vi.fn(async (id: string) => states[id] ?? null),
    addStateListener: vi.fn((listener: (state: HassState) => void) => {
      stateListener = listener;
      return () => (stateListener = null);
    }),
    addStatusListener: vi.fn(
      (listener: (state: "disconnected" | "connecting" | "connected") => void) => {
        statusListener = listener;
        return () => (statusListener = null);
      },
    ),
    emit: (state: HassState) => stateListener?.(state),
    status: (state: "disconnected" | "connecting" | "connected") => statusListener?.(state),
  };
}

describe("SensorReadingStore", () => {
  let store: SensorReadingStore | null = null;
  afterEach(() => store?.stop());

  it("fetches a newly tracked sensor at once", async () => {
    const source = fakeSource({ "sensor.loznice_co2": hass("sensor.loznice_co2", "650") });
    store = new SensorReadingStore(source, silentLogger() as never);
    store.start();
    await store.track(["sensor.loznice_co2"]);
    expect(store.get("sensor.loznice_co2")?.state).toBe("650");
  });

  it("follows changes of tracked entities only", async () => {
    const source = fakeSource({ "sensor.a": hass("sensor.a", "600") });
    store = new SensorReadingStore(source, silentLogger() as never);
    store.start();
    await store.track(["sensor.a"]);
    source.emit(hass("sensor.a", "900"));
    source.emit(hass("sensor.b", "1000"));
    expect(store.get("sensor.a")?.state).toBe("900");
    expect(store.get("sensor.b")).toBeUndefined();
  });

  it("refreshes on a timer, so an unchanged value keeps its report time current", async () => {
    vi.useFakeTimers();
    try {
      const states = { "sensor.a": { ...hass("sensor.a", "800"), last_reported: "t1" } };
      const source = fakeSource(states);
      store = new SensorReadingStore(source, silentLogger() as never, 60_000);
      store.start();
      await store.track(["sensor.a"]);
      states["sensor.a"] = { ...hass("sensor.a", "800"), last_reported: "t2" };
      await vi.advanceTimersByTimeAsync(60_000);
      expect(store.get("sensor.a")?.last_reported).toBe("t2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches again after the WebSocket reconnects", async () => {
    const source = fakeSource({ "sensor.a": hass("sensor.a", "600") });
    store = new SensorReadingStore(source, silentLogger() as never);
    store.start();
    await store.track(["sensor.a"]);
    source.fetchState.mockClear();
    source.status("connected");
    await vi.waitFor(() => expect(source.fetchState).toHaveBeenCalledWith("sensor.a"));
  });

  it("keeps the last state when a fetch fails, and drops untracked entities", async () => {
    const source = fakeSource({ "sensor.a": hass("sensor.a", "600") });
    store = new SensorReadingStore(source, silentLogger() as never);
    await store.track(["sensor.a"]);
    source.fetchState.mockRejectedValueOnce(new Error("down"));
    await store.refresh();
    expect(store.get("sensor.a")?.state).toBe("600");
    await store.track([]);
    expect(store.get("sensor.a")).toBeUndefined();
  });

  it("works without Home Assistant", async () => {
    store = new SensorReadingStore(null, silentLogger() as never);
    store.start();
    await store.track(["sensor.a"]);
    expect(store.get("sensor.a")).toBeUndefined();
    expect(store.snapshot()).toEqual({ "sensor.a": null });
  });
});

describe("SensorReadingStore change tracking", () => {
  it("keeps the change time while the value repeats and moves it when the value changes", async () => {
    let now = Date.parse("2026-11-26T12:00:00Z");
    const first = {
      ...hass("sensor.a", "800"),
      attributes: { co2: 800, rssi: -60 },
      last_changed: "2026-11-26T10:00:00Z",
      last_updated: "2026-11-26T11:00:00Z",
    };
    const source = fakeSource({ "sensor.a": first });
    const store = new SensorReadingStore(source, silentLogger() as never, 60_000, () => now);
    store.start();
    await store.track(["sensor.a"]);
    // First sight counts from Home Assistant's own change times.
    expect(store.changedAt("sensor.a", null)).toBe(Date.parse("2026-11-26T10:00:00Z"));
    expect(store.changedAt("sensor.a", "co2")).toBe(Date.parse("2026-11-26T11:00:00Z"));

    now += 600_000;
    source.emit({ ...first, attributes: { co2: 800, rssi: -58 } });
    expect(store.changedAt("sensor.a", "co2")).toBe(Date.parse("2026-11-26T11:00:00Z"));

    source.emit({ ...first, state: "820", attributes: { co2: 820, rssi: -58 } });
    expect(store.changedAt("sensor.a", null)).toBe(now);
    expect(store.changedAt("sensor.a", "co2")).toBe(now);
    store.stop();
  });
});

describe("HomeAssistantClient state listeners", () => {
  it("hands every entity's change to state listeners and only valves to the valve handler", () => {
    const client = new HomeAssistantClient("http://ha", "token", silentLogger() as never);
    const seen: string[] = [];
    client.addStateListener((state) => seen.push(state.entity_id));
    const handler = vi.fn();
    const processEvent = (
      client as unknown as { processEvent: (payload: unknown, h: unknown) => void }
    ).processEvent.bind(client);

    processEvent(
      { data: { entity_id: "sensor.co2", new_state: hass("sensor.co2", "700") } },
      handler,
    );
    processEvent(
      { data: { entity_id: "number.luftator_a", new_state: hass("number.luftator_a", "0") } },
      handler,
    );

    expect(seen).toEqual(["sensor.co2", "number.luftator_a"]);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
