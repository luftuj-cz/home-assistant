import type { TFunction } from "i18next";

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
  if (err instanceof ApiResponseError && err.code) {
    const key = `apiErrors.${err.code}`;
    const translated = t(key, { defaultValue: "" });
    if (translated) return translated;
  }
  if (err instanceof Error) return err.message;
  return t("settings.timeline.notifications.unknown");
}
