import { IconPlayerPause, IconPlayerPlay, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { activateBoost, cancelBoost, fetchActiveBoost } from "@luftuj/features/timeline/api";
import type { Mode } from "@luftuj/shared/types/timeline";
import { Button } from "@luftuj/shared/ui/button";
import { Card, CardHeader } from "@luftuj/shared/ui/card";
import { Dot } from "@luftuj/shared/ui/dot";
import { FitText } from "@luftuj/shared/ui/fit-text";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Legend } from "@luftuj/shared/ui/legend";
import { notify } from "@luftuj/shared/ui/notify";
import { Progress } from "@luftuj/shared/ui/progress";
import { Spinner } from "@luftuj/shared/ui/spinner";
import { Well } from "@luftuj/shared/ui/well";
import { useTemperature } from "@luftuj/shared/temperature/useTemperature";
import { translateApiError } from "@luftuj/shared/utils/apiError";
import { cn } from "@luftuj/shared/utils/cn";
import { createLogger } from "@luftuj/shared/utils/logger";

import { DurationPicker } from "./DurationPicker";

const logger = createLogger("ManualModeCard");

/** What the backend stores for "until cancelled". */
const INFINITE_MINUTES = 999_999;

interface ActiveBoost {
  modeId: number;
  endTime: string;
  durationMinutes: number;
}

/** "24:12", or "1:24:12" for an hour or more. */
function formatCountdown(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** Remaining time of the running boost, updated every second. */
function useCountdown(active: ActiveBoost | null, onExpired: () => void) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // The clock idles while nothing runs, so read it right away instead of a second late.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active]);
  // Never more than the duration, even for the one frame before the clock is read.
  const remainingMs = active
    ? Math.min(new Date(active.endTime).getTime() - now, active.durationMinutes * 60_000)
    : 0;
  useEffect(() => {
    if (active && active.durationMinutes !== INFINITE_MINUTES && remainingMs <= 0) onExpired();
  }, [active, remainingMs, onExpired]);
  return remainingMs;
}

/** A mode's power or temperature: the unit variable when set, else the legacy field. */
function modeNumber(mode: Mode, key: "power" | "temperature") {
  const value = mode.variables?.[key];
  return typeof value === "number" ? value : mode[key];
}

interface ManualModeCardProps {
  /** All modes; the ones marked as a manual action (isBoost) become tiles. */
  modes: Mode[];
  unitId?: string;
}

/**
 * "Manuální režim" (replaces BoostButtons): pick a duration, then tap a mode tile; the tap starts it. While a mode is
 * being set on the unit, its tile shows it (manual-soft with a spinner and a running bar) and everything else locks;
 * nothing above the tiles appears or disappears. Running: a manual ring on the plane, the tile filled, a countdown.
 * Hidden when no mode is marked as a manual action.
 */
