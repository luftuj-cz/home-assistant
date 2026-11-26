import { IconAlertTriangle, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { AUTOMATIC_MODE_REFERENCE, modeNumber } from "@luftuj/features/timeline/utils";
import type { Mode, TimelineEvent } from "@luftuj/shared/types/timeline";
import { Button } from "@luftuj/shared/ui/button";
import { Combobox } from "@luftuj/shared/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";
import { Field } from "@luftuj/shared/ui/field";
import { TimeField } from "@luftuj/shared/ui/time-field";

interface EventDialogProps {
  open: boolean;
  event: TimelineEvent | null;
  /** The day it belongs to, as the legend ("Pondělí", or "Všechny dny"). */
  dayLabel: string;
  modes: Mode[];
  powerUnit: string;
  saving: boolean;
  onChange: (event: TimelineEvent) => void;
  onSave: () => void;
  onClose: () => void;
  /** Adds Smazat on the left, for an event that exists. */
  onDelete?: () => void;
  /** Offer the built-in Automatika (season schedules and custom timelines). */
  allowAutomatic?: boolean;
}

/**
 * Událost časové osy (replaces TimelineEventModal): start time and mode. Arrow keys step the minutes by 15; any
 * minute can be typed. With no modes the picker is off and says to create one first.
 */
export function EventDialog({
  open,
  event,
  dayLabel,
  modes,
  powerUnit,
  saving,
  onChange,
  onSave,
  onClose,
  onDelete,
  allowAutomatic = false,
}: Readonly<EventDialogProps>) {
  const { t } = useTranslation();
  const noModes = modes.length === 0 && !allowAutomatic;
  const mode = event?.hruConfig?.mode;
  const automatic = allowAutomatic
    ? [
        {
          value: AUTOMATIC_MODE_REFERENCE,
          label: t("automatic.title"),
          description: t("automatic.eventHint"),
          dot: "var(--air)",
        },
      ]
    : [];
  const options = modes.map((candidate) => {
    const power = modeNumber(candidate, "power");
    return {
      value: String(candidate.id),
      label: candidate.name,
      dot: candidate.color ?? "var(--mode-8)",
      meta: power == null ? undefined : `${power} ${powerUnit}`,
    };
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <DialogHeader legend={dayLabel} title={t("settings.timeline.modal.title")} />
        {event && (
          <DialogBody>
            <Field label={t("settings.timeline.form.startTime")} required>
              <TimeField
                value={event.startTime}
                step={15}
                onValueChange={(startTime) => onChange({ ...event, startTime })}
              />
            </Field>
            <Field
              label={t("schedule.modeLabel")}
              required
              description={noModes ? t("settings.timeline.noModesCreatedDescription") : undefined}
            >
              <Combobox
                options={[...automatic, ...options]}
                value={mode == null ? null : String(mode)}
                onValueChange={(value) => {
                  if (value) onChange({ ...event, hruConfig: { ...event.hruConfig, mode: value } });
                }}
                placeholder={
                  noModes ? t("settings.timeline.noModesCreated") : t("schedule.modeSelect")
                }
                icon={noModes ? IconAlertTriangle : undefined}
                disabled={noModes}
                searchable
              />
            </Field>
          </DialogBody>
        )}
        <DialogFooter
          start={
            onDelete && (
              <Button variant="danger-ghost" icon={IconTrash} onClick={onDelete}>
                {t("settings.timeline.delete")}
              </Button>
            )
          }
        >
          <Button variant="ghost" onClick={onClose}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button loading={saving} disabled={!mode} onClick={onSave}>
            {t("settings.timeline.modal.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
