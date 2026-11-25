import { IconCheck, IconX } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Spinner } from "@luftuj/shared/ui/spinner";
import { cn } from "@luftuj/shared/utils/cn";

export type ChecklistState = "done" | "waiting" | "error";

export interface ChecklistItem {
  label: string;
  detail?: ReactNode;
  state: ChecklistState;
}

interface SetupChecklistProps {
  items: ChecklistItem[];
  /** The hero turns into a green check. */
  done: boolean;
  title: ReactNode;
  description: ReactNode;
  /** Roughly how long the waiting rows still take; null once that time is up. */
  seconds: number | null;
  /** What `seconds` counts down from: the ring fills over it. */
  total?: number;
}

/**
 * The last onboarding step as a live checklist: a ring that fills over the usual wait and turns into a green check,
 * then a row per thing that has to work, done, waiting (pulsing, "~38 s") or failed. Replaces StatusStep's single
 * icon and alert.
 */
export function SetupChecklist({
  items,
  done,
  title,
  description,
  seconds,
  total = 60,
}: Readonly<SetupChecklistProps>) {
  const { t } = useTranslation();
  const progress = seconds === null ? 1 : 1 - seconds / total;

  return (
    <div data-slot="setup-checklist" className="grid gap-5">
      <div className="flex items-center gap-4">
        {done ? (
          <span
            aria-hidden="true"
            className="grid size-16 flex-none animate-pop place-items-center rounded-full bg-success text-white"
          >
            <IconCheck size={28} stroke={ICON_STROKE} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            style={{ "--p": progress } as CSSProperties}
            className={cn(
              "grid size-16 flex-none place-items-center rounded-full text-air transition-[background] duration-1000 ease-linear",
              "bg-[radial-gradient(closest-side,var(--card)_86%,transparent_87%),conic-gradient(var(--air)_calc(var(--p)*360deg),var(--muted)_0)]",
            )}
          >
            <Spinner size={28} />
          </span>
        )}
        <div className="grid min-w-0 gap-1" aria-live="polite">
          <span className="section-title">{title}</span>
          <span className="body text-muted-foreground">{description}</span>
        </div>
      </div>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {items.map((item) => (
          <li
            key={item.label}
            className={cn(
              "flex items-center gap-3 rounded-md bg-muted px-3.5 py-2.5",
              item.state === "waiting" && "bg-air-soft",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-6 flex-none place-items-center rounded-full",
                item.state === "done" && "animate-pop bg-success text-white",
                item.state === "error" && "bg-destructive text-white",
                item.state === "waiting" && "shadow-[inset_0_0_0_2px_var(--air)]",
              )}
            >
              {item.state === "done" && <IconCheck size={14} stroke={ICON_STROKE} />}
              {item.state === "error" && <IconX size={14} stroke={ICON_STROKE} />}
              {item.state === "waiting" && (
                <span className="size-2 animate-blink rounded-full bg-air" />
              )}
            </span>
            <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">
              <span className="label">
                {item.label}
                <span className="sr-only"> ({t(`onboarding.status.state.${item.state}`)})</span>
              </span>
              {item.detail && (
                <span className="caption truncate text-muted-foreground">{item.detail}</span>
              )}
            </span>
            {item.state === "waiting" && seconds !== null && (
              <span className="code flex-none text-muted-foreground">~{seconds} s</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
