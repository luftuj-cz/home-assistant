import { IconPencil } from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Trans, useTranslation } from "react-i18next";

import type { SeasonKey, SeasonSummary } from "@luftuj/shared/types/season";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { Combobox } from "@luftuj/shared/ui/combobox";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { Switch } from "@luftuj/shared/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@luftuj/shared/ui/tooltip";
import { cn } from "@luftuj/shared/utils/cn";
import {
  dayOfYear,
  formatMonthDay,
  MONTH_DAYS,
  monthDayOf,
  monthNames,
  todayMonthDay,
  YEAR_DAYS,
} from "@luftuj/shared/utils/monthDay";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";

/** A season may not get shorter than a week. */
const MIN_DAYS = 7;
/** Keyboard and typed changes are saved after this pause, so holding an arrow key sends one request. */
const COMMIT_DELAY = 700;
/** Room a segment leaves beside a boundary: the 10px gap between two segments holds the handle's 4px grip. */
const HANDLE_CLEARANCE = 5;

type Starts = Partial<Record<SeasonKey, number>>;

function startsOf(seasons: SeasonSummary[]): Starts {
  return Object.fromEntries(
    seasons
      .filter((season) => season.enabled)
      .map((season) => [season.seasonKey, dayOfYear(season.spanStart)]),
  );
}

interface Piece {
  season: SeasonSummary;
  /** Day where it starts, in the band's rotated coordinates (0 = the band's left edge). */
  from: number;
  length: number;
}

/**
 * The enabled seasons on one unbroken year, rotated like SeasonBand: it starts at the season that crosses New Year,
 * so no season is split.
 */
function layout(seasons: SeasonSummary[], starts: Starts) {
  const enabled = seasons
    .filter((season) => season.enabled && starts[season.seasonKey] !== undefined)
    .map((season) => ({ season, start: starts[season.seasonKey] ?? 0 }))
    .toSorted((a, b) => a.start - b.start);
  const withLength = enabled.map((entry, index) => {
    const next = enabled[(index + 1) % enabled.length].start;
    return { ...entry, length: (next - entry.start + YEAR_DAYS) % YEAR_DAYS || YEAR_DAYS };
  });
  const origin = withLength.find((entry) => entry.start + entry.length > YEAR_DAYS)?.start ?? 0;
  const pieces: Piece[] = withLength
    .map((entry) => ({
      season: entry.season,
      from: (entry.start - origin + YEAR_DAYS) % YEAR_DAYS,
      length: entry.length,
    }))
    .toSorted((a, b) => a.from - b.from);
  return { pieces, origin };
}

interface SeasonEditorProps {
  seasons: SeasonSummary[];
  activeSeasonId?: number;
  busy: boolean;
  onStartChange: (key: SeasonKey, spanStart: string) => void;
  onEnabledChange: (key: SeasonKey, enabled: boolean) => void;
  onRename: (season: SeasonSummary) => void;
}

/**
 * Settings → Roční období (replaces YearBar and SeasonBoundaryEditor): the year on one bar with a handle on every
 * boundary (drag, or ← → for a day and PgUp/PgDn for a week), and a row per season with its switch, name, badges
 * and start day. Turning a season off confirms in place, naming the neighbour that takes over its dates.
 */
