import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AnimatedNumber } from "@luftuj/shared/ui/animated-number";
import { Card, CardHeader } from "@luftuj/shared/ui/card";
import { ICON_STROKE, type IconComponent } from "@luftuj/shared/ui/icon-types";
import { Legend } from "@luftuj/shared/ui/legend";
import { StatusBadge, type Status } from "@luftuj/shared/ui/status-badge";
import { cn } from "@luftuj/shared/utils/cn";

export interface ConnectionItem {
  name: string;
  description: ReactNode;
  icon?: IconComponent;
  /** An official mark (image URL) shown instead of the icon. */
  mark?: string;
  status: Status;
  label: ReactNode;
  /** The reconnect attempt in progress (failed attempts + 1). */
  attempts?: number;
  /** The translated error, as a sentence. */
  error?: ReactNode;
  /** The raw code, with the address if known. */
  errorCode?: string;
  /** "před 8 s". */
  errorAge?: string;
  /** One short button, e.g. "Otevřít nastavení MQTT". */
  action?: ReactNode;
}

/** One tick per failed attempt (the last ten, "…" before them), plus a pulsing tick for the attempt in progress. */
function AttemptTicks({ failed, max = 10 }: Readonly<{ failed: number; max?: number }>) {
  const shown = Math.min(failed, max);
  return (
    <span aria-hidden="true" className="inline-flex h-4 items-center gap-[3px]">
      {failed > max && (
        <span className="mr-px font-mono text-[11px] leading-3 font-medium text-warning">…</span>
      )}
      {Array.from({ length: shown }, (_, i) => (
        <i
          key={failed - shown + i}
          className="block h-3 w-[3px] origin-bottom animate-tick-in rounded-[2px] bg-warning opacity-45"
        />
      ))}
      <i className="block h-4 w-[3px] animate-attempt rounded-[2px] bg-warning motion-reduce:animate-none" />
    </span>
  );
}

/**
 * Home Assistant, Modbus TCP and MQTT in one plane (replaces the three StatusCards). A connection in trouble opens a
 * well under its row: reconnecting says which attempt is running and the last error; down says why, with an
 * optional fix. The row order stays stable; the summary pill draws the eye.
 */
export function ConnectionList({ items }: Readonly<{ items: ConnectionItem[] }>) {
  const { t } = useTranslation();
  const troubled = items.filter(
    (item) => item.status === "warning" || item.status === "error",
  ).length;
  const down = items.some((item) => item.status === "error");

  return (
    <Card>
      <CardHeader
        legend={t("dashboard.connections.legend")}
        title={t("dashboard.connections.title")}
        action={
          <span
            className={cn(
              "inline-flex h-7 items-center rounded-full px-3 font-sans text-xs leading-4 font-medium whitespace-nowrap",
              troubled === 0 && "bg-success-soft text-success",
              troubled > 0 && !down && "bg-warning-soft text-warning",
              down && "bg-destructive-soft text-destructive",
            )}
          >
            {troubled === 0
              ? t("dashboard.connections.allOk")
              : t("dashboard.connections.issues", { count: troubled })}
          </span>
        }
      />
      <ul className="m-0 grid list-none p-0">
        {items.map((item) => {
          const retrying = item.attempts !== undefined;
          const issue = retrying || item.error !== undefined;
          // A retry can run before any error was recorded; then there is no reason to show.
          const detail = item.error !== undefined || item.errorCode !== undefined;
          const tone = item.status === "error" ? "destructive" : "warning";
          const Icon = item.icon;
          return (
            <li
              key={item.name}
              className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0"
            >
              <div className="flex items-center gap-3 @max-[380px]:flex-wrap">
                <span
                  className={cn(
                    "grid size-9 flex-none place-items-center rounded-md bg-muted text-muted-foreground transition-colors duration-(--duration-base)",
                    !item.mark && issue && tone === "warning" && "bg-warning-soft text-warning",
                    !item.mark &&
                      issue &&
                      tone === "destructive" &&
                      "bg-destructive-soft text-destructive",
                  )}
                >
                  {item.mark ? (
                    <img
                      src={item.mark}
                      alt=""
                      width={36}
                      height={36}
                      className="size-9 rounded-md"
                    />
                  ) : (
                    Icon && <Icon size={20} stroke={ICON_STROKE} aria-hidden />
                  )}
                </span>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="label">{item.name}</p>
                  <p className="caption text-muted-foreground">{item.description}</p>
                </div>
                <StatusBadge
                  status={item.status}
                  label={item.label}
                  className="@max-[380px]:w-full @max-[380px]:pl-12"
                />
              </div>
              {issue && (
                <div
                  role={item.status === "error" ? "alert" : "status"}
                  className={cn(
                    "grid animate-rise items-stretch gap-x-5 gap-y-3 rounded-lg px-4 py-3.5",
                    tone === "warning" ? "bg-warning-soft" : "bg-destructive-soft",
                    // The fix action is a tall button beside the reason; on narrow cards it drops under it.
                    retrying && detail && item.action && "grid-cols-[auto_minmax(0,1fr)_116px]",
                    retrying && detail && !item.action && "grid-cols-[auto_minmax(0,1fr)]",
                    retrying && !detail && item.action && "grid-cols-[minmax(0,1fr)_116px]",
                    retrying && !detail && !item.action && "grid-cols-[minmax(0,1fr)]",
                    !retrying && item.action && "grid-cols-[minmax(0,1fr)_116px]",
                    !retrying && !item.action && "grid-cols-[minmax(0,1fr)]",
                    "@max-[340px]:grid-cols-[minmax(0,1fr)]",
                  )}
                >
                  {retrying && (
                    <div className="grid content-start gap-1">
                      <Legend className={tone === "warning" ? "text-warning" : "text-destructive"}>
                        {t("dashboard.connections.attempt")}
                      </Legend>
                      <span className="flex items-center gap-2.5">
                        <AnimatedNumber
                          value={item.attempts ?? 1}
                          className="readout min-w-[1ch] text-[30px] leading-8"
                        />
                        <AttemptTicks failed={Math.max(0, (item.attempts ?? 1) - 1)} />
                      </span>
                    </div>
                  )}
                  {detail && (
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1">
                      <Legend className={tone === "warning" ? "text-warning" : "text-destructive"}>
                        {retrying
                          ? t("dashboard.connections.lastError")
                          : t("dashboard.connections.reason")}
                        {item.errorAge && (
                          <span className="tracking-normal normal-case"> · {item.errorAge}</span>
                        )}
                      </Legend>
                      {item.error && <p className="body">{item.error}</p>}
                      {item.errorCode && (
                        <code className="code justify-self-start rounded-sm bg-card px-2 py-0.5 text-muted-foreground [overflow-wrap:anywhere]">
                          {item.errorCode}
                        </code>
                      )}
                    </div>
                  )}
                  {item.action && (
                    <div className="flex [&>[data-slot=button]]:h-auto [&>[data-slot=button]]:min-h-[72px] [&>[data-slot=button]]:flex-1 [&>[data-slot=button]]:flex-col [&>[data-slot=button]]:gap-1.5 [&>[data-slot=button]]:px-2 [&>[data-slot=button]]:py-2.5 [&>[data-slot=button]]:text-center [&>[data-slot=button]]:text-[13px] [&>[data-slot=button]]:leading-[17px] [&>[data-slot=button]]:whitespace-normal @max-[340px]:[&>[data-slot=button]]:min-h-11 @max-[340px]:[&>[data-slot=button]]:flex-row">
                      {item.action}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
