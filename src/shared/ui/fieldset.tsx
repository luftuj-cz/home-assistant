import type { ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE, type IconComponent } from "./icon-types";

interface FieldsetProps {
  legend: ReactNode;
  icon?: IconComponent;
  description?: ReactNode;
  /** A button on the right of the description line ("Přidat skript"). */
  action?: ReactNode;
  /** `warning`: an amber well, for a group that needs attention. */
  tone?: "warning";
  className?: string;
  children?: ReactNode;
}

/**
 * A titled group of fields inside a form or dialog, on a muted well; fields inside sit on `card` (Proměnné,
 * Skripty and Klapky in the mode dialog).
 */
export function Fieldset({
  legend,
  icon: Icon,
  description,
  action,
  tone,
  className,
  children,
}: Readonly<FieldsetProps>) {
  return (
    <fieldset
      data-slot="fieldset"
      className={cn(
        "m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border-0 p-4",
        tone === "warning" ? "bg-warning-soft" : "bg-muted",
        // Controls inside a fieldset sit on the card colour, so they stand out from the muted well.
        "[&_[data-slot=input]]:bg-card [&_[data-slot=number-input]]:bg-card [&_[data-slot=toggle-group]]:bg-card [&_[data-slot=select-trigger]]:bg-card [&_[data-slot=time-field]]:bg-card",
        className,
      )}
    >
      <legend className="float-left flex w-full items-center gap-2 p-0 font-sans text-sm leading-5 font-semibold text-foreground">
        {Icon && (
          <Icon size={16} stroke={ICON_STROKE} className="text-muted-foreground" aria-hidden />
        )}
        <span>{legend}</span>
      </legend>
      {(description || action) && (
        <div className="-mt-1.5 flex items-center justify-between gap-3 [clear:both]">
          {description && <p className="caption text-muted-foreground">{description}</p>}
          {action}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 [clear:both]">{children}</div>
    </fieldset>
  );
}