export function SeasonEditor({
  seasons,
  activeSeasonId,
  busy,
  onStartChange,
  onEnabledChange,
  onRename,
}: Readonly<SeasonEditorProps>) {
  const { t, i18n } = useTranslation();
  const [starts, setStarts] = useState<Starts>(() => startsOf(seasons));
  const [dragging, setDragging] = useState<SeasonKey | null>(null);
  const [confirmOff, setConfirmOff] = useState<SeasonKey | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // A pending save per season, so editing another season within the delay does not drop this one.
  const pending = useRef(
    new Map<SeasonKey, { day: number; timer: ReturnType<typeof setTimeout> }>(),
  );
  const onStartChangeRef = useRef(onStartChange);
  useEffect(() => {
    onStartChangeRef.current = onStartChange;
  });
  function label(season: SeasonSummary) {
    return seasonLabel(season, t);
  }

  // The server's boundaries win again once nothing is being dragged or typed.
  useEffect(() => {
    if (!dragging && pending.current.size === 0) setStarts(startsOf(seasons));
  }, [seasons, dragging]);

  // Leaving (another page, seasons switched off) sends what is still waiting instead of dropping it.
  useEffect(() => {
    const waiting = pending.current;
    return () => {
      for (const [key, { day, timer }] of waiting) {
        clearTimeout(timer);
        onStartChangeRef.current(key, monthDayOf(day));
      }
      waiting.clear();
    };
  }, []);

  const { pieces, origin } = layout(seasons, starts);
  const today = dayOfYear(todayMonthDay());
  const todayAt = (((today - origin + YEAR_DAYS) % YEAR_DAYS) + 0.5) / YEAR_DAYS;
  const enabledCount = seasons.filter((season) => season.enabled).length;
  const months = monthNames(i18n.language);

  function commitLater(key: SeasonKey, day: number) {
    const waiting = pending.current;
    const previous = waiting.get(key);
    if (previous) clearTimeout(previous.timer);
    waiting.set(key, {
      day,
      timer: setTimeout(() => {
        waiting.delete(key);
        onStartChangeRef.current(key, monthDayOf(day));
      }, COMMIT_DELAY),
    });
  }

  /** Where a boundary may go: at least a week after the previous start and before the next one. */
  function bounds(index: number) {
    const previous = pieces[index - 1]?.from ?? 0;
    const next = pieces[index + 1]?.from ?? YEAR_DAYS;
    return { min: previous + MIN_DAYS, max: next - MIN_DAYS };
  }

  function moveTo(index: number, position: number) {
    const piece = pieces[index];
    const { min, max } = bounds(index);
    const clamped = Math.round(Math.max(min, Math.min(max, position)));
    const day = (clamped + origin) % YEAR_DAYS;
    setStarts((prev) => ({ ...prev, [piece.season.seasonKey]: day }));
    return day;
  }

  function positionOf(event: PointerEvent) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return ((event.clientX - rect.left) / rect.width) * YEAR_DAYS;
  }

  function onHandleKeyDown(event: KeyboardEvent, index: number) {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -7,
      PageUp: 7,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const day = moveTo(index, pieces[index].from + step);
    commitLater(pieces[index].season.seasonKey, day);
  }

  function neighbourOf(season: SeasonSummary) {
    const enabled = seasons
      .filter((candidate) => candidate.enabled)
      .toSorted((a, b) => a.spanStart.localeCompare(b.spanStart));
    const index = enabled.findIndex((candidate) => candidate.id === season.id);
    return index < 0 || enabled.length < 2
      ? undefined
      : enabled[(index - 1 + enabled.length) % enabled.length];
  }

  // Rows follow the bar: from the season that wraps over New Year, so Zima comes first like it does above.
  function barOrder(season: SeasonSummary) {
    return ((starts[season.seasonKey] ?? 0) - origin + YEAR_DAYS) % YEAR_DAYS;
  }
  const rows = [
    ...seasons.filter((season) => season.enabled).toSorted((a, b) => barOrder(a) - barOrder(b)),
    ...seasons.filter((season) => !season.enabled),
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div ref={barRef} className="relative mt-[22px] h-[66px] touch-none select-none">
        {pieces.map(({ season, from, length }, index) => {
          const active = season.id === activeSeasonId;
          // Clear of the handles: one on every boundary between segments, none at the band's two ends.
          const insetStart = index > 0 ? HANDLE_CLEARANCE : 0;
          const insetEnd = index < pieces.length - 1 ? HANDLE_CLEARANCE : 0;
          const start = monthDayOf((from + origin) % YEAR_DAYS);
          const end = monthDayOf((from + length - 1 + origin) % YEAR_DAYS);
          return (
            <div
              key={season.id}
              style={
                {
                  left: `calc(${(from / YEAR_DAYS) * 100}% + ${insetStart}px)`,
                  width: `calc(${(length / YEAR_DAYS) * 100}% - ${insetStart + insetEnd}px)`,
                  "--sc": `var(--season-${season.seasonKey})`,
                } as CSSProperties
              }
              className={cn(
                "absolute inset-y-0 flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden rounded-lg px-3 pb-1.5",
                // Keyboard and typed changes glide the segments. Not while dragging: each pointer move would restart
                // the transition and the segments would trail the grip like rubber.
                dragging === null && "transition-[left,width] duration-(--duration-fast)",
                "bg-[color-mix(in_oklab,var(--sc)_12%,var(--muted))]",
                "after:absolute after:inset-x-0 after:bottom-0 after:h-[5px] after:bg-(--sc)",
                active && "shadow-[inset_0_0_0_1.5px_var(--sc)]",
                index === 0 && "rounded-l-lg",
              )}
            >
              <span className="truncate text-sm leading-5 font-medium">{label(season)}</span>
              <span className="code truncate text-muted-foreground @max-[480px]:hidden">
                {formatMonthDay(start, i18n.language)} – {formatMonthDay(end, i18n.language)}
              </span>
            </div>
          );
        })}
        {pieces.map(({ season, from }, index) => {
          // The band's left edge is the first season's start; it moves in its row, not here.
          if (index === 0) return null;
          const { min, max } = bounds(index);
          const date = formatMonthDay(monthDayOf((from + origin) % YEAR_DAYS), i18n.language);
          const held = dragging === season.seasonKey;
          return (
            <div
              key={`handle-${season.id}`}
              role="slider"
              tabIndex={busy ? -1 : 0}
              aria-label={t("settings.seasons.handle", { season: label(season) })}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={from}
              aria-valuetext={date}
              aria-disabled={busy || undefined}
              onKeyDown={(event) => onHandleKeyDown(event, index)}
              onPointerDown={(event) => {
                if (busy) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(season.seasonKey);
              }}
              onPointerMove={(event) => {
                if (held) moveTo(index, positionOf(event));
              }}
              onPointerUp={(event) => {
                if (!held) return;
                const day = moveTo(index, positionOf(event));
                setDragging(null);
                onStartChange(season.seasonKey, monthDayOf(day));
              }}
              onPointerCancel={() => setDragging(null)}
              data-drag={held || undefined}
              style={{ left: `${(from / YEAR_DAYS) * 100}%` }}
              className={cn(
                // A 24px grab area over the whole bar height, centred on the boundary; the visible grip is the <i>.
                "group/handle absolute inset-y-0 z-2 -ml-3 grid w-6 cursor-ew-resize touch-none place-items-center outline-none",
                "aria-disabled:cursor-default aria-disabled:opacity-50",
              )}
            >
              {/* A small muted grip in the gap between two segments. On hover (pointer devices only), keyboard
                  focus and drag it grows and turns air. */}
              <i
                aria-hidden="true"
                className={cn(
                  "block h-6 w-1 rounded-full bg-muted-foreground",
                  "transition-[height,background-color] duration-(--duration-fast) ease-(--ease-spring)",
                  "group-hover/handle:h-10 group-hover/handle:bg-air",
                  "group-focus-visible/handle:h-10 group-focus-visible/handle:bg-air",
                  "group-focus-visible/handle:shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--ring)]",
                  "group-data-drag/handle:h-10 group-data-drag/handle:bg-air",
                  "group-aria-disabled/handle:h-6 group-aria-disabled/handle:bg-muted-foreground",
                )}
              />
              {/* The date rises into view with the same states; the slider's aria-valuetext says it already. */}
              <b
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -top-[22px] translate-y-1 rounded-[4px] bg-foreground px-1.5 py-px",
                  "text-[11px] leading-4 font-medium whitespace-nowrap text-background opacity-0",
                  "transition-[opacity,translate] duration-(--duration-fast)",
                  "group-hover/handle:translate-y-0 group-hover/handle:opacity-100",
                  "group-focus-visible/handle:translate-y-0 group-focus-visible/handle:opacity-100",
                  "group-data-drag/handle:translate-y-0 group-data-drag/handle:opacity-100",
                  "group-aria-disabled/handle:opacity-0",
                )}
              >
                {date}
              </b>
            </div>
          );
        })}
        <span
          aria-hidden="true"
          style={{ left: `${todayAt * 100}%` }}
          className="pointer-events-none absolute -top-[18px] bottom-0 z-1 border-l border-dashed border-muted-foreground"
        >
          <b className="absolute -top-0.5 left-1.5 font-mono text-[10px] leading-3 font-medium tracking-[.08em] text-muted-foreground uppercase">
            {t("settings.seasons.today")}
          </b>
        </span>
      </div>
      <p className="caption text-muted-foreground">
        {t("settings.seasons.hint")} {t("settings.seasons.dragHint")}
      </p>

      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map((season) => {
          const day = season.enabled
            ? (starts[season.seasonKey] ?? 0)
            : dayOfYear(season.spanStart);
          const [month, date] = monthDayOf(day).split("-").map(Number);
          const lastEnabled = season.enabled && enabledCount === 1;
          const neighbour = neighbourOf(season);
          const toggle = (
            <Switch
              checked={season.enabled}
              disabled={busy || lastEnabled}
              aria-label={t("settings.seasons.toggle", { season: label(season) })}
              onCheckedChange={(checked) => {
                if (checked) onEnabledChange(season.seasonKey, true);
                else setConfirmOff(season.seasonKey);
              }}
            />
          );
          function setStart(nextMonth: number, nextDay: number) {
            const clampedDay = Math.min(Math.max(nextDay, 1), MONTH_DAYS[nextMonth - 1]);
            const target = dayOfYear(
              `${String(nextMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`,
            );
            setStarts((prev) => ({ ...prev, [season.seasonKey]: target }));
            commitLater(season.seasonKey, target);
          }
          return (
            <li
              key={season.id}
              className="grid grid-cols-[minmax(0,1fr)] rounded-lg bg-muted px-3 py-2.5"
              style={{ "--sc": `var(--season-${season.seasonKey})` } as CSSProperties}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {lastEnabled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex rounded-full">
                        {toggle}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent wrap>{t("settings.seasons.lastEnabledBlocked")}</TooltipContent>
                  </Tooltip>
                ) : (
                  toggle
                )}
                <span aria-hidden="true" className="h-6 w-1.5 flex-none rounded-[3px] bg-(--sc)" />
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    className={cn("label truncate", !season.enabled && "text-muted-foreground")}
                  >
                    {label(season)}
                  </span>
                  {season.name && (
                    <span className="caption flex-none text-muted-foreground">
                      ({t(`settings.seasons.names.${season.seasonKey}`)})
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    icon={IconPencil}
                    aria-label={t("settings.seasons.rename")}
                    title={t("settings.seasons.rename")}
                    disabled={busy}
                    onClick={() => onRename(season)}
                  />
                </span>
                {season.enabled ? (
                  <span className="flex flex-wrap items-center gap-2 max-[560px]:w-full">
                    {season.id === activeSeasonId && (
                      <Badge variant="success" dot>
                        {t("settings.seasons.active")}
                      </Badge>
                    )}
                    {season.enabledEvents === 0 && (
                      <Badge variant="warning">{t("settings.seasons.noEvents")}</Badge>
                    )}
                    <span
                      role="group"
                      aria-label={`${label(season)} ${t("settings.seasons.startsOn")}`}
                      className="ml-auto flex items-center gap-2 max-[560px]:ml-0 max-[560px]:w-full"
                    >
                      {/* Below 400px the fields need the room; the group's name still says it. */}
                      <span
                        aria-hidden="true"
                        className="caption text-muted-foreground max-[400px]:hidden"
                      >
                        {t("settings.seasons.startsOn")}
                      </span>
                      <NumberInput
                        aria-label={t("settings.seasons.day")}
                        value={date}
                        min={1}
                        max={MONTH_DAYS[month - 1]}
                        disabled={busy}
                        onValueChange={(next) => setStart(month, next)}
                        className="w-[124px] bg-card max-[560px]:w-[108px]"
                      />
                      <Combobox
                        aria-label={t("settings.seasons.month")}
                        searchable={false}
                        options={months.map((name, index) => ({
                          value: String(index + 1),
                          label: name,
                        }))}
                        value={String(month)}
                        onValueChange={(next) => {
                          if (next) setStart(Number(next), date);
                        }}
                        disabled={busy}
                        className="w-[138px] [&_[role=combobox]]:bg-card max-[560px]:w-auto max-[560px]:min-w-0 max-[560px]:flex-1"
                      />
                    </span>
                  </span>
                ) : (
                  <span className="caption text-muted-foreground">
                    {t("settings.seasons.disabledHint")}
                  </span>
                )}
              </div>
              <Collapse open={confirmOff === season.seasonKey}>
                <div className="mt-3 grid gap-3 rounded-lg bg-destructive-soft p-4">
                  <p className="body m-0">
                    {neighbour ? (
                      <Trans
                        i18nKey="settings.seasons.disablePreview"
                        values={{
                          neighbour: label(neighbour),
                          start: formatMonthDay(season.spanStart, i18n.language),
                          end: formatMonthDay(season.spanEnd, i18n.language),
                        }}
                        components={{ strong: <b className="font-semibold" /> }}
                      />
                    ) : (
                      t("settings.seasons.disabledHint")
                    )}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmOff(null)}>
                      {t("ui.cancel")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setConfirmOff(null);
                        onEnabledChange(season.seasonKey, false);
                      }}
                    >
                      {t("settings.seasons.disableSeasonConfirm", { season: label(season) })}
                    </Button>
                  </div>
                </div>
              </Collapse>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
