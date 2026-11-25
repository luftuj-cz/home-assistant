import { IconCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE } from "./icon-types";

export interface StepperStep {
  label: string;
  description?: string;
}

interface StepperProps {
  steps: StepperStep[];
  /** Zero-based. */
  current: number;
  /** A segmented bar with "Krok 3 z 6 · Jednotka" instead of the row of steps. */
  compact?: boolean;
  className?: string;
}

/**
 * Onboarding progress. Done steps have an `air` line and a check, the current one an ink line and an ink numbered
 * mark, the rest are muted. Replaces StepIndicator.
 */
export function Stepper({ steps, current, compact, className }: Readonly<StepperProps>) {
  const { t } = useTranslation();

  if (compact) {
    return (
      <div data-slot="stepper" className={cn("grid gap-2", className)}>
        <div className="flex gap-1" aria-hidden="true">
          {steps.map((step, index) => (
            <span
              key={step.label}
              className={cn(
                "h-1 flex-1 rounded-[2px] bg-border transition-[background-color] duration-(--duration-base)",
                index < current && "bg-air",
                index === current && "bg-foreground",
              )}
            />
          ))}
        </div>
        <p className="caption m-0 text-muted-foreground">
          <span className="legend inline">
            {t("onboarding.step", { current: current + 1, total: steps.length })}
          </span>
          {" · "}
          {steps[current]?.label}
        </p>
      </div>
    );
  }

  return (
    <ol
      data-slot="stepper"
      className={cn(
        "m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2 p-0",
        className,
      )}
    >
      {steps.map((step, index) => {
        const done = index < current;
        const isCurrent = index === current;
        return (
          <li
            key={step.label}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "grid gap-3 border-t-2 border-border pt-3 transition-[border-color] duration-(--duration-base)",
              done && "border-air",
              isCurrent && "border-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-8 place-items-center rounded-full bg-muted text-muted-foreground",
                done && "bg-air-soft text-air",
                isCurrent && "bg-primary text-primary-foreground",
              )}
            >
              {done ? (
                <IconCheck size={16} stroke={ICON_STROKE} aria-hidden />
              ) : (
                <span className="code">{String(index + 1).padStart(2, "0")}</span>
              )}
            </span>
            <span className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
              <span className={cn("label", !done && !isCurrent && "text-muted-foreground")}>
                {step.label}
                {done && <span className="sr-only"> ({t("onboarding.stepDone")})</span>}
              </span>
              {step.description && (
                <span className="caption text-muted-foreground">{step.description}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
