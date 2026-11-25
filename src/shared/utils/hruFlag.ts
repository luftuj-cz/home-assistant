import type { TFunction } from "i18next";

/**
 * A unit flag as a word, the same everywhere it is shown: negative flags (a fault, a filter to change) read Ano/Ne,
 * the others (bypass, heating) Zap./Vyp.
 */
export function flagWord(active: boolean, negative: boolean, t: TFunction): string {
  if (negative) return active ? t("dashboard.unitPanel.yes") : t("dashboard.unitPanel.no");
  return active ? t("dashboard.unitPanel.on") : t("dashboard.unitPanel.off");
}
