import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@luftuj/shared/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";
import { Field } from "@luftuj/shared/ui/field";
import { Input } from "@luftuj/shared/ui/input";

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legend?: string;
  title: string;
  label: string;
  /** The current name. */
  defaultValue: string;
  /** Where a default name exists: adds "Obnovit výchozí název" on the left while the name differs from it. */
  defaultName?: string;
  /** `null` restores the default name. */
  onSave: (name: string | null) => void;
  busy?: boolean;
}

/** A small rename dialog; Enter saves. Used for seasons (custom plans rename in their row). */
export function RenameDialog({
  open,
  onOpenChange,
  legend,
  title,
  label,
  defaultValue,
  defaultName,
  onSave,
  busy,
}: Readonly<RenameDialogProps>) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  // Each opening starts from the current name. (Not onOpenAutoFocus: Radix skips it when autoFocus got there first.)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(defaultValue);
  }
  const trimmed = value.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader legend={legend} title={title} />
        <DialogBody>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed) onSave(trimmed);
            }}
          >
            <Field label={label}>
              <Input
                value={value}
                maxLength={60}
                autoFocus
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter
          start={
            defaultName !== undefined &&
            defaultValue !== defaultName && (
              <Button variant="ghost" disabled={busy} onClick={() => onSave(null)}>
                {t("settings.seasons.restoreName")}
              </Button>
            )
          }
        >
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("ui.cancel")}
          </Button>
          <Button loading={busy} disabled={!trimmed} onClick={() => onSave(trimmed)}>
            {t("settings.customTimelines.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
