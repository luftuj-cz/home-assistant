import { describe, expect, it } from "vitest";
import {
  collectSecrets,
  maskConfig,
  REDACTED,
  redactSecrets,
} from "../../src/features/support/redact.js";
import type { AppConfig } from "../../src/config/options.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    logLevel: "info",
    baseUrl: "http://supervisor/core",
    token: "SECRET_HA_TOKEN",
    webPort: 8099,
    staticRoot: "/usr/share/luftujha/www",
    corsOrigins: ["*"],
    offlineMode: false,
    mqtt: {
      host: "core-mosquitto",
      port: 1883,
      user: "mqtt-user",
      password: "MQTT_PASSWORD",
    },
    ...overrides,
  };
}

describe("redactSecrets", () => {
  it("masks values under credential-like keys", () => {
    const input = { token: "abc123", nested: { password: "hunter2" }, keep: "value" };
    const result = redactSecrets(input);
    expect(result.token).toBe(REDACTED);
    expect(result.nested.password).toBe(REDACTED);
    expect(result.keep).toBe("value");
  });

  it("scrubs known secret values embedded in free-form strings", () => {
    const secrets = ["SECRET_HA_TOKEN", "MQTT_PASSWORD"];
    const input = {
      logLine: "connecting with SECRET_HA_TOKEN and MQTT_PASSWORD",
      note: "nothing here",
    };
    const result = redactSecrets(input, secrets);
    expect(result.logLine).not.toContain("SECRET_HA_TOKEN");
    expect(result.logLine).not.toContain("MQTT_PASSWORD");
    expect(result.logLine).toContain(REDACTED);
    expect(result.note).toBe("nothing here");
  });

  it("handles arrays and leaves non-secret primitives intact", () => {
    const result = redactSecrets(
      { items: [{ token: "x" }, { safe: 1 }] } as {
        items: [{ token: string }, { safe: number }];
      },
      [],
    );
    expect(result.items[0].token).toBe(REDACTED);
    expect(result.items[1].safe).toBe(1);
  });

  it("masks usernames behind user-ish keys without touching similar text", () => {
    const result = redactSecrets({
      mqtt: { user: "mqtt", host: "core-mosquitto" },
      username: "admin",
      note: "topic luftator/mqtt/state",
    });
    expect(result.mqtt.user).toBe(REDACTED);
    expect(result.username).toBe(REDACTED);
    expect(result.mqtt.host).toBe("core-mosquitto");
    expect(result.note).toBe("topic luftator/mqtt/state");
  });

  it("does not mutate the input", () => {
    const input = { token: "abc" };
    redactSecrets(input);
    expect(input.token).toBe("abc");
  });

  it("leaves empty credential values untouched", () => {
    const result = redactSecrets({ token: "" });
    expect(result.token).toBe("");
  });
});

describe("collectSecrets", () => {
  it("gathers non-empty token and mqtt password", () => {
    const secrets = collectSecrets(makeConfig());
    expect(secrets).toContain("SECRET_HA_TOKEN");
    expect(secrets).toContain("MQTT_PASSWORD");
  });

  it("skips short or common usernames as raw secret values", () => {
    // Blind substring replacement of "mqtt" / "homeassistant" would corrupt
    // unrelated hostnames, topics and entity ids throughout the bundle.
    for (const user of ["mqtt", "admin", "homeassistant"]) {
      const secrets = collectSecrets(
        makeConfig({ mqtt: { host: null, port: 1883, user, password: null } }),
      );
      expect(secrets).not.toContain(user);
    }
  });

  it("still scrubs distinctive usernames", () => {
    const secrets = collectSecrets(
      makeConfig({ mqtt: { host: null, port: 1883, user: "luftator-svc", password: null } }),
    );
    expect(secrets).toContain("luftator-svc");
  });

  it("omits null credentials", () => {
    const secrets = collectSecrets(
      makeConfig({ token: null, mqtt: { host: null, port: 1883, user: null, password: null } }),
    );
    expect(secrets).not.toContain("SECRET_HA_TOKEN");
  });

  it("picks up credentials saved through the Settings UI", () => {
    // A password entered in the UI lives in app_settings and may differ from
    // the add-on config; it has to be scrubbed from free-form text as well.
    const secrets = collectSecrets(makeConfig(), {
      "mqtt.settings": JSON.stringify({
        enabled: true,
        host: "core-mosquitto",
        port: 1883,
        user: "luftator-ui-user",
        password: "UI_SAVED_PASSWORD",
      }),
      "hru.settings": JSON.stringify({ unit: "atrea-am", host: "192.168.1.20" }),
      "frontend.log_level": "info",
    });
    expect(secrets).toContain("UI_SAVED_PASSWORD");
    expect(secrets).toContain("luftator-ui-user");
    expect(secrets).not.toContain("192.168.1.20");
    expect(secrets).not.toContain("info");
  });
});

describe("maskConfig", () => {
  it("replaces secrets with configured flags and never leaks values", () => {
    const masked = maskConfig(makeConfig());
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain("SECRET_HA_TOKEN");
    expect(serialized).not.toContain("MQTT_PASSWORD");
    expect(serialized).not.toContain("mqtt-user");
    expect(masked.tokenConfigured).toBe(true);
    expect((masked.mqtt as Record<string, unknown>).passwordConfigured).toBe(true);
    expect((masked.mqtt as Record<string, unknown>).host).toBe("core-mosquitto");
  });
});
