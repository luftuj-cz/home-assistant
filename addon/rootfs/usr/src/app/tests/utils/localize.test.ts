import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { normalizeLang, resolveLocaleKey } from "../../src/utils/localize.js";

const DEFINITIONS_DIR = path.join(import.meta.dirname, "../../src/features/hru/definitions/units");

/** Every key a unit definition asks to have translated. */
function translatableKeys(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(DEFINITIONS_DIR).filter((f) => f.endsWith(".json"))) {
    const raw = readFileSync(path.join(DEFINITIONS_DIR, file), "utf8");
    for (const match of raw.matchAll(/"text":\s*"([^"]+)",\s*"translate":\s*true/g)) {
      keys.add(match[1]!);
    }
  }
  return [...keys].sort();
}

describe("resolveLocaleKey", () => {
  it("resolves keys outside hru.modes, which MQTT used to publish raw", () => {
    expect(resolveLocaleKey("cs", "hru.bypassAuto")).toBe("Automaticky");
    expect(resolveLocaleKey("en", "hru.bypassAuto")).toBe("Automatic");
  });

  it("resolves season names, which the MQTT sensor used to show in English", () => {
    expect(resolveLocaleKey("cs", "settings.seasons.names.summer")).toBe("Léto");
    expect(resolveLocaleKey("en", "settings.seasons.names.summer")).toBe("Summer");
  });

  it("translates every key the unit definitions mark as translatable", () => {
    const keys = translatableKeys();
    expect(keys.length).toBeGreaterThan(40);
    for (const lang of ["cs", "en"]) {
      const missing = keys.filter((key) => resolveLocaleKey(lang, key) === undefined);
      expect(missing, `untranslated in ${lang}`).toEqual([]);
    }
  });

  it("misses cleanly so callers can fall back", () => {
    expect(resolveLocaleKey("cs", "hru.thisKeyDoesNotExist")).toBeUndefined();
    expect(resolveLocaleKey("cs", "")).toBeUndefined();
    // A branch, not a leaf: there is no string to show.
    expect(resolveLocaleKey("cs", "hru")).toBeUndefined();
    // Free text from a `translate: false` label must not accidentally resolve.
    expect(resolveLocaleKey("cs", "Mode target")).toBeUndefined();
  });

  it("falls back to English for unknown languages", () => {
    expect(normalizeLang("de")).toBe("en");
    expect(normalizeLang("cs-CZ")).toBe("cs");
    expect(normalizeLang(null)).toBe("en");
    expect(resolveLocaleKey("de", "settings.seasons.names.summer")).toBe("Summer");
  });
});
