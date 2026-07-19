import type { TFunction } from "i18next";

/**
 * Looks up `${keyPrefix}.${code}` in the translation table, returning `fallback`
 * when there's no code or no translation exists for it. Shared by
 * translateApiError (apiError.ts) and translateConnectionError
 * (connectionError.ts) so the two error-translation call sites don't drift.
 */
export function translateErrorCode(
  keyPrefix: string,
  code: string | null | undefined,
  fallback: string,
  t: TFunction,
): string {
  if (code) {
    const translated = t(`${keyPrefix}.${code}`, { defaultValue: "" });
    if (translated) return translated;
  }
  return fallback;
}
