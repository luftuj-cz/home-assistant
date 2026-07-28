import type { AppConfig } from "../../config/options.js";

export const REDACTED = "***redacted***";

/**
 * Keys whose value is always a secret regardless of content. Matched
 * case-insensitively as a substring of the key name.
 */
const SENSITIVE_KEY_PATTERN =
  /token|password|secret|authorization|bearer|api[_-]?key|^user$|user[_-]?name|mqtt[_-]?user/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Usernames that are too short or too common to be replaced blindly. Scrubbing
 * `mqtt` or `homeassistant` out of every string would corrupt hostnames, MQTT
 * topics and entity ids throughout the bundle, which is far more damaging than
 * leaving a non-secret username visible. Such usernames are still masked
 * wherever they sit behind a `user`-ish key (see SENSITIVE_KEY_PATTERN).
 */
const MIN_SCRUBBABLE_USERNAME_LENGTH = 6;

const COMMON_USERNAMES = new Set([
  "addon",
  "admin",
  "core-mosquitto",
  "guest",
  "homeassistant",
  "hass",
  "mosquitto",
  "mqtt",
  "root",
  "user",
]);

function isScrubbableUsername(value: string): boolean {
  return (
    value.length >= MIN_SCRUBBABLE_USERNAME_LENGTH && !COMMON_USERNAMES.has(value.toLowerCase())
  );
}

/**
 * Collect the concrete secret values in play so they can be scrubbed out of
 * free-form strings (log lines, serialized `app_settings`, error messages)
 * where they are not behind an obviously-named key.
 *
 * Tokens and passwords are always included. Usernames only qualify when they
 * are distinctive enough to replace safely (see `isScrubbableUsername`) —
 * blind-replacing a short or common username would corrupt unrelated
 * hostnames, MQTT topics and entity ids all over the bundle.
 */
export function collectSecrets(config: AppConfig): string[] {
  const secrets = new Set<string>();

  function add(value: string | null | undefined): void {
    if (typeof value === "string" && value.length > 0) {
      secrets.add(value);
    }
  }

  function addUsername(value: string | null | undefined): void {
    if (typeof value === "string" && isScrubbableUsername(value)) {
      secrets.add(value);
    }
  }

  add(config.token);
  add(config.mqtt.password);
  addUsername(config.mqtt.user);
  add(process.env.SUPERVISOR_TOKEN);
  add(process.env.HA_TOKEN);
  add(process.env.MQTT_PASSWORD);
  addUsername(process.env.MQTT_USER);

  return [...secrets];
}

function redactString(input: string, secrets: string[]): string {
  let output = input;
  for (const secret of secrets) {
    if (secret && output.includes(secret)) {
      output = output.split(secret).join(REDACTED);
    }
  }
  return output;
}

/**
 * Deep-redact a value before it enters a bug-report bundle. Two layers:
 *  1. Any object key that looks like a credential is masked outright.
 *  2. Any known secret value is scrubbed out of every remaining string,
 *     catching credentials embedded in serialized JSON or log text.
 *
 * Returns a redacted deep copy; the input is never mutated.
 */
export function redactSecrets<T>(input: T, secrets: string[] = []): T {
  const activeSecrets = secrets.filter((secret) => secret.length > 0);

  function walk(node: unknown, keyHint?: string): unknown {
    if (typeof node === "string") {
      if (keyHint !== undefined && isSensitiveKey(keyHint) && node.length > 0) {
        return REDACTED;
      }
      return redactString(node, activeSecrets);
    }

    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }

    if (node !== null && typeof node === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (isSensitiveKey(key) && value !== null && value !== undefined && value !== "") {
          result[key] = REDACTED;
        } else {
          result[key] = walk(value, key);
        }
      }
      return result;
    }

    return node;
  }

  return walk(input) as T;
}

/**
 * Structured, non-secret view of the app config for the bundle. Credentials
 * are replaced with a boolean "is it set" flag so support can tell whether a
 * value was configured without ever seeing it.
 */
export function maskConfig(config: AppConfig): Record<string, unknown> {
  return {
    logLevel: config.logLevel,
    baseUrl: config.baseUrl,
    tokenConfigured: config.token !== null,
    webPort: config.webPort,
    staticRoot: config.staticRoot,
    corsOrigins: config.corsOrigins,
    offlineMode: config.offlineMode,
    mqtt: {
      host: config.mqtt.host,
      port: config.mqtt.port,
      userConfigured: config.mqtt.user !== null,
      passwordConfigured: config.mqtt.password !== null,
    },
  };
}
