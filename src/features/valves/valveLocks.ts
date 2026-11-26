import { createContext, useContext } from "react";

/**
 * Valves that automatic control holds right now, by entity id, with the room's name. The Valves page provides it;
 * a held valve cannot be moved by hand (the backend refuses it too), a boost overrides automatic control.
 */
export const ValveLocksContext = createContext<ReadonlyMap<string, string>>(new Map());

export function useValveLock(entityId: string): string | undefined {
  return useContext(ValveLocksContext).get(entityId);
}
