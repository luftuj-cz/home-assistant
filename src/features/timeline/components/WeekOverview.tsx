import { useTranslation } from "react-i18next";

import { carryColor, stripEvents } from "@luftuj/features/timeline/utils";
import type { Mode, TimelineEvent } from "@luftuj/shared/types/timeline";
import { Legend } from "@luftuj/shared/ui/legend";
import { cn } from "@luftuj/shared/utils/cn";

import { DayStrip, StripScale } from "./DayStrip";

interface WeekOverviewProps {
  eventsByDay: Map<number, TimelineEvent[]>;
  modes: Mode[];
  /** Full day names, Monday first. */
  dayLabels: string[];
  today: number;
  now: string;
  selected: number;
  onSelect: (day: number) => void;
  /** The plan's name ("Týdenní plán" or the custom plan). */
  title: string;
}

/**
 * The whole week on one 24-hour axis, a thin strip per day. On a phone it is the day picker above one TimelineDay.
 * Each day starts in the previous day's last mode at 35 %; a day with no enabled events is hatched.
 */
export function WeekOverview({
  eventsByDay,
  modes,
  dayLabels,
  today,
  now,
  selected,
  onSelect,
  title,
}: Readonly<WeekOverviewProps>) {
  const { t, i18n } = useTranslation();
  const short = dayLabels.map((_, day) =>
    // 2024-01-01 was a Monday.
    new Date(2024, 0, 1 + day).toLocaleDateString(i18n.language, { weekday: "short" }),
  );
  const strips = dayLabels.map((_, day) => stripEvents(eventsByDay.get(day) ?? [], modes));

  return (
    <div
      role="group"
      aria-label={t("settings.timeline.dayPicker")}
      className="grid grid-cols-[minmax(0,1fr)] gap-1.5 rounded-xl bg-card p-5 shadow-plane"
    >
      <div className="mb-3 grid gap-1">
        <Legend>{t("settings.timeline.weekLegend")}</Legend>
        <h2 className="card-title">{title}</h2>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
        {dayLabels.map((label, day) => {
          const events = strips[day];
          const on = day === selected;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(day)}
              className={cn(
                "group/row -mx-2 grid h-8 cursor-pointer grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left font-sans text-[13px] leading-4 font-medium text-muted-foreground",
                "transition-[background-color,color] duration-(--duration-fast) hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              {/* The visible "Po" stays out of the name; the full sentence is the name (no label-content mismatch). */}
              <span aria-hidden="true" className={cn(day === today && "font-semibold text-air")}>
                {short[day]}
              </span>
              <span className="sr-only">
                {t("settings.timeline.weekRow", {
                  day: label,
                  today: day === today ? t("settings.timeline.weekToday") : "",
                  count: events.length,
                })}
              </span>
              <DayStrip
                events={events}
                carry={events.length > 0 ? carryColor(eventsByDay, day, modes) : undefined}
                now={day === today ? now : undefined}
                scale={false}
                trackClassName={
                  events.length === 0
                    ? "h-3.5 bg-transparent bg-[repeating-linear-gradient(-45deg,var(--border)_0_1.5px,transparent_1.5px_7px)] shadow-[inset_0_0_0_1px_var(--border)]"
                    : "h-3.5 bg-muted group-hover/row:bg-card group-aria-pressed/row:bg-card"
                }
              />
            </button>
          );
        })}
      </div>
      <StripScale className="ml-10" />
    </div>
  );
}