export function ManualModeCard({ modes, unitId }: Readonly<ManualModeCardProps>) {
  const { t } = useTranslation();
  const temperatureUnit = useTemperature();
  const boostModes = modes.filter((mode) => mode.isBoost);
  const [duration, setDuration] = useState(30);
  const [active, setActive] = useState<ActiveBoost | null>(null);
  const [activating, setActivating] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setActive(await fetchActiveBoost());
    } catch (error) {
      logger.error("Failed to fetch active boost", { error });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const expire = useCallback(() => setActive(null), []);
  const remainingMs = useCountdown(active, expire);

  async function activate(modeId: number) {
    const minutes = Number.isFinite(duration) ? duration : INFINITE_MINUTES;
    setActivating(modeId);
    logger.info("Activating boost mode", { modeId, minutes, unitId });
    try {
      setActive(await activateBoost(modeId, minutes, unitId));
      notify({
        variant: "success",
        title: t("dashboard.boostTitle"),
        message: Number.isFinite(duration)
          ? t("dashboard.boostActive", { minutes })
          : t("dashboard.duration.runsUntilCancelled"),
      });
    } catch (error) {
      logger.error("Failed to activate boost mode", { modeId, error });
      notify({
        variant: "error",
        title: t("valves.alertTitle"),
        message: translateApiError(error, t),
      });
    } finally {
      setActivating(null);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      await cancelBoost();
      setActive(null);
    } catch (error) {
      logger.error("Failed to cancel boost mode", { error });
      notify({
        variant: "error",
        title: t("valves.alertTitle"),
        message: translateApiError(error, t),
      });
    } finally {
      setCancelling(false);
    }
  }

  if (boostModes.length === 0) {
    return null;
  }

  const running = active !== null;
  const busy = activating !== null;
  const runningMode = boostModes.find((mode) => mode.id === active?.modeId);
  const infinite = active?.durationMinutes === INFINITE_MINUTES;
  const progress =
    active && !infinite ? (remainingMs / (active.durationMinutes * 60_000)) * 100 : 100;

  return (
    <Card tone={running ? "manual" : undefined}>
      <CardHeader
        // The countdown's Zrušit wraps under a short title sooner here, as in the design.
        className="[&>[data-slot=card-titles]]:basis-[200px]"
        legend={running ? t("dashboard.boostTitle") : undefined}
        title={
          running ? (runningMode?.name ?? t("dashboard.boostTitle")) : t("dashboard.boostTitle")
        }
        description={
          running ? t("dashboard.manual.runningDescription") : t("dashboard.boostDescription")
        }
        action={
          running ? (
            <Button
              variant="outline"
              size="sm"
              icon={IconX}
              loading={cancelling}
              onClick={() => void cancel()}
            >
              {t("dashboard.boostCancel")}
            </Button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-[minmax(280px,380px)_1fr] items-stretch gap-4 @max-[640px]:grid-cols-[minmax(0,1fr)]">
        {running ? (
          <Well legend={t("dashboard.boostTimeRemaining")} className="content-between gap-4 p-5">
            <div className="flex min-h-16 items-baseline gap-2">
              <span className="readout-xl text-manual">
                {infinite ? "∞" : formatCountdown(remainingMs)}
              </span>
              <span className="code text-muted-foreground">
                {infinite ? t("dashboard.duration.untilCancelledUnit") : "mm:ss"}
              </span>
            </div>
            <Progress
              value={progress}
              tone="manual"
              size="sm"
              aria-label={t("dashboard.boostTimeRemaining")}
            />
          </Well>
        ) : (
          <DurationPicker value={duration} onValueChange={setDuration} disabled={busy} />
        )}
        {/* Beside the taller duration well the tiles take its height and the row's width; the legend would only
            push them below the well's top edge, so there it is left to screen readers. Stacked, it heads the tiles. */}
        <div className="grid grid-rows-[1fr] gap-3 @max-[640px]:grid-rows-[auto_1fr]">
          <Legend className="@min-[640px]:sr-only">
            {running ? t("dashboard.boostActiveMode") : t("dashboard.boostSelectMode")}
          </Legend>
          <span className="sr-only" role="status">
            {busy ? t("dashboard.boostActivating") : ""}
          </span>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 @max-[640px]:grid-cols-2">
            {boostModes.map((mode) => {
              const on = active?.modeId === mode.id;
              const pending = activating === mode.id;
              const state = pending ? "pending" : on ? "on" : "off";
              const power = modeNumber(mode, "power");
              const temperature = modeNumber(mode, "temperature");
              const meta = [
                power == null ? null : `${power} %`,
                temperature == null
                  ? null
                  : `${Number(temperatureUnit.show(temperature).toFixed(1))} ${temperatureUnit.label}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={mode.id}
                  type="button"
                  data-state={state}
                  aria-pressed={on}
                  aria-busy={pending || undefined}
                  disabled={(running && !on) || (busy && !pending) || cancelling}
                  onClick={() => {
                    if (on) void cancel();
                    else if (!busy) void activate(mode.id);
                  }}
                  className={cn(
                    "relative flex min-h-[116px] cursor-pointer flex-col gap-2 overflow-hidden rounded-lg bg-muted p-4 text-left font-sans text-foreground",
                    "transition-[background-color,color,box-shadow,scale] duration-(--duration-base)",
                    "hover:not-disabled:shadow-[inset_0_0_0_1.5px_var(--manual)] pointer-fine:active:not-disabled:scale-[.98]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40",
                    "data-[state=on]:bg-manual data-[state=on]:text-manual-foreground",
                    "data-[state=pending]:cursor-progress data-[state=pending]:bg-manual-soft data-[state=pending]:text-manual data-[state=pending]:shadow-[inset_0_0_0_1.5px_var(--manual)]",
                  )}
                >
                  <span
                    className={cn(
                      // mb-auto: on phones FitText is as tall as its text; the room left goes above the name.
                      "mb-auto flex items-center justify-between text-muted-foreground",
                      state !== "off" && "text-current",
                    )}
                  >
                    {/* The filled tile says it all; the dot keeps its place so nothing moves. */}
                    <Dot
                      color={mode.color ?? "var(--mode-4)"}
                      className={on ? "invisible" : undefined}
                    />
                    {pending ? (
                      <Spinner size={16} className="text-manual" />
                    ) : (
                      (() => {
                        const Icon = on ? IconPlayerPause : IconPlayerPlay;
                        return <Icon size={16} stroke={ICON_STROKE} aria-hidden />;
                      })()
                    )}
                  </span>
                  {/* The name fills the tile's free room, bottom-aligned above the values. */}
                  <FitText
                    text={mode.name}
                    min={16}
                    max={64}
                    stackedMax={28}
                    boxClassName="@max-[560px]:min-h-0"
                    className="content-end font-sans font-normal tracking-[-.03em]"
                  />
                  <span
                    className={cn("code text-muted-foreground", state !== "off" && "text-current")}
                  >
                    {meta}
                  </span>
                  {pending && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-1 bg-[color-mix(in_oklab,var(--manual)_22%,transparent)]"
                    >
                      <span className="absolute inset-y-0 left-0 w-2/5 animate-indeterminate rounded-[2px] bg-manual motion-reduce:w-full motion-reduce:animate-skeleton" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
