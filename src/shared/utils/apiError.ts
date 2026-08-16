import type { TFunction } from "i18next";
import { translateErrorCode } from "@luftuj/shared/utils/errorTranslation";

export class ApiResponseError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiResponseError";
    this.code = code;
  }
}

export async function parseApiError(res: Response): Promise<ApiResponseError> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { detail?: string; code?: string };
    return new ApiResponseError(json.detail || text || "Unknown error", json.code);
  } catch {
    return new ApiResponseError(text || "Unknown error");
  }
}

export function translateApiError(err: unknown, t: TFunction): string {
  const fallback =
    err instanceof Error ? err.message : t("settings.timeline.notifications.unknown");
  const code = err instanceof ApiResponseError ? err.code : undefined;
  return translateErrorCode("apiErrors", code, fallback, t);
}
