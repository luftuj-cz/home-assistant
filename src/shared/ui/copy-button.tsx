import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { writeTextToClipboard } from "@luftuj/shared/utils/clipboard";
import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";

interface CopyButtonProps {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Show the label next to the icon instead of only as a tooltip / accessible name. */
  withText?: boolean;
  className?: string;
}

/** Copies a value; the icon turns into a check and the label into "Zkopírováno" for 1.4 s. */
export function CopyButton({
  value,
  label,
  copiedLabel,
  withText,
  className,
}: Readonly<CopyButtonProps>) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await writeTextToClipboard(value);
    } catch {
      return;
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1400);
  }

  const text = done ? (copiedLabel ?? t("ui.copied")) : (label ?? t("ui.copy"));
  const Icon = done ? IconCheck : IconCopy;

  return (
    <Button
      variant="ghost"
      size={withText ? "sm" : "icon-sm"}
      icon={Icon}
      aria-label={withText ? undefined : text}
      title={withText ? undefined : text}
      onClick={() => void copy()}
      className={cn(done && "text-success hover:not-disabled:text-success", className)}
    >
      {withText && text}
    </Button>
  );
}
