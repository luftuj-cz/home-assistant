import { useCallback, useSyncExternalStore } from "react";

/** Whether a media query matches, kept in sync with the window. Prefer a container query where layout allows. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = globalThis.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia(query).matches,
    () => false,
  );
}
