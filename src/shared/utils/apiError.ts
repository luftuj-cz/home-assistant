import type { TFunction } from "i18next";
import { translateErrorCode } from "@luftuj/shared/utils/errorTranslation";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";

export class ApiResponseError extends Error {
  readonly code?: string;
  /** Untranslated technical detail behind a generic code, when the API sent one. */
  readonly cause?: string;
  /** Structured context of a rule violation: which modes, seasons or plans. */
  readonly details?: unknown;

  constructor(message: string, code?: string, cause?: string, details?: unknown) {
    super(message);
    this.name = "ApiResponseError";
    this.code = code;
    this.cause = cause;
    this.details = details;
  }
}

export async function parseApiError(res: Response): Promise<ApiResponseError> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as {
      detail?: string;
      code?: string;
      cause?: string;
      details?: unknown;
    };
    return new ApiResponseError(
      json.detail || text || "Unknown error",
      json.code,
      json.cause,
      json.details,
    );
  } catch {
    return new ApiResponseError(text || "Unknown error");
  }
}

interface MissingModeDetail {
  modeName: string | null;
  /** `name` is the user's own name for the season, when they gave it one. */
  seasons: { seasonKey: string | null; name?: string | null }[];
}

/**
 * The names a rule violation is about, as one line: "Útlum (Léto, Zima)" or
 * "Dovolená, Chata". Without it the translated code says what went wrong but
 * not where to go and fix it.
 */
function describeDetails(details: unknown, t: TFunction): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const record = details as Record<string, unknown>;

  if (Array.isArray(record.missing)) {
    return (record.missing as MissingModeDetail[])
      .map((entry) => {
        // Through seasonLabel like every other season label, so a renamed
        // season is called the same thing in the toast as in the switcher.
        const seasons = entry.seasons
          .map((season) =>
            season.seasonKey ? seasonLabel({ ...season, seasonKey: season.seasonKey }, t) : "",
          )
          .filter(Boolean)
          .join(", ");
        const name = entry.modeName ?? "?";
        return seasons ? `${name} (${seasons})` : name;
      })
      .join("; ");
  }
  if (Array.isArray(record.customTimelines)) {
    return (record.customTimelines as { name?: string }[])
      .map((entry) => entry.name)
      .filter(Boolean)
      .join(", ");
  }
  const conflict = record.conflict as { name?: string } | undefined;
  return conflict?.name;
}

export function translateApiError(err: unknown, t: TFunction): string {
  const fallback =
    err instanceof Error ? err.message : t("settings.timeline.notifications.unknown");
  const code = err instanceof ApiResponseError ? err.code : undefined;
  const message = translateErrorCode("apiErrors", code, fallback, t);
  // The translated text for a code like HRU_CONNECTION_ERROR is deliberately
  // generic; the cause is what says which register rejected which value.
  const cause =
    err instanceof ApiResponseError ? (err.cause ?? describeDetails(err.details, t)) : undefined;
  return cause && !message.includes(cause) ? `${message} — ${cause}` : message;
}
