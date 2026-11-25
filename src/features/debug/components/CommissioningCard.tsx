import { IconCheck, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { Alert } from "@luftuj/shared/ui/alert";
import { AnimatedNumber } from "@luftuj/shared/ui/animated-number";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { Card, CardHeader } from "@luftuj/shared/ui/card";
import { Dot } from "@luftuj/shared/ui/dot";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Legend } from "@luftuj/shared/ui/legend";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { Well } from "@luftuj/shared/ui/well";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { cn } from "@luftuj/shared/utils/cn";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("CommissioningCard");

interface Mode {
  id: number;
  name: string;
  color?: string;
}

interface CommissioningStatus {
  running: boolean;
  modeId?: number;
  modeName?: string;
  index?: number;
  total?: number;
  secondsRemaining?: number;
  intervalSeconds?: number;
}

const RUN_PATH = "/api/commissioning/run";
const STATUS_KEY = ["debug", "commissioning"];

async function readStatus(response: Response): Promise<CommissioningStatus> {
  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as CommissioningStatus;
}

/**
 * Zaregulování: pick modes and an interval, start, then watch the test step through them (a segment per mode, the
 * current one filling over its interval) until it ends or you stop it. Replaces CommissioningPanel.
 */
export function CommissioningCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [intervalSeconds, setIntervalSeconds] = useState(45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modesQuery = useQuery({
    queryKey: ["debug", "commissioning-modes"],
    queryFn: async () => {
      const response = await fetch(resolveApiUrl("/api/timeline/modes"), { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return ((await response.json()) as { modes: Mode[] }).modes;
    },
  });
  const modes = modesQuery.data ?? [];

  // Every mode is selected until you change the selection.
  const chosen = selected ?? new Set(modes.map((mode) => mode.id));

  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () => readStatus(await fetch(resolveApiUrl(RUN_PATH), { cache: "no-cache" })),
    // Once a second while a test runs, as before; otherwise only on load.
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  });
  const status = statusQuery.data ?? { running: false };
  const running = status.running;

  useEffect(() => {
    if (modesQuery.error)
      logger.warn("Failed to load commissioning modes", { error: modesQuery.error });
  }, [modesQuery.error]);

  function toggle(id: number) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function send(init: RequestInit) {
    setError(null);
    setBusy(true);
    try {
      // The answer is the new status; the 1 s polling starts or stops with its `running`.
      queryClient.setQueryData(
        STATUS_KEY,
        await readStatus(await fetch(resolveApiUrl(RUN_PATH), init)),
      );
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setBusy(false);
    }
  }

  const sequence = modes.filter((mode) => chosen.has(mode.id));
  const allSelected = modes.length > 0 && sequence.length === modes.length;
  const total = status.total ?? sequence.length;
  const index = status.index ?? 0;
  const interval = status.intervalSeconds ?? intervalSeconds;
  const left = status.secondsRemaining ?? 0;
  const fill =
    running && interval ? Math.max(0, Math.min(100, ((interval - left) / interval) * 100)) : 0;
  const current = modes.find((mode) => mode.id === status.modeId);
  const nextMode = sequence.length === total ? sequence[index + 1] : undefined;
  const totalSeconds = sequence.length * intervalSeconds;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  let spanLabel = t("debug.commissioning.seconds", { seconds });
  if (minutes > 0 && seconds > 0)
    spanLabel = t("debug.commissioning.minutesSeconds", { minutes, seconds });
  else if (minutes > 0) spanLabel = t("debug.commissioning.minutes", { minutes });

  return (
    <Card
      className={cn(
        "min-w-0",
        running && "shadow-[var(--shadow-plane),inset_0_0_0_1.5px_var(--air)]",
      )}
    >
      <CardHeader
        legend={t("debug.commissioning.legend")}
        title={t("debug.commissioning.title")}
        description={running ? undefined : t("debug.commissioning.description")}
        action={
          running ? (
            <Badge variant="air" dot>
              {t("debug.commissioning.running")}
            </Badge>
          ) : undefined
        }
      />
      {(error || modesQuery.error) && (
        <Alert variant="destructive">{error ?? modesQuery.error?.message}</Alert>
      )}
      {running ? (
        <>
          <Well className="grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
            <div className="grid min-w-0 gap-1.5">
              <Legend>{t("debug.commissioning.currentMode")}</Legend>
              <span className="flex min-w-0 items-center gap-2.5 font-sans text-2xl leading-[30px] tracking-[-.02em]">
                {current?.color && <Dot color={current.color} />}
                <span className="truncate">{status.modeName ?? "—"}</span>
              </span>
            </div>
            <div className="grid min-w-0 justify-items-end gap-1.5">
              <Legend>{t("debug.commissioning.left")}</Legend>
              <span className="inline-flex items-baseline gap-1 text-air">
                <AnimatedNumber value={left} className="readout" />
                <small className="font-mono text-xs text-muted-foreground">s</small>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={t("debug.commissioning.progress")}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={index + 1}
              aria-valuetext={t("debug.commissioning.step", { current: index + 1, total })}
              className="col-span-full flex gap-1"
            >
              {Array.from({ length: total }, (_, segment) => (
                <span
                  key={segment}
                  title={sequence.length === total ? sequence[segment]?.name : undefined}
                  className={cn(
                    "h-2 flex-1 overflow-hidden rounded-[4px] bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] transition-[background-color] duration-(--duration-slow)",
                    segment < index && "bg-air",
                  )}
                >
                  {segment === index && (
                    <i
                      className="block h-full rounded-[inherit] bg-air transition-[width] duration-1000 ease-linear"
                      style={{ width: `${fill}%` }}
                    />
                  )}
                </span>
              ))}
            </div>
            <p className="caption col-span-full m-0 flex justify-between gap-3 text-muted-foreground">
              <span>{t("debug.commissioning.step", { current: index + 1, total })}</span>
              {nextMode && (
                <span className="truncate">
                  {t("debug.commissioning.next", { name: nextMode.name })}
                </span>
              )}
            </p>
          </Well>
          <Button
            variant="outline"
            icon={IconPlayerStop}
            loading={busy}
            onClick={() => void send({ method: "DELETE" })}
            className="border-[color-mix(in_oklab,var(--destructive)_40%,transparent)] text-destructive hover:not-disabled:bg-destructive-soft hover:not-disabled:text-destructive"
          >
            {t("debug.commissioning.stop")}
          </Button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="flex items-center justify-between gap-3">
              <Legend>{t("debug.commissioning.modesLabel")}</Legend>
              {modes.length > 0 && (
                <Button
                  variant="link"
                  onClick={() =>
                    setSelected(allSelected ? new Set() : new Set(modes.map((mode) => mode.id)))
                  }
                >
                  {allSelected
                    ? t("debug.commissioning.deselectAll")
                    : t("debug.commissioning.selectAll")}
                </Button>
              )}
            </div>
            {modesQuery.isLoading && (
              <p className="body m-0 text-muted-foreground">
                {t("debug.commissioning.loadingModes")}
              </p>
            )}
            {!modesQuery.isLoading && modes.length === 0 && (
              <p className="body m-0 text-muted-foreground">{t("debug.commissioning.noModes")}</p>
            )}
            {modes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {modes.map((mode) => {
                  const on = chosen.has(mode.id);
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(mode.id)}
                      className={cn(
                        "inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-muted pr-2.5 pl-3 font-sans text-[13px] leading-4 font-medium text-muted-foreground",
                        "transition-[background-color,color,box-shadow,scale] duration-(--duration-fast) active:scale-97",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        on && "bg-card text-foreground shadow-[inset_0_0_0_1.5px_var(--air)]",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        style={{ "--mc": mode.color ?? "var(--muted-foreground)" } as CSSProperties}
                        className={cn(
                          "relative grid size-[18px] flex-none place-items-center rounded-full text-white",
                          "before:absolute before:inset-[5px] before:rounded-full before:bg-(--mc) before:opacity-50 before:content-['']",
                          "before:transition-[inset,opacity] before:duration-(--duration-base) before:ease-(--ease-spring)",
                          on && "before:inset-0 before:opacity-100",
                        )}
                      >
                        <IconCheck
                          size={12}
                          stroke={ICON_STROKE}
                          className={cn(
                            "relative scale-40 opacity-0 transition-[opacity,scale] duration-(--duration-base) ease-(--ease-spring)",
                            on && "scale-100 opacity-100",
                          )}
                        />
                      </span>
                      <span className="truncate">{mode.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="grid min-w-0 flex-[1_1_160px] gap-0.5">
              <span className="label">{t("debug.commissioning.intervalLabel")}</span>
              <span className="caption text-muted-foreground">
                {t("debug.commissioning.intervalDescription")}
              </span>
            </div>
            <NumberInput
              aria-label={t("debug.commissioning.intervalLabel")}
              value={intervalSeconds}
              min={10}
              max={300}
              step={5}
              unit="s"
              onValueChange={setIntervalSeconds}
              className="w-[140px]"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span role="status" className="caption grid text-muted-foreground">
              {sequence.length > 0 ? (
                <>
                  <span>{t("debug.commissioning.modeCount", { count: sequence.length })}</span>
                  <span>
                    {t("debug.commissioning.totalPrefix")}{" "}
                    <b className="font-medium text-foreground">{spanLabel}</b>
                  </span>
                </>
              ) : (
                <span>{t("debug.commissioning.pickOne")}</span>
              )}
            </span>
            <Button
              variant="air"
              icon={IconPlayerPlay}
              loading={busy}
              disabled={sequence.length === 0}
              className="whitespace-nowrap"
              onClick={() =>
                void send({
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    intervalSeconds,
                    modeIds: sequence.map((mode) => mode.id),
                  }),
                })
              }
            >
              {t("debug.commissioning.start")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
