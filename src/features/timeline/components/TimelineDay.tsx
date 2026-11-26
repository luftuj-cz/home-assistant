import { useDroppable } from "@dnd-kit/core";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconClipboard,
  IconCopy,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { modeOfEvent, stripEvents, type ActiveEventRef } from "@luftuj/features/timeline/utils";
import type { Mode, TimelineEvent } from "@luftuj/shared/types/timeline";
import { Button } from "@luftuj/shared/ui/button";
import { Dot } from "@luftuj/shared/ui/dot";
import { Menu } from "@luftuj/shared/ui/dropdown-menu";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Legend } from "@luftuj/shared/ui/legend";
import { Switch } from "@luftuj/shared/ui/switch";
import { cn } from "@luftuj/shared/utils/cn";

import { DayStrip } from "./DayStrip";

export const DAY_DROP_PREFIX = "day:";

interface TimelineDayProps {
  dayIdx: number;
  label: string;
  events: TimelineEvent[];
  modes: Mode[];
  /** The event the scheduler applies now, which may belong to an earlier day. */
  activeEvent?: ActiveEventRef;
  today: boolean;
  /** "HH:MM", for the now-needle on today's strip. */
  now: string;
  /** Colour of the previous day's last mode, still running until the first event. */
  carry?: string;
  /** A day is on the clipboard (possibly from another season). */
  copyActive: boolean;
  /** The day on the clipboard. */
  copyDay: number | null;
  loading: boolean;
  onCopy: (day: number) => void;
  onPaste: (day: number) => void;
  onCancelCopy: () => void;
  onAdd: (day: number) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent, day: number) => void;
  onToggle: (event: TimelineEvent, enabled: boolean) => void;
  /** Events may be Automatika, so adding needs no stored mode. */
  allowAutomatic?: boolean;
  className?: string;
}

/**
 * One day of the weekly plan (replaces TimelineDayCard): a 24-hour strip and the events in time order, each with a
 * switch and an Upravit/Smazat menu. Today has an air ring, a Dnes chip and the now-needle; the running event reads
 * BĚŽÍ. While a day is copied, the other days turn air-soft with Vložit. ModeCards drop onto it.
 */
