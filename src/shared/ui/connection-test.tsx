import { IconAlertTriangle, IconCheck, IconPlugConnected } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";
import { ICON_STROKE } from "./icon-types";
import { Legend } from "./legend";
import { StatStrip, type StatItem } from "./stat-strip";

export type ConnectionTestState = "idle" | "testing" | "success" | "error";

interface ConnectionTestProps {
  state: ConnectionTestState;
  onTest: () => void;
  label?: string;
  /** Mono detail after success: latency, broker address. */
  detail?: ReactNode;
  /** The translated error sentence. */
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
          {testing ? t("ui.connectionTest.testing") : (label ?? t("ui.connectionTest.label"))}
        </Button>
        {state === "success" && (
          <span
            role="status"
            className="inline-flex animate-fade items-center gap-2 text-sm leading-5 font-medium text-success"
          >
            <IconCheck size={16} stroke={ICON_STROKE} aria-hidden />
            {t("ui.connectionTest.success")}
            {detail && <span className="code font-normal text-muted-foreground">{detail}</span>}
          </span>
        )}
        {state === "error" && (
          <span
            role="alert"
            className="inline-flex animate-fade items-center gap-2 text-sm leading-5 font-medium text-destructive"
          >
            <IconAlertTriangle size={16} stroke={ICON_STROKE} aria-hidden />
            {t("ui.connectionTest.failed")}
          </span>
        )}
        {(state === "idle" || disabled) && hint && (
          <span className="caption text-muted-foreground">{hint}</span>
        )}
      </div>
      {state === "error" && (error || code) && (
        <div className="grid animate-fade gap-1 rounded-md bg-destructive-soft px-3.5 py-2.5">
          {error && <p className="body m-0">{error}</p>}
          {code && <code className="code text-destructive">{code}</code>}
        </div>
      )}
      {state === "success" && values && values.length > 0 && (
        <div className="grid animate-rise gap-2 [&_[data-slot=stat-strip]]:bg-muted [&_[data-slot=stat-strip]]:shadow-none">
          {valuesLegend && <Legend>{valuesLegend}</Legend>}
          <StatStrip items={values} />
        </div>
      )}
    </div>
  );
}
