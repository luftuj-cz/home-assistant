/** Shared shape for tracked connection error state, reused by both the Modbus client and MqttService. */
export interface ConnectionErrorState {
  lastErrorMessage: string | null;
  lastErrorCode: string | null;
  lastErrorAt: number | null;
}

/**
 * Derives a stable, translatable error code from a raw connection error.
 * Only trusts `.code` when it's a string - Node socket errors carry a string
 * errno (ECONNREFUSED, ETIMEDOUT, ...), but some libraries (e.g. mqtt.js's
 * ErrorWithReasonCode) reuse `.code` for a numeric, protocol-specific reason
 * code that isn't safe to surface here. Protocol-specific message-pattern
 * classification belongs in that protocol's own module, with this as the
 * generic fallback. Falls back to "UNKNOWN" so callers always get a code to
 * key a translation off of.
 */
export function classifyConnectionError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "UNKNOWN";
}
