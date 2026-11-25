import { IconCheck } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@luftuj/shared/ui/button";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { cn } from "@luftuj/shared/utils/cn";

interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  onSave: () => Promise<boolean> | boolean | void;
  onDiscard: () => void;
  label?: string;
  /** Blocks saving (invalid form) without hiding the bar. */
  disabled?: boolean;
}

/**
 * The bottom of a settings form. Its 52px slot is always reserved so the first change pushes nothing; once
 * something changes it rises and sticks to the bottom of the viewport with "Neuložené změny", Zahodit and Uložit,
 * and after saving says "✓ Uloženo" for two seconds.
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  label,
  disabled,
}: Readonly<SaveBarProps>) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function save() {
    const result = await onSave();
    if (result === false) return;
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  }

  const shown = dirty || saved;
  return (
    <div
      role="status"
      data-slot="save-bar"
      className={cn(
        "sticky bottom-3 z-5 flex min-h-13 items-center justify-end gap-2 max-md:bottom-[104px]",
        !shown && "pointer-events-none",
        shown &&
          "animate-rise rounded-lg bg-popover py-2 pr-2 pl-4 shadow-[var(--shadow-float),0_0_0_1px_var(--border)]",
      )}
    >
      {dirty && (
        <>
          <span className="mr-auto inline-flex items-center gap-2 text-sm leading-5 font-medium">
            <i className="size-2 rounded-full bg-warning" />
            {t("settings.unsavedChanges")}
          </span>
          <Button variant="ghost" size="sm" disabled={saving} onClick={onDiscard}>
            {t("settings.discard")}
          </Button>
          <Button size="sm" loading={saving} disabled={disabled} onClick={() => void save()}>
            {label ?? t("settings.save")}
          </Button>
        </>
      )}
      {!dirty && saved && (
        <span className="mr-auto inline-flex items-center gap-2 text-sm leading-5 font-medium text-success">
          <IconCheck size={16} stroke={ICON_STROKE} aria-hidden />
          {t("settings.saved")}
        </span>
      )}
    </div>
  );
}
