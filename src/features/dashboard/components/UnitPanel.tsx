import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useTemperature } from "@luftuj/shared/temperature/useTemperature";

import type { TodayPlan } from "@luftuj/features/dashboard/hooks/useTodayPlan";
import type {
  ActiveMode,
  HruState,
  HruVariable,
  LocalizedText,
} from "@luftuj/features/dashboard/types";
import { DayStrip } from "@luftuj/features/timeline/components/DayStrip";
import { Card, CardHeader } from "@luftuj/shared/ui/card";
import { Dot, type Tone } from "@luftuj/shared/ui/dot";
import { FitText } from "@luftuj/shared/ui/fit-text";
import { ErrorState } from "@luftuj/shared/ui/error-state";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Legend } from "@luftuj/shared/ui/legend";
import { MetricTile } from "@luftuj/shared/ui/metric-tile";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import { StatusBadge } from "@luftuj/shared/ui/status-badge";
import { Well } from "@luftuj/shared/ui/well";
import { translateConnectionError } from "@luftuj/shared/utils/connectionError";
import { cn } from "@luftuj/shared/utils/cn";
import { flagWord } from "@luftuj/shared/utils/hruFlag";

import { PowerGauge } from "./PowerGauge";

/** Three polls without a fresh read: the values are stale. */
const STALE_AFTER_S = 30;

const SOURCE_TONE: Record<ActiveMode["source"], Tone> = {
  schedule: "air",
  manual: "manual",
  boost: "manual",
  custom: "plan",
  fallback: "warning",
};

const CHIP_TEXT: Partial<Record<Tone, string>> = {
  air: "text-air",
  manual: "text-manual",
  plan: "text-plan",
  warning: "text-warning",
};

interface UnitPanelProps {
  status: HruState;
  name: string | null;
  /** "192.168.1.40:502", shown in the header legend. */
  address?: string;
  activeMode: ActiveMode | null;
  configuredMaxPower?: number;
  today: TodayPlan | null;
}

/** Seconds since the last fresh read, counted here (no clock skew with the backend); restarts at each new read. */
function useReadAge(fetchedAt: number | null) {
  const [seconds, setSeconds] = useState(0);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (fetchedAt === null) {
      return;
    }
    setSeconds(0);
    setFresh(true);
    const spin = setTimeout(() => setFresh(false), 600);
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      clearTimeout(spin);
      clearInterval(tick);
    };
  }, [fetchedAt]);
  return { seconds, fresh };
}

/** The live data-age chip: "před 4 s"; the icon turns once when a read lands; amber when the data is stale. */
function AgeChip({ fetchedAt }: Readonly<{ fetchedAt: number }>) {
  const { t } = useTranslation();
  const { seconds, fresh } = useReadAge(fetchedAt);
  const stale = seconds > STALE_AFTER_S;
  const age =
    seconds < 60
      ? t("app.unit.ageSeconds", { count: seconds })
      : t("app.unit.ageMinutes", { count: Math.floor(seconds / 60) });
  return (
    <span
      title={t("app.unit.updated", { age })}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 font-mono text-xs leading-4 whitespace-nowrap text-muted-foreground",
        stale && "bg-warning-soft text-warning",
      )}
    >
      <IconRefresh
        size={13}
        stroke={ICON_STROKE}
        aria-hidden
        className={cn(
          "opacity-70",
          fresh && "animate-[ui-spin_600ms_var(--ease-in-out)_1] motion-reduce:animate-none",
        )}
      />
      {age}
    </span>
  );
}

interface ModeReadoutProps {
  activeMode: ActiveMode | null;
  /** The running mode's name (the schedule's mode, or the unit's own mode when nothing better is known). */
  name: string;
  /** The unit's native mode ("Větrání"). */
  nativeMode?: string;
  today: TodayPlan | null;
}

