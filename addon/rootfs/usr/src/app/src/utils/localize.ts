import enCommon from "../locales/en/common.json" with { type: "json" };
import csCommon from "../locales/cs/common.json" with { type: "json" };

/**
 * Lookup into the locale bundles the build copies from the frontend. One
 * resolver for every string the add-on sends to Home Assistant - having two is
 * what made MQTT publish "hru.bypassAuto" as a literal.
 */

export type LocaleResource = typeof enCommon;

const RESOURCES: Record<string, LocaleResource> = {
  en: enCommon,
  cs: csCommon,
};

export function normalizeLang(lang: string | null | undefined): keyof typeof RESOURCES {
  const base = typeof lang === "string" && lang ? lang.split("-")[0] : "en";
  return base === "cs" ? "cs" : "en";
}

export function getResource(lang: string): LocaleResource | null {
  return RESOURCES[normalizeLang(lang)] ?? null;
}

/**
 * The string a dotted key points at, or undefined on a miss so callers can fall
 * back. A leaf is either a bare string or a `{ text }` object.
 */
export function resolveLocaleKey(lang: string, key: string): string | undefined {
  const resource = getResource(lang) ?? getResource("en");
  if (!resource || !key) return undefined;

  let current: unknown = resource;
  for (const part of key.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === "string") return current;
  if (current && typeof current === "object") {
    const text = (current as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return undefined;
}
