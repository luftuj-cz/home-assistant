import { createContext } from "react";

export type ColorScheme = "light" | "dark";
/** What the user picked: a scheme, or `system` to follow the operating system. */
export type ThemePreference = ColorScheme | "system";

export interface ThemeContextValue {
  /** The scheme in effect (`system` resolved). */
  colorScheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Picks a fixed scheme; same as `setPreference(scheme)`. */
  setColorScheme: (scheme: ColorScheme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
