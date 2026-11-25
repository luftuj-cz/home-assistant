import { IconCalendarEvent, IconCheck, IconPlayerPlay } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CustomOverride, CustomTimelineSummary } from "@luftuj/shared/types/customTimeline";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { Combobox } from "@luftuj/shared/ui/combobox";
import { DateTimeField } from "@luftuj/shared/ui/date-time-field";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";
import { Field } from "@luftuj/shared/ui/field";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Switch } from "@luftuj/shared/ui/switch";
import { cn } from "@luftuj/shared/utils/cn";

export interface OverrideRequest {
  customTimelineId: number;
  /** Omitted: starts now. */
  startsAt?: string;
  /** Null: runs until ended. */
  endsAt: string | null;
}

type Duration = "untilEnded" | "day" | "days3" | "week" | "untilDate";
const DURATIONS: Duration[] = ["untilEnded", "day", "days3", "week", "untilDate"];
const DURATION_HOURS: Record<"day" | "days3" | "week", number> = {
  day: 24,
  days3: 72,
  week: 24 * 7,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** DateTimeField value ("YYYY-MM-DDTHH:MM", local) for a moment. */
function fieldValue(time: number) {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fieldTime(value: string) {
  return value ? new Date(value).getTime() : Number.NaN;
}

/** The next full hour from now plus `hours`, so a default is a round time. */
function roundedFuture(hours: number) {
  const d = new Date(Date.now() + hours * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

interface PlanStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: CustomTimelineSummary[];
  /** The override that would be replaced, if any. */
  current: CustomOverride | null;
  busy: boolean;
  onSubmit: (request: OverrideRequest) => void;
}

/**
 * "Zapnout vlastní plán" (replaces CustomOverrideModal): which plan, for how long, and (rarely) from when, with a
 * plum summary line of when it will run. Up to four plans are radio cards, more go into a Combobox. Replacing a
 * running or scheduled plan is warned about inline.
 */
export function PlanStartDialog({
  open,
  onOpenChange,
  plans,
  current,
  busy,
  onSubmit,
}: Readonly<PlanStartDialogProps>) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [duration, setDuration] = useState<Duration>("untilEnded");
  const [endAt, setEndAt] = useState("");
  const [startLater, setStartLater] = useState(false);
  const [startAt, setStartAt] = useState("");

  // Fresh defaults on every open; a replaced plan starts from itself.
  useEffect(() => {
    if (!open) return;
    const usable = plans.filter((plan) => plan.enabledEvents > 0);
    let preselect: number | null = usable.length === 1 ? usable[0].id : null;
    if (current && usable.some((plan) => plan.id === current.customTimelineId)) {
      preselect = current.customTimelineId;
    }
    setSelected(preselect === null ? null : String(preselect));
    setDuration("untilEnded");
    setEndAt(fieldValue(roundedFuture(24 * 7)));
    setStartLater(false);
    setStartAt(fieldValue(roundedFuture(1)));
  }, [current, open, plans]);

  const startTime = startLater ? fieldTime(startAt) : Date.now();
  const endTime = useMemo(() => {
    if (duration === "untilEnded") return null;
    if (duration === "untilDate") return fieldTime(endAt);
    return startTime + DURATION_HOURS[duration] * 3_600_000;
  }, [duration, endAt, startTime]);

  const invalidStart = Number.isNaN(startTime);
  const invalidEnd = endTime !== null && Number.isNaN(endTime);
  const endBeforeStart = endTime !== null && !invalidStart && !invalidEnd && endTime <= startTime;
  const invalid = !selected || invalidStart || invalidEnd || endBeforeStart;
  const today = fieldValue(Date.now());
  const plan = plans.find((p) => String(p.id) === selected);

  let confirmLabel = startLater
    ? t("dashboard.customOverride.schedule")
    : t("dashboard.customOverride.activate");
  if (current) confirmLabel = t("dashboard.customOverride.replace");

  let endError: string | undefined;
  if (invalidEnd) endError = t("dashboard.customOverride.invalidDateTime");
  else if (endBeforeStart) endError = t("dashboard.customOverride.endBeforeStart");

  function when(time: number) {
    return new Date(time).toLocaleString(i18n.language, {
      weekday: "long",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  let summary: string | null = null;
  if (plan && !invalid) {
    const start = startLater ? when(startTime) : t("dashboard.planStart.now");
    summary =
      endTime === null
        ? t("dashboard.planStart.summaryOpen", { start })
        : t("dashboard.planStart.summary", {
            start,
            end: when(endTime),
            length: t("dashboard.planStart.days", {
              count: Math.max(1, Math.round((endTime - startTime) / 86_400_000)),
            }),
          });
  }

  function submit() {
    if (invalid || !selected) return;
    onSubmit({
      customTimelineId: Number(selected),
      ...(startLater ? { startsAt: new Date(startTime).toISOString() } : {}),
      endsAt: endTime === null ? null : new Date(endTime).toISOString(),
    });
  }

  function events(count: number) {
    return t("dashboard.planStart.events", { count });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent tone="plan">
        <DialogHeader
          legend={t("dashboard.customOverride.title")}
          title={t("dashboard.customOverride.modalTitle")}
        />
        <DialogBody>
          {plans.length <= 4 ? (
            <div className="grid gap-2">
              <span id="plan-start-plan" className="label">
                {t("dashboard.customOverride.timeline")}
              </span>
              <div
                role="radiogroup"
                aria-labelledby="plan-start-plan"
                className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2"
              >
                {plans.map((p) => {
                  const on = String(p.id) === selected;
                  const empty = p.enabledEvents === 0;
                  const Mark = on ? IconCheck : IconCalendarEvent;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={empty}
                      onClick={() => setSelected(String(p.id))}
                      className={cn(
                        "relative grid min-h-[88px] cursor-pointer content-start justify-items-start gap-0.5 rounded-md bg-muted p-3 text-left text-foreground",
                        "transition-[background-color,box-shadow,scale] duration-(--duration-fast) pointer-fine:active:not-disabled:scale-[.98]",
                        "hover:not-disabled:shadow-[inset_0_0_0_1.5px_var(--plan)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        on &&
                          "bg-plan-soft shadow-[inset_0_0_0_2px_var(--plan)] hover:not-disabled:shadow-[inset_0_0_0_2px_var(--plan)]",
                        "disabled:cursor-not-allowed disabled:bg-transparent disabled:shadow-[inset_0_0_0_1px_var(--border)]",
                      )}
                    >
                      <span
                        className={cn(
                          "mb-1.5 grid size-6 place-items-center rounded-sm bg-card text-plan transition-colors duration-(--duration-fast)",
                          on && "bg-plan text-plan-foreground",
                        )}
                      >
                        <Mark size={14} stroke={ICON_STROKE} aria-hidden />
                      </span>
                      <span
                        className={cn(
                          "label max-w-full truncate",
                          empty && "text-muted-foreground",
                        )}
                      >
                        {p.name}
                      </span>
                      <span className="caption text-muted-foreground">
                        {empty ? t("dashboard.planStart.emptyPlan") : events(p.enabledEvents)}
                      </span>
                      {current?.customTimelineId === p.id && (
                        <span className="legend absolute top-3 right-3 text-plan">
                          {t("dashboard.planStart.running")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <Field label={t("dashboard.customOverride.timeline")}>
              <Combobox
                placeholder={t("dashboard.customOverride.timelinePlaceholder")}
                icon={IconCalendarEvent}
                value={selected}
                onValueChange={setSelected}
                options={plans.map((p) => ({
                  value: String(p.id),
                  label: p.enabledEvents
                    ? p.name
                    : `${p.name} ${t("dashboard.customOverride.emptySuffix")}`,
                  description: p.enabledEvents
                    ? events(p.enabledEvents)
                    : t("dashboard.planStart.addEvents"),
                  disabled: p.enabledEvents === 0,
                  dot: p.enabledEvents ? "var(--plan)" : undefined,
                }))}
              />
            </Field>
          )}

          <div className="grid gap-2">
            <span id="plan-start-duration" className="label">
              {t("dashboard.customOverride.durationLabel")}
            </span>
            <div
              role="radiogroup"
              aria-labelledby="plan-start-duration"
              className="flex flex-wrap gap-2"
            >
              {DURATIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={duration === value}
                  onClick={() => setDuration(value)}
                  className={cn(
                    "inline-flex h-[34px] cursor-pointer items-center rounded-full bg-secondary px-3.5 font-sans text-[13px] leading-4 font-medium text-secondary-foreground",
                    "transition-[background-color,color,box-shadow,scale] duration-(--duration-fast) pointer-fine:active:scale-[.97]",
                    "hover:shadow-[inset_0_0_0_1.5px_var(--plan)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    duration === value && "bg-plan text-plan-foreground",
                  )}
                >
                  {t(`dashboard.customOverride.durations.${value}`)}
                </button>
              ))}
            </div>
            <Collapse open={duration === "untilDate"}>
              <div className="pt-3">
                <Field label={t("dashboard.customOverride.endAt")} error={endError}>
                  <DateTimeField value={endAt} onValueChange={setEndAt} min={today} />
                </Field>
              </div>
            </Collapse>
          </div>

          <div className="grid gap-2">
            <Switch
              label={t("dashboard.customOverride.startLater")}
              checked={startLater}
              onCheckedChange={setStartLater}
            />
            <Collapse open={startLater}>
              <div className="pt-3">
                <Field
                  label={t("dashboard.customOverride.startAt")}
                  error={
                    startLater && invalidStart
                      ? t("dashboard.customOverride.invalidDateTime")
                      : undefined
                  }
                >
                  <DateTimeField value={startAt} onValueChange={setStartAt} min={today} />
                </Field>
              </div>
            </Collapse>
          </div>

          {summary && (
            <p
              role="status"
              className="body flex items-start gap-2 rounded-md bg-plan-soft px-3.5 py-2.5 text-plan"
            >
              <IconCalendarEvent
                size={16}
                stroke={ICON_STROKE}
                aria-hidden
                className="mt-0.5 flex-none"
              />
              {summary}
            </p>
          )}
          {current && (
            <Alert variant="warning">
              {t("dashboard.customOverride.replaceWarning", { name: current.name ?? "?" })}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {t("ui.cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="plan"
            icon={IconPlayerPlay}
            loading={busy}
            disabled={invalid}
            onClick={submit}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
