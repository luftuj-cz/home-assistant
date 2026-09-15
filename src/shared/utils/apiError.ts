import type { TFunction } from "i18next";
import { translateErrorCode } from "@luftuj/shared/utils/errorTranslation";

export class ApiResponseError extends Error {
  readonly code?: string;
  /** Untranslated technical detail behind a generic code, when the API sent one. */
  readonly cause?: string;

  constructor(message: string, code?: string, cause?: string) {
    super(message);
    this.name = "ApiResponseError";
    this.code = code;
    this.cause = cause;
  }
}

export async function parseApiError(res: Response): Promise<ApiResponseError> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { detail?: string; code?: string; cause?: string };
    return new ApiResponseError(json.detail || text || "Unknown error", json.code, json.cause);
  } catch {
    return new ApiResponseError(text || "Unknown error");
  }
}

export function translateApiError(err: unknown, t: TFunction): string {
  const fallback =
    err instanceof Error ? err.message : t("settings.timeline.notifications.unknown");
  const code = err instanceof ApiResponseError ? err.code : undefined;
  const message = translateErrorCode("apiErrors", code, fallback, t);
  // The translated text for a code like HRU_CONNECTION_ERROR is deliberately
  // generic; the cause is what says which register rejected which value.
  const cause = err instanceof ApiResponseError ? err.cause : undefined;
  return cause && !message.includes(cause) ? `${message} — ${cause}` : message;
}
