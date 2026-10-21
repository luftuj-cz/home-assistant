import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Group, Modal, Select, Stack, Switch, Text } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { IconAlertTriangle, IconPlayerPlay } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import "dayjs/locale/cs";

import type { CustomOverride, CustomTimelineSummary } from "@luftuj/shared/types/customTimeline";

export interface OverrideRequest {
  customTimelineId: number;
  /** Omitted: starts now. */
  startsAt?: string;
  /** Null: runs until ended. */
  endsAt: string | null;
}

/** How long the override runs, counted from its start. */
type Duration = "untilEnded" | "day" | "days3" | "week" | "untilDate";

const DURATION_HOURS: Record<Exclude<Duration, "untilEnded" | "untilDate">, number> = {
  day: 24,
  days3: 72,
  week: 24 * 7,
};

const DURATIONS: Duration[] = ["untilEnded", "day", "days3", "week", "untilDate"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `DateTimePicker` value (`YYYY-MM-DD HH:mm:ss`, local time) for a moment. */
function pickerValue(time: number): string {
  const date = new Date(time);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  );
}

/** Milliseconds of a picker value, or NaN while it is empty. */
function pickerTime(value: string | null): number {
  return value ? new Date(value.replace(" ", "T")).getTime() : Number.NaN;
}

/** Next full hour from now plus `hours`, so a default start is a round time. */
function roundedFuture(hours: number): number {
  const date = new Date(Date.now() + hours * 3_600_000);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

interface CustomOverrideModalProps {
  opened: boolean;
  timelines: CustomTimelineSummary[];
  /** The override that would be replaced, if any. */
  current: CustomOverride | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (request: OverrideRequest) => void;
}

/**
 * Switches a custom timeline on: which plan, for how long, and - tucked away
 * because it is rare - from when. Replacing a running override is confirmed
 * inline rather than in a second dialog.
 */
export function CustomOverrideModal({
  opened,
  timelines,
  current,
  busy,
  onClose,
  onSubmit,
}: Readonly<CustomOverrideModalProps>) {
  const { t, i18n } = useTranslation();

  const [selected, setSelected] = useState<string | null>(null);
  const [duration, setDuration] = useState<Duration>("untilEnded");
  const [endAt, setEndAt] = useState<string | null>(null);
  const [startLater, setStartLater] = useState(false);
  const [startAt, setStartAt] = useState<string | null>(null);

  // Fresh defaults on every open; a replaced override starts from its own plan.
  useEffect(() => {
    if (!opened) return;
    const usable = timelines.filter((timeline) => timeline.enabledEvents > 0);
    let preselect: number | null = usable.length === 1 ? usable[0].id : null;
    if (current && usable.some((timeline) => timeline.id === current.customTimelineId)) {
      preselect = current.customTimelineId;
    }
    setSelected(preselect === null ? null : String(preselect));
    setDuration("untilEnded");
    setEndAt(pickerValue(roundedFuture(24 * 7)));
    setStartLater(false);
    setStartAt(pickerValue(roundedFuture(1)));
  }, [current, opened, timelines]);

  const startTime = startLater ? pickerTime(startAt) : Date.now();
  const endTime = useMemo(() => {
    if (duration === "untilEnded") return null;
    if (duration === "untilDate") return pickerTime(endAt);
    return startTime + DURATION_HOURS[duration] * 3_600_000;
  }, [duration, endAt, startTime]);

  const invalidStart = Number.isNaN(startTime);
  const invalidEnd = endTime !== null && Number.isNaN(endTime);
  const endBeforeStart = endTime !== null && !invalidStart && !invalidEnd && endTime <= startTime;
  const invalid = !selected || invalidStart || invalidEnd || endBeforeStart;

  const locale = i18n.language.startsWith("cs") ? "cs" : "en";
  const valueFormat = locale === "cs" ? "dd D. M. YYYY HH:mm" : "ddd D MMM YYYY HH:mm";
  const minDate = pickerValue(Date.now());

  function submit() {
    if (invalid || !selected) return;
    onSubmit({
      customTimelineId: Number(selected),
      ...(startLater ? { startsAt: new Date(startTime).toISOString() } : {}),
      endsAt: endTime === null ? null : new Date(endTime).toISOString(),
    });
  }

  let confirmLabel = startLater
    ? t("dashboard.customOverride.schedule")
    : t("dashboard.customOverride.activate");
  if (current) confirmLabel = t("dashboard.customOverride.replace");

  let endError: string | undefined;
  if (invalidEnd) endError = t("dashboard.customOverride.invalidDateTime");
  else if (endBeforeStart) endError = t("dashboard.customOverride.endBeforeStart");

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={<Text fw={600}>{t("dashboard.customOverride.modalTitle")}</Text>}
    >
      <Stack gap="md">
        <Select
          label={t("dashboard.customOverride.timeline")}
          placeholder={t("dashboard.customOverride.timelinePlaceholder")}
          data={timelines.map((timeline) => ({
            value: String(timeline.id),
            label:
              timeline.enabledEvents === 0
                ? `${timeline.name} ${t("dashboard.customOverride.emptySuffix")}`
                : timeline.name,
            disabled: timeline.enabledEvents === 0,
          }))}
          value={selected}
          onChange={setSelected}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          data-autofocus
        />

        <Stack gap={6}>
          <Text size="sm" fw={500}>
            {t("dashboard.customOverride.durationLabel")}
          </Text>
          <Group gap={6} wrap="wrap">
            {DURATIONS.map((value) => (
              <Button
                key={value}
                size="xs"
                radius="md"
                color="grape"
                variant={duration === value ? "filled" : "default"}
                onClick={() => setDuration(value)}
              >
                {t(`dashboard.customOverride.durations.${value}`)}
              </Button>
            ))}
          </Group>
          {duration === "untilDate" && (
            <DateTimePicker
              aria-label={t("dashboard.customOverride.endAt")}
              value={endAt}
              onChange={setEndAt}
              locale={locale}
              valueFormat={valueFormat}
              minDate={minDate}
              clearable={false}
              popoverProps={{ withinPortal: true }}
              error={endError}
            />
          )}
        </Stack>

        <Stack gap={6}>
          <Switch
            label={t("dashboard.customOverride.startLater")}
            checked={startLater}
            onChange={(event) => setStartLater(event.currentTarget.checked)}
          />
          {startLater && (
            <DateTimePicker
              aria-label={t("dashboard.customOverride.startAt")}
              value={startAt}
              onChange={setStartAt}
              locale={locale}
              valueFormat={valueFormat}
              minDate={minDate}
              clearable={false}
              popoverProps={{ withinPortal: true }}
              error={invalidStart ? t("dashboard.customOverride.invalidDateTime") : undefined}
            />
          )}
        </Stack>

        {current && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            {t("dashboard.customOverride.replaceWarning", { name: current.name ?? "?" })}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button
            color="grape"
            leftSection={<IconPlayerPlay size={16} />}
            disabled={invalid}
            loading={busy}
            onClick={submit}
          >
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
