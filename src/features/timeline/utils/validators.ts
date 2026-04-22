import type { TimelineEvent } from "../../../types/timeline";
import type { TFunction } from "i18next";

export function validateEvent(event: TimelineEvent, t: TFunction): string | null {
  if (!event.hruConfig?.mode) {
    return t("validation.modeRequired");
  }
  return null;
}
