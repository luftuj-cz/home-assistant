import { IconAlertTriangle, IconCheck, IconPlugConnected } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";
import { ICON_STROKE } from "./icon-types";
import { Legend } from "./legend";
import { StatStrip, type StatItem } from "./stat-strip";

export type ConnectionTestState = "idle" | "testing" | "success" | "error";

interface Outcome {
  state: "success" | "error";
  error?: ReactNode;
  code?: string;
  values?: StatItem[];
}

function sameOutcome(a: Outcome, b: Outcome | null) {
  return (
    b !== null &&
    a.state === b.state &&
    a.error === b.error &&
    a.code === b.code &&
    a.values === b.values
  );
}

interface ConnectionTestProps {
  state: ConnectionTestState;
  onTest: () => void;
  label?: string;
  /** Mono detail after success: latency, broker address. Hidden on a phone. */
  detail?: ReactNode;
  /** The translated error sentence. Hidden on a phone, with the code. */
  error?: ReactNode;
  /** The raw error code. */
  code?: string;
  /** Shown while idle, or next to a disabled button to say why. */
  hint?: ReactNode;
  /** After success: values read through the connection, as a StatStrip. */
  values?: StatItem[];
  valuesLegend?: ReactNode;
  disabled?: boolean;
  /** Something sharing the row before the button, e.g. the Save button. */
  leading?: ReactNode;
  className?: string;
}

/**
 * Tests a connection and shows the outcome in place, next to the button: spinner, then "Připojení úspěšné" with a
 * detail (and optionally the values read), or "Připojení selhalo" with the sentence and code in a red well.
 *
 * A repeated test keeps the previous outcome in place, dimmed, until the new one arrives, and the button keeps its
 * width: nothing below it collapses and grows back, so a page scrolled to the bottom does not jump.
 */
export function ConnectionTest({
  state,
  onTest,
  label,
  detail,
  error,
  code,
  hint,
  values,
  valuesLegend,
  disabled,
  leading,
  className,
}: Readonly<ConnectionTestProps>) {
  const { t } = useTranslation();
  const testing = state === "testing";
  const settled = state === "success" || state === "error" ? { state, error, code, values } : null;
  // The last outcome, shown dimmed while the next test runs (the mutation clears its error meanwhile).
  const [last, setLast] = useState(settled);
  if (settled && !sameOutcome(settled, last)) setLast(settled);
  if (state === "idle" && last) setLast(null);
  const shown = testing ? last : settled;
  const idleLabel = label ?? t("ui.connectionTest.label");

  return (
    <div
      data-slot="connection-test"
      data-state={state}
      className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3", className)}
    >
      <div className="flex flex-wrap items-center gap-3">
        {leading}
        <Button
          variant="secondary"
          icon={IconPlugConnected}
          loading={testing}
          disabled={disabled}
          onClick={onTest}
        >
          <span className="grid *:col-start-1 *:row-start-1">
            <span className={cn(testing && "invisible")}>{idleLabel}</span>
            <span className={cn(!testing && "invisible")}>{t("ui.connectionTest.testing")}</span>
          </span>
        </Button>
        {shown?.state === "success" && (
          <span
            role="status"
            className={cn(
              "inline-flex animate-fade items-center gap-2 text-sm leading-5 font-medium text-success transition-opacity",
              testing && "opacity-45",
            )}
          >
            <IconCheck size={16} stroke={ICON_STROKE} aria-hidden />
            {t("ui.connectionTest.success")}
            {/* On a phone the address would wrap under the button; the success alone says enough. */}
            {detail && (
              <span className="code font-normal text-muted-foreground max-[560px]:hidden">
                {detail}
              </span>
            )}
          </span>
        )}
        {shown?.state === "error" && (
          <span
            role={testing ? undefined : "alert"}
            className={cn(
              "inline-flex animate-fade items-center gap-2 text-sm leading-5 font-medium text-destructive transition-opacity",
              testing && "opacity-45",
            )}
          >
            <IconAlertTriangle size={16} stroke={ICON_STROKE} aria-hidden />
            {t("ui.connectionTest.failed")}
          </span>
        )}
        {(state === "idle" || disabled) && hint && (
          <span className="caption text-muted-foreground">{hint}</span>
        )}
      </div>
      {shown?.state === "error" && (shown.error || shown.code) && (
        <div
          className={cn(
            // On a phone "Připojení selhalo" alone, like the success without its address.
            "grid animate-fade gap-1 rounded-md bg-destructive-soft px-3.5 py-2.5 transition-opacity max-[560px]:hidden",
            testing && "opacity-45",
          )}
        >
          {shown.error && <p className="body m-0">{shown.error}</p>}
          {shown.code && <code className="code text-destructive">{shown.code}</code>}
        </div>
      )}
      {shown?.state === "success" && shown.values && shown.values.length > 0 && (
        <div
          className={cn(
            "grid animate-rise gap-2 transition-opacity [&_[data-slot=stat-strip]]:bg-muted [&_[data-slot=stat-strip]]:shadow-none",
            testing && "opacity-45",
          )}
        >
          {valuesLegend && <Legend>{valuesLegend}</Legend>}
          <StatStrip items={shown.values} />
        </div>
      )}
    </div>
  );
}
