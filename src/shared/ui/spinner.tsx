import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

interface SpinnerProps {
  size?: number;
  /** Shown next to the spinner. Give one for any wait longer than a second. */
  label?: ReactNode;
  className?: string;
}

/** Indeterminate wait. Keeps turning under reduced motion, because it is information, not decoration. */
export function Spinner({ size = 20, label, className }: Readonly<SpinnerProps>) {
  const { t } = useTranslation();
  return (
    <span
      data-slot="spinner"
      role="status"
      className={cn("inline-flex items-center gap-2 text-air", className)}
    >
      <svg
        className="animate-spin"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".18" strokeWidth="2" />
        <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label ? (
        <span className="body text-muted-foreground">{label}</span>
      ) : (
        <span className="sr-only">{t("ui.loading")}</span>
      )}
    </span>
  );
}
