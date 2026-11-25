import { useCallback, useState } from "react";

const STORAGE_KEY = "luftator-valve-groups-collapsed";

function load(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function save(keys: string[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Private mode or blocked storage: the groups just open expanded next time.
  }
}

/** Which valve groups are collapsed, remembered in this browser only. Keys: the group id, or "ungrouped". */
export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<string[]>(load);

  const setGroupCollapsed = useCallback((key: string, value: boolean) => {
    setCollapsed((current) => {
      const next = value
        ? [...new Set([...current, key])]
        : current.filter((existing) => existing !== key);
      save(next);
      return next;
    });
  }, []);

  return {
    isCollapsed: (key: string) => collapsed.includes(key),
    setGroupCollapsed,
  };
}