/** The running mode as the panel's second hero: source chip, name, until when, and today's plan as a strip. */
function ModeReadout({ activeMode, name, nativeMode, today }: Readonly<ModeReadoutProps>) {
  const { t } = useTranslation();
  const source = activeMode?.source ?? "schedule";
  const tone = SOURCE_TONE[source];
  const until = today?.next
    ? t("dashboard.modeReadout.until", { time: today.next.time, mode: today.next.mode })
    : null;

  return (
    <Well className="flex min-w-0 flex-col gap-2 p-5">
      {/* Where the mode comes from sits on the legend's row, at the right. */}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Legend>{t("dashboard.hruMode")}</Legend>
        <span
          className={cn(
            "inline-flex h-[26px] min-w-0 items-center gap-2 rounded-full bg-card px-2.5 font-sans text-xs leading-4 font-medium",
            CHIP_TEXT[tone],
          )}
        >
          <Dot tone={tone} pulse={source !== "schedule"} />
          <span className="truncate">{t(`dashboard.modeReadout.sources.${source}`)}</span>
        </span>
      </div>
      {/* The name takes the room the well has left (the well is as tall as the power gauge beside it). */}
      <FitText
        key={name}
        text={name}
        className="animate-fade font-sans font-normal tracking-[-.03em] text-foreground"
      />
      {(until || nativeMode) && (
        <p className="caption text-muted-foreground">
          {until}
          {until && nativeMode ? " · " : ""}
          {nativeMode && t("dashboard.modeReadout.nativeMode", { mode: nativeMode })}
        </p>
      )}
      {today && (
        <div className="mt-auto grid grid-cols-[minmax(0,1fr)] gap-2 pt-4">
          <Legend>{t("dashboard.modeReadout.today")}</Legend>
          <DayStrip
            events={today.events}
            now={today.now}
            carry={today.carry}
            trackClassName="bg-card h-3.5"
          />
        </div>
      )}
    </Well>
  );
}

interface Flag {
  label: string;
  active: boolean;
  negative: boolean;
}

