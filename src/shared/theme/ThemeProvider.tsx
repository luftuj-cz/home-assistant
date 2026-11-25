import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { createLogger } from "@luftuj/shared/utils/logger";

import { ThemeContext, type ColorScheme, type ThemePreference } from "./themeContext";

const logger = createLogger("ThemeProvider");

// Shared with the inline script in index.html. Holds the preference (light, dark or system).
const STORAGE_KEY = "luftujha-color-scheme";
const SYNCED_KEY = "luftujha-theme-synced";
const DEFAULT_PREFERENCE: ThemePreference = "dark";
const SYSTEM_DARK = "(prefers-color-scheme: dark)";

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredPreference(): ThemePreference {
  try {
    const saved = globalThis.localStorage.getItem(STORAGE_KEY);
    return isPreference(saved) ? saved : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function systemScheme(): ColorScheme {
  return globalThis.matchMedia?.(SYSTEM_DARK).matches ? "dark" : "light";
}

function applyToDocument(scheme: ColorScheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", scheme === "dark");
  root.dataset.theme = scheme;
}

/**
 * The app's single theme switch: light, dark, or following the system. Sets `.dark` and `data-theme` on <html>
 * for the design-system tokens.
 */
export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [system, setSystem] = useState<ColorScheme>(systemScheme);
  const colorScheme = preference === "system" ? system : preference;

  // Follow the operating system while the preference says so.
  useEffect(() => {
    const query = globalThis.matchMedia?.(SYSTEM_DARK);
    if (!query) return;
    function handleChange() {
      setSystem(systemScheme());
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    applyToDocument(colorScheme);
  }, [colorScheme]);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Storage unavailable (private mode); the scheme still applies for this session.
    }
  }, [preference]);

  // Another tab changed the theme.
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY && isPreference(event.newValue)) {
        setPreferenceState(event.newValue);
      }
    }
    globalThis.addEventListener("storage", handleStorage);
    return () => globalThis.removeEventListener("storage", handleStorage);
  }, []);

  // Adopt the theme saved on the backend, once per session so a later local change is not overwritten.
  useEffect(() => {
    let active = true;

    if (sessionStorage.getItem(SYNCED_KEY)) {
      return;
    }

    async function synchroniseTheme() {
      try {
        const response = await fetch(resolveApiUrl("/api/settings/theme"));
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { theme?: string };
        if (!active) {
          return;
        }
        if (isPreference(data.theme)) {
          setPreferenceState(data.theme);
          sessionStorage.setItem(SYNCED_KEY, "true");
        }
      } catch (error) {
        logger.error("Failed to load persisted theme", { error });
      }
    }

    void synchroniseTheme();

    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ colorScheme, preference, setPreference, setColorScheme: setPreference }),
    [colorScheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
