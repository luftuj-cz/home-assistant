import { useNavigate } from "@tanstack/react-router";
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { CustomOverride, CustomTimelineSummary } from "@luftuj/shared/types/customTimeline";
import type { SeasonSummary } from "@luftuj/shared/types/season";
import { Button } from "@luftuj/shared/ui/button";
import { Dot } from "@luftuj/shared/ui/dot";
import { Legend } from "@luftuj/shared/ui/legend";
import { cn } from "@luftuj/shared/utils/cn";
import {
  dayOfYear,
  formatMonthDay,
  MONTH_DAYS,
  monthInitials,
  todayMonthDay,
  YEAR_DAYS,
} from "@luftuj/shared/utils/monthDay";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";

import { isOverrideApplying } from "../hooks/usePlanView";

const YEAR = YEAR_DAYS;

interface Segment {
  season: SeasonSummary;
  label: string;
  from: number;
  length: number;
}

/**
 * The seasons on one unbroken year. The band starts on the first day of a season that runs over New Year, so that
 * season is a single piece and the seasons read in order; without one it starts in January.
 */
function layout(seasons: SeasonSummary[], label: (season: SeasonSummary) => string) {
  const sorted = seasons
    .map((season) => ({ season, start: dayOfYear(season.spanStart) }))
    .toSorted((a, b) => a.start - b.start);
  const raw = sorted.map((entry, index) => {
    const next = sorted[(index + 1) % sorted.length].start;
    return { ...entry, length: (next - entry.start + YEAR) % YEAR || YEAR };
  });
  const origin = raw.find((entry) => entry.start + entry.length > YEAR)?.start ?? 0;
  function position(day: number) {
    return (day - origin + YEAR) % YEAR;
  }
  const segments: Segment[] = raw
    .map((entry) => ({
      season: entry.season,
      label: label(entry.season),
      from: position(entry.start),
      length: entry.length,
    }))
    .toSorted((a, b) => a.from - b.from);
  // Month ticks rotate with the band; a month cut by its edge keeps the tick but drops its initial when short.
  const months: { month: number; length: number; short: boolean }[] = [];
  let month = 0;
  let before = 0;
  while (before + MONTH_DAYS[month] <= origin) {
    before += MONTH_DAYS[month];
    month++;
  }
  let left = MONTH_DAYS[month] - (origin - before);
  for (let day = 0; day < YEAR;) {
    const length = Math.min(left, YEAR - day);
    months.push({ month, length, short: length < 12 });
    day += length;
    month = (month + 1) % 12;
    left = MONTH_DAYS[month];
  }
  return { segments, months, position };
}

interface SeasonBandProps {
  /** Enabled seasons. With fewer than two there is no band, only the plan chips. */
  seasons: SeasonSummary[];
  activeSeasonId?: number;
  viewedSeasonId?: number;
  onSeasonChange: (id: number) => void;
  plans: CustomTimelineSummary[];
  viewedPlanId?: number;
  override: CustomOverride | null;
  /** `null` returns to the season (or default) plan. */
  onPlanChange: (id: number | null) => void;
  seasonsEnabled: boolean;
  /** "Upravit data období" after the status sentence; off where the user already is in Settings. */
  showEditLink?: boolean;
}

/**
 * The year as a band (replaces SeasonSwitcher, SeasonViewNotice and the custom-plan select): every enabled season at
 * its real dates, a "dnes" pin, the running season's pulsing dot and its count of unconfigured modes. Picking a
 * segment chooses which plan is viewed, never which one runs. Custom plans are chips under it, and one status
 * sentence says what is on screen versus what runs.
 */