/** Unit flags as chips: positive ones read Zap./Vyp., negative ones (faults, filter change) Ano/Ne. */
function FlagList({ flags }: Readonly<{ flags: Flag[] }>) {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("dashboard.unitPanel.flags")}
      className="m-0 flex list-none flex-wrap gap-2 p-0"
    >
      {flags.map((flag) => {
        let tone: Tone = "neutral";
        if (flag.active) {
          tone = flag.negative ? "destructive" : "success";
        }
        const word = flagWord(flag.active, flag.negative, t);
        return (
          <li
            key={flag.label}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-full bg-muted px-3 font-sans text-[13px] leading-4",
              tone === "destructive" && "bg-destructive-soft",
            )}
          >
            <Dot tone={tone} />
            <span>{flag.label}</span>
            <span
              className={cn(
                "font-medium text-muted-foreground",
                tone === "success" && "text-success",
                tone === "destructive" && "text-destructive",
              )}
            >
              {word}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The HRU at a glance (replaces HruStatusCard): the power gauge beside the running mode with today's plan, then one
 * row of live values, then the unit's flags. Variables marked `onDashboard` are mapped by class: power → gauge,
 * mode → mode readout, temperature and others → metric wells, flag → chips. Loading shows skeleton wells; an
 * error shows the translated Modbus error inside the plane.
 */
export function UnitPanel({
  status,
  name,
  address,
  activeMode,
  configuredMaxPower,
  today,
}: Readonly<UnitPanelProps>) {
  const { t } = useTranslation();
  const temperature = useTemperature();
  const title = name ?? t("dashboard.unitPanel.legend");
  const legend = address
    ? `${t("dashboard.unitPanel.legend")} · ${address}`
    : t("dashboard.unitPanel.legend");

  function text(value: LocalizedText | undefined, fallback = "") {
    if (value === undefined) return fallback;
    if (typeof value === "string") return t(value, { defaultValue: value });
    return value.translate ? t(value.text, { defaultValue: value.text }) : value.text;
  }

  if (status === null) {
    return (
      <Card>
        <CardHeader
          legend={legend}
          title={title}
          action={<StatusBadge status="neutral" label={t("dashboard.haStatus.loading")} />}
        />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <div className="grid grid-cols-[minmax(230px,270px)_minmax(0,1fr)] gap-3 @max-[560px]:grid-cols-[minmax(0,1fr)]">
            <Skeleton className="h-[248px] rounded-lg" />
            <Skeleton className="h-[248px] rounded-lg" />
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-3 @max-[560px]:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if ("error" in status) {
    const message = status.errorCode
      ? translateConnectionError("modbusErrors", status.errorCode, status.error, t)
      : status.error;
    return (
      <Card>
        <CardHeader
          legend={legend}
          title={title}
          action={<StatusBadge status="error" label={t("dashboard.haStatus.error")} />}
        />
        <ErrorState
          title={t("dashboard.unitPanel.notResponding")}
          description={message}
          details={
            status.errorCode && address ? `${status.errorCode} ${address}` : status.errorCode
          }
        />
      </Card>
    );
  }

  const { values, displayValues, variables, fetchedAt } = status;
  const shown = variables.filter((variable) => variable.onDashboard === true);
  const powerVar = shown.find((v) => v.class === "power" || v.name === "power");
  const modeVar = shown.find((v) => v.class === "mode" || v.name === "mode");
  const temperatures = shown.filter((v) => v.class === "temperature");
  const flagVars = shown.filter((v) => v.class === "flag");
  const others = shown.filter(
    (v) => v !== powerVar && v !== modeVar && v.class !== "temperature" && v.class !== "flag",
  );

  function display(variable: HruVariable): string {
    const raw = values[variable.name];
    const option = variable.options?.find((o) => o.value === Number(raw));
    if (option) return text(option.label);
    const shownValue = displayValues[variable.name] ?? raw;
    if (shownValue === null || shownValue === undefined || shownValue === "") return "—";
    return typeof shownValue === "string"
      ? t(shownValue, { defaultValue: shownValue })
      : String(shownValue);
  }

  const nativeMode = modeVar ? display(modeVar) : undefined;
  const modeName = activeMode?.modeName
    ? t(activeMode.modeName, { defaultValue: activeMode.modeName })
    : undefined;
  let readoutName = modeName ?? nativeMode ?? "—";
  if (activeMode?.source === "fallback") readoutName = t("dashboard.activeMode.fallback");
  if (activeMode?.source === "manual") readoutName = nativeMode ?? t("dashboard.activeMode.manual");

  const powerRaw = powerVar ? Number(values[powerVar.name]) : Number.NaN;
  const powerUnit = powerVar?.unit ? text(powerVar.unit) : "%";
  const powerMax = typeof powerVar?.max === "number" ? powerVar.max : 100;
  const powerMin = typeof powerVar?.min === "number" ? powerVar.min : 0;
  const limit =
    powerVar?.maxConfigurable && configuredMaxPower != null ? configuredMaxPower : undefined;

  const tiles = [
    ...temperatures.map((v) => {
      const raw = Number(values[v.name]);
      // The unit reads in °C; the display unit comes from Vzhled.
      return {
        key: v.name,
        legend: text(v.label),
        value: Number.isFinite(raw) ? temperature.show(raw).toFixed(1) : "—",
        unit: temperature.label,
      };
    }),
    ...others.map((v) => ({
      key: v.name,
      legend: text(v.label),
      value: display(v),
      unit: v.unit ? text(v.unit) : undefined,
    })),
  ];

  return (
    <Card>
      <CardHeader legend={legend} title={title} action={<AgeChip fetchedAt={fetchedAt} />} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <div
          className={cn(
            "grid gap-3 @max-[560px]:grid-cols-[minmax(0,1fr)]",
            powerVar
              ? "grid-cols-[minmax(230px,270px)_minmax(0,1fr)]"
              : "grid-cols-[minmax(0,1fr)]",
          )}
        >
          {powerVar && Number.isFinite(powerRaw) && (
            <Well className="grid place-items-center content-center gap-2 px-4 pt-5 pb-4">
              <PowerGauge
                value={powerRaw}
                min={powerMin}
                max={powerMax}
                unit={powerUnit}
                legend={text(powerVar.label)}
                configuredMax={limit}
              />
              {limit !== undefined && (
                <span className="caption flex items-center gap-2 text-muted-foreground">
                  <i aria-hidden="true" className="h-[2.5px] w-3 rounded-[2px] bg-foreground" />
                  {t("dashboard.unitPanel.limit", { value: limit, unit: powerUnit })}
                </span>
              )}
            </Well>
          )}
          <ModeReadout
            activeMode={activeMode}
            name={readoutName}
            nativeMode={modeName ? nativeMode : undefined}
            today={today}
          />
        </div>
        {tiles.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-3 @max-[560px]:grid-cols-2 @max-[560px]:[&_.readout]:text-[30px] @max-[560px]:[&_.readout]:leading-[34px]">
            {tiles.map((tile) => (
              <MetricTile key={tile.key} legend={tile.legend} value={tile.value} unit={tile.unit} />
            ))}
          </div>
        )}
        {flagVars.length > 0 && (
          <FlagList
            flags={flagVars.map((v) => ({
              label: text(v.label),
              active: Boolean(values[v.name]),
              negative: v.flag === "negative",
            }))}
          />
        )}
      </div>
    </Card>
  );
}