export function TimelineDay({
  dayIdx,
  label,
  events,
  modes,
  activeEvent,
  today,
  now,
  carry,
  copyActive,
  copyDay,
  loading,
  onCopy,
  onPaste,
  onCancelCopy,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  allowAutomatic = false,
  className,
}: Readonly<TimelineDayProps>) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_DROP_PREFIX}${dayIdx}` });
  const sorted = events.toSorted((a, b) => a.startTime.localeCompare(b.startTime));
  const source = copyActive && copyDay === dayIdx;
  const target = copyActive && !source;
  // Automatika needs no mode of its own, so a season view can take events before any mode exists.
  const noModes = modes.length === 0 && !allowAutomatic;

  let copyButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      icon={IconCopy}
      aria-label={t("settings.timeline.copyDay")}
      title={t("settings.timeline.copyDay")}
      onClick={() => onCopy(dayIdx)}
    />
  );
  if (source) {
    copyButton = (
      <Button
        variant="secondary"
        size="icon-sm"
        icon={IconCopy}
        aria-pressed
        aria-label={t("schedule.cancelCopy")}
        title={t("schedule.cancelCopy")}
        onClick={onCancelCopy}
        className="text-air shadow-[inset_0_0_0_1.5px_var(--air)]"
      />
    );
  } else if (target) {
    copyButton = (
      <Button
        variant="secondary"
        size="icon-sm"
        icon={IconClipboard}
        aria-label={t("settings.timeline.pasteDay")}
        title={t("settings.timeline.pasteDay")}
        onClick={() => onPaste(dayIdx)}
      />
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-today={today || undefined}
      data-target={target || isOver || undefined}
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr] content-start gap-4 rounded-xl bg-card p-5 shadow-plane",
        "transition-[box-shadow,background-color] duration-(--duration-base)",
        "data-today:shadow-[var(--shadow-plane),inset_0_0_0_1.5px_var(--air)]",
        "data-target:bg-air-soft data-target:shadow-[inset_0_0_0_1.5px_var(--air)]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="card-title truncate">{label}</h3>
        {today && (
          <span className="inline-flex h-6 flex-none items-center gap-1.5 rounded-full bg-air-soft px-2.5 text-xs leading-4 font-medium text-air">
            <Dot tone="air" pulse />
            {t("settings.timeline.today")}
          </span>
        )}
        <span className="ml-auto flex flex-none gap-1">
          {copyButton}
          <Button
            variant="secondary"
            size="icon-sm"
            icon={IconPlus}
            aria-label={t("settings.timeline.addEvent")}
            title={t("settings.timeline.addEvent")}
            disabled={loading || noModes}
            onClick={() => onAdd(dayIdx)}
          />
        </span>
      </div>
      <DayStrip
        events={stripEvents(events, modes)}
        now={today ? now : undefined}
        carry={carry}
        trackClassName={target ? "bg-card" : "bg-muted"}
      />
      {sorted.length === 0 ? (
        <div className="grid min-h-[182px] place-content-center justify-items-center gap-3 rounded-lg bg-muted px-4 py-5 text-center in-data-target:bg-card">
          <span className="grid size-11 place-items-center rounded-full bg-card text-muted-foreground in-data-target:bg-muted">
            <IconCalendarEvent size={20} stroke={ICON_STROKE} aria-hidden />
          </span>
          <p className="body text-muted-foreground">{t("settings.timeline.noEvents")}</p>
          {target ? (
            <Button
              variant="secondary"
              size="sm"
              icon={IconClipboard}
              onClick={() => onPaste(dayIdx)}
            >
              {t("settings.timeline.pasteDay")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={IconPlus}
              disabled={loading || noModes}
              onClick={() => onAdd(dayIdx)}
            >
              {t("settings.timeline.addEvent")}
            </Button>
          )}
        </div>
      ) : (
        <ol className="-mx-2 my-0 grid list-none content-start gap-0.5 p-0">
          {sorted.map((event) => {
            // An every-day event appears in all seven days; it runs only in the one the scheduler picked it from.
            const active =
              event.id !== undefined &&
              event.id === activeEvent?.id &&
              (event.dayOfWeek !== null || dayIdx === activeEvent.day);
            const mode = modeOfEvent(event, modes);
            const name =
              mode?.name ??
              (typeof event.hruConfig?.mode === "string" ? event.hruConfig.mode : "–");
            const off = !event.enabled;
            return (
              <li
                key={event.id ?? `${event.startTime}-${String(event.hruConfig?.mode)}`}
                data-active={active || undefined}
                data-off={off || undefined}
                className="group/event flex min-h-11 min-w-0 items-center gap-2.5 rounded-md py-1 pr-1 pl-2 hover:bg-muted data-active:bg-air-soft"
              >
                <span className="code w-10 flex-none text-[13px] text-muted-foreground group-data-active/event:text-air group-data-off/event:line-through group-data-off/event:decoration-input">
                  {event.startTime}
                </span>
                <span
                  aria-hidden="true"
                  className="h-5 w-1 flex-none rounded-[2px] group-data-off/event:opacity-35"
                  style={{ background: mode?.color ?? "var(--mode-8)" }}
                />
                <span
                  className="inline-flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm group-data-off/event:text-muted-foreground group-data-off/event:line-through group-data-off/event:decoration-input"
                  title={name}
                >
                  <span className="truncate">{name}</span>
                  {/* Write-gating should make this unreachable, but an import or a cross-season paste can still
                      produce it, and a silently inert event is worse than a marked one. */}
                  {mode?.configured === false && (
                    <IconAlertTriangle
                      size={14}
                      stroke={ICON_STROKE}
                      role="img"
                      aria-label={t("settings.timeline.eventModeUnconfigured")}
                      className="flex-none text-warning"
                    />
                  )}
                </span>
                {active && <Legend className="text-air">{t("settings.timeline.running")}</Legend>}
                <span className="flex flex-none items-center gap-0.5">
                  <Switch
                    size="sm"
                    checked={event.enabled}
                    onCheckedChange={(checked) => onToggle(event, checked)}
                    aria-label={t("settings.timeline.eventToggle", {
                      time: event.startTime,
                      mode: name,
                    })}
                  />
                  <Menu
                    label={t("settings.timeline.eventActions", { time: event.startTime })}
                    items={[
                      {
                        label: t("settings.timeline.edit"),
                        icon: IconPencil,
                        onSelect: () => onEdit(event),
                      },
                      {
                        label: t("settings.timeline.delete"),
                        icon: IconTrash,
                        destructive: true,
                        onSelect: () => onDelete(event, dayIdx),
                      },
                    ]}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
