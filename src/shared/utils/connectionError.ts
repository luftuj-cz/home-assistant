import type { TFunction } from "i18next";
import { translateErrorCode } from "@luftuj/shared/utils/errorTranslation";

/**
 * Translates a Modbus/MQTT connection error code into a human-readable
 * message. Falls back to a generic "unknown" phrase (with the raw message
 * interpolated in) when the code has no translation — the raw Node/Modbus
 * error text is never shown as the whole message, only interpolated inside
 * an already-translated sentence.
 */
export function translateConnectionError(
  namespace: "modbusErrors" | "mqttErrors",
  code: string | null | undefined,
  rawMessage: string | null | undefined,
  t: TFunction,
): string {
  const fallback = t(`dashboard.${namespace}.unknown`, { error: rawMessage ?? "" });
  return translateErrorCode(`dashboard.${namespace}`, code, fallback, t);
}
