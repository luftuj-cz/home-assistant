import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Mode } from "@luftuj/shared/types/timeline";
import { Alert } from "@luftuj/shared/ui/alert";
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
import { Legend } from "@luftuj/shared/ui/legend";

interface FillWeekDialogProps {
  open: boolean;
  /** The custom plan, as the legend. */
  planName: string;
  /** Only modes usable on a custom timeline: configured in every enabled season. */
  modes: Mode[];
  existingEvents: number;
  saving: boolean;
  onClose: () => void;
  onConfirm: (modeId: number) => void;
}

/**
 * Vyplnit celý týden jedním módem (replaces FillWeekModal). Once a mode is picked, seven days filled in its colour
 * preview the result; existing events are named as replaced.
 */
export function FillWeekDialog({
  open,
  planName,
  modes,
  existingEvents,
  saving,
  onClose,
  onConfirm,
}: Readonly<FillWeekDialogProps>) {
  const { t, i18n } = useTranslation();
  const [modeId, setModeId] = useState<string | null>(null);
  const picked = modes.find((mode) => String(mode.id) === modeId);
  const weekdays = Array.from({ length: 7 }, (_, day) =>
    // 2024-01-01 was a Monday.
    new Date(2024, 0, 1 + day).toLocaleDateString(i18n.language, { weekday: "short" }),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Each opening starts with no mode picked. */}
      <DialogContent size="sm" onOpenAutoFocus={() => setModeId(null)}>
        <DialogHeader legend={planName} title={t("settings.customTimelines.fillTitle")} />
        <DialogBody>
          <p className="body">{t("settings.customTimelines.fillBody")}</p>
          <Field label={t("settings.customTimelines.fillMode")}>
            <Combobox
              options={modes.map((mode) => ({
                value: String(mode.id),
                label: mode.name,
                dot: mode.color ?? "var(--mode-8)",
              }))}
              value={modeId}
              onValueChange={setModeId}
              placeholder={t("schedule.modeSelect")}
            />
          </Field>
          {picked && (
            <div aria-hidden="true" className="grid animate-fade grid-cols-7 gap-1.5">
              {weekdays.map((day) => (
                <span key={day} className="grid justify-items-center gap-1">
                  <Legend>{day}</Legend>
                  <i
                    className="block h-6 w-full rounded-sm"
                    style={{ background: picked.color ?? "var(--mode-8)" }}
                  />
                </span>
              ))}
            </div>
          )}
          {existingEvents > 0 && (
            <Alert variant="warning">
              {t("settings.customTimelines.fillReplaces", { count: existingEvents })}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button
            loading={saving}
            disabled={!picked}
            onClick={() => picked && onConfirm(picked.id)}
          >
            {t("settings.customTimelines.fillConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