export function SeasonBand({
  seasons,
  activeSeasonId,
  viewedSeasonId,
  onSeasonChange,
  plans,
  viewedPlanId,
  override,
  onPlanChange,
  seasonsEnabled,
  showEditLink = true,
}: Readonly<SeasonBandProps>) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement>(null);
  const showBand = seasonsEnabled && seasons.length >= 2;
  if (!showBand && plans.length === 0) return null;

  function label(season: SeasonSummary) {
    return seasonLabel(season, t);
  }
  const { segments, months, position } = layout(showBand ? seasons : [], label);
  const initials = monthInitials(i18n.language);
  const today = dayOfYear(todayMonthDay());
  const todayAt = (position(today) + 0.5) / YEAR;
  const viewingPlan = plans.find((plan) => plan.id === viewedPlanId);
  const applying = isOverrideApplying(override);
  const runningPlanId = applying ? override?.customTimelineId : undefined;
  const viewed = seasons.find((season) => season.id === viewedSeasonId);
  const active = seasons.find((season) => season.id === activeSeasonId);
  function range(season: SeasonSummary) {
    return `${formatMonthDay(season.spanStart, i18n.language)} – ${formatMonthDay(season.spanEnd, i18n.language)}`;
  }
  function days(count: number) {
    return t("settings.timeline.band.days", { count });
  }

  const editLink = showEditLink && (
    <Button
      variant="link"
      className="h-auto p-0 align-baseline"
      onClick={() => void navigate({ to: "/settings", search: { section: "seasons" } })}
    >
      {t("settings.timeline.seasonEditBoundaries")}
    </Button>
  );
  let note: ReactNode = null;
  if (viewingPlan) {
    let running = t("settings.customTimelines.defaultPlan");
    if (applying) running = override?.name ?? "?";
    else if (seasonsEnabled && active) running = label(active);
    note =
      runningPlanId === viewingPlan.id ? (
        <Trans
          i18nKey="settings.customTimelines.seasonOverridden"
          values={{ custom: viewingPlan.name, season: viewed ? label(viewed) : "" }}
        />
      ) : (
        <Trans
          i18nKey="settings.customTimelines.viewingNotApplied"
          values={{ viewed: viewingPlan.name, running }}
        />
      );
  } else if (applying && viewed) {
    note = (
      <Trans
        i18nKey="settings.customTimelines.seasonOverridden"
        values={{ season: label(viewed), custom: override?.name ?? "?" }}
      />
    );
  } else if (showBand && viewed && active && viewed.id !== active.id) {
    const until = (dayOfYear(viewed.spanStart) - today + YEAR) % YEAR;
    note = (
      <>
        <Trans
          i18nKey="settings.timeline.band.viewingNote"
          values={{ viewed: label(viewed), active: label(active), days: days(until) }}
          components={{ b: <b /> }}
        />{" "}
        {editLink}
      </>
    );
  } else if (showBand && viewed) {
    const segment = segments.find((entry) => entry.season.id === viewed.id);
    const left = segment ? (segment.from + segment.length - position(today) + YEAR) % YEAR : 0;
    note = (
      <>
        <Trans
          i18nKey="settings.timeline.band.activeNote"
          values={{ season: label(viewed), range: range(viewed), days: days(left) }}
          components={{ b: <b /> }}
        />{" "}
        {editLink}
      </>
    );
  }

  /** Viewing a season leaves any custom plan (the season view replaces it). */
  function pickSeason(id: number) {
    onSeasonChange(id);
  }

  /** ← → between segments, like a radio group. */
  function onTrackKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const index = segments.findIndex((entry) => entry.season.id === viewedSeasonId);
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = segments[(Math.max(index, 0) + delta + segments.length) % segments.length];
    pickSeason(next.season.id);
    trackRef.current
      ?.querySelector<HTMLButtonElement>(`[data-season="${next.season.id}"]`)
      ?.focus();
  }

  return (
    <section
      data-slot="season-band"
      data-plan={viewingPlan ? "" : undefined}
      aria-label={showBand ? t("settings.timeline.band.label") : t("settings.timeline.band.plans")}
      className="group/band @container grid grid-cols-[minmax(0,1fr)] gap-1.5 rounded-xl bg-card p-5 shadow-plane max-[560px]:p-4"
    >
      {showBand && (
        <>
          <div
            ref={trackRef}
            role="radiogroup"
            aria-label={t("settings.timeline.band.label")}
            onKeyDown={onTrackKeyDown}
            className="relative mt-[18px] h-[72px] @max-[560px]:h-[54px]"
          >
            {segments.map(({ season, label: name, from, length }) => {
              const on = !viewingPlan && season.id === viewedSeasonId;
              const isActive = season.id === activeSeasonId;
              const focusable = viewingPlan
                ? season.id === activeSeasonId
                : season.id === viewedSeasonId;
              return (
                <button
                  key={season.id}
                  type="button"
                  role="radio"
                  data-season={season.id}
                  aria-checked={on}
                  tabIndex={focusable ? 0 : -1}
                  aria-label={`${name}, ${range(season)}${isActive ? `, ${t("settings.timeline.band.active")}` : ""}`}
                  onClick={() => pickSeason(season.id)}
                  style={
                    {
                      left: `calc(${(from / YEAR) * 100}% + 2px)`,
                      width: `calc(${(length / YEAR) * 100}% - 4px)`,
                      "--sc": `var(--season-${season.seasonKey})`,
                    } as CSSProperties
                  }
                  className={cn(
                    "absolute inset-y-0 flex min-w-0 cursor-pointer flex-col justify-center gap-0.5 overflow-hidden rounded-lg border-0 px-3.5 pb-1.5 text-left font-sans text-foreground",
                    "bg-[color-mix(in_oklab,var(--sc)_9%,var(--muted))] hover:bg-[color-mix(in_oklab,var(--sc)_17%,var(--muted))]",
                    "after:absolute after:inset-x-0 after:bottom-0 after:h-[5px] after:bg-(--sc) after:opacity-50 after:transition-[height,opacity] after:duration-(--duration-base) hover:after:opacity-80",
                    "transition-[translate,scale,background-color,box-shadow,opacity] duration-(--duration-base) ease-(--ease-spring) active:scale-[.99]",
                    "aria-checked:z-1 aria-checked:-translate-y-[3px] aria-checked:bg-card aria-checked:shadow-[var(--shadow-float),inset_0_0_0_1.5px_var(--sc)] aria-checked:after:h-[7px] aria-checked:after:opacity-100",
                    "focus-visible:z-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    "group-data-plan/band:opacity-55",
                    "@max-[560px]:rounded-md @max-[560px]:px-[7px] @max-[560px]:pb-[5px]",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2 text-[15px] leading-5 font-medium @max-[560px]:gap-1.5 @max-[560px]:text-[13px]">
                    <span className="truncate">{name}</span>
                    {isActive && <Dot tone="air" pulse className="@max-[560px]:hidden" />}
                    {season.unconfiguredModes > 0 && (
                      <span
                        title={t("settings.timeline.band.unconfigured", {
                          count: season.unconfiguredModes,
                        })}
                        className="h-[18px] min-w-[18px] flex-none rounded-full bg-warning-soft px-[5px] text-center font-mono text-[11px] leading-[18px] font-semibold text-warning"
                      >
                        {season.unconfiguredModes}
                      </span>
                    )}
                  </span>
                  <span className="code truncate text-muted-foreground @max-[560px]:hidden">
                    {range(season)}
                  </span>
                </button>
              );
            })}
            <span
              aria-hidden="true"
              style={{ left: `${todayAt * 100}%` }}
              className={cn(
                "pointer-events-none absolute -inset-y-[5px] z-3 -ml-px w-0.5",
                "before:absolute before:top-0 before:left-0 before:h-[15px] before:w-0.5 before:rounded-[1px] before:bg-foreground before:shadow-[0_0_0_2px_var(--card)]",
                "after:absolute after:bottom-0 after:left-0 after:h-[14px] after:w-0.5 after:rounded-[1px] after:bg-foreground after:shadow-[0_0_0_2px_var(--card)]",
              )}
            >
              <b
                className={cn(
                  "absolute bottom-[calc(100%+2px)] font-mono text-[10px] leading-3 font-medium tracking-[.08em] whitespace-nowrap text-foreground uppercase",
                  todayAt < 0.05 && "-left-0.5",
                  todayAt > 0.95 && "-right-0.5",
                  todayAt >= 0.05 && todayAt <= 0.95 && "left-1/2 -translate-x-1/2",
                )}
              >
                {t("settings.timeline.band.today")}
              </b>
            </span>
          </div>
          <div
            aria-hidden="true"
            className="flex px-0.5 pt-0.5 font-mono text-[10px] leading-3 text-muted-foreground"
          >
            {months.map((month) => (
              <span
                key={`${month.month}-${month.length}`}
                style={{ width: `${(month.length / YEAR) * 100}%` }}
                className="box-border h-3 border-l border-input pl-1"
              >
                {month.short ? "" : initials[month.month]}
              </span>
            ))}
          </div>
        </>
      )}
      {plans.length > 0 && (
        <div
          role="radiogroup"
          aria-label={t("settings.timeline.band.plans")}
          className={cn("flex flex-wrap items-center gap-2", showBand && "pt-3")}
        >
          <Legend className="mr-1">{t("settings.timeline.band.plans")}</Legend>
          {!showBand && (
            <PlanChip on={!viewingPlan} onClick={() => onPlanChange(null)}>
              {t("settings.customTimelines.defaultPlan")}
            </PlanChip>
          )}
          {plans.map((plan) => (
            <PlanChip
              key={plan.id}
              on={plan.id === viewedPlanId}
              onClick={() => onPlanChange(plan.id === viewedPlanId ? null : plan.id)}
            >
              {plan.id === runningPlanId && (
                <Dot tone="plan" pulse className="in-aria-checked:[--dot:var(--plan-foreground)]" />
              )}
              {plan.name}
              {plan.enabledEvents === 0 && (
                <span className="text-muted-foreground in-aria-checked:text-current">
                  ({t("settings.timeline.band.empty")})
                </span>
              )}
            </PlanChip>
          ))}
        </div>
      )}
      {note && (
        <p
          role="status"
          className="body min-h-5 pt-2 text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground group-data-plan/band:[&_b]:text-plan"
        >
          {note}
        </p>
      )}
    </section>
  );
}

function PlanChip({
  on,
  onClick,
  children,
}: Readonly<{ on: boolean; onClick: () => void; children: ReactNode }>) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-full border-0 bg-secondary px-3.5 font-sans text-[13px] leading-4 font-medium text-secondary-foreground",
        "transition-[background-color,color,box-shadow,scale] duration-(--duration-base) pointer-fine:hover:shadow-[inset_0_0_0_1.5px_var(--plan)] active:scale-[.97]",
        "aria-checked:bg-plan aria-checked:text-plan-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      {children}
    </button>
  );
}
