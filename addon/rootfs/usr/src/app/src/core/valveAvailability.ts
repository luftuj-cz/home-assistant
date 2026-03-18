import type { ValveSnapshot } from "./valveManager.js";

export function isValveAvailable(snapshot: ValveSnapshot): boolean {
  const rawState = String(snapshot.state ?? "").trim().toLowerCase();
  const attrs = snapshot.attributes ?? {};
  const attributeAvailable = attrs.available;

  if (attrs.restored === true) {
    return false;
  }

  if (attributeAvailable === false) {
    return false;
  }

  if (rawState === "unavailable" || rawState === "unknown" || rawState === "offline") {
    return false;
  }

  return Number.isFinite(Number(snapshot.state));
}
