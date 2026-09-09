import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Radio,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconSunLow } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { MotionSwitch } from "@luftuj/shared/ui";
import { translateApiError } from "@luftuj/shared/utils/apiError";
import {
  type DisableImpact,
  SEASON_KEYS,
  type SeasonKey,
  type SeasonSummary,
} from "@luftuj/shared/types/season";
import {
  disableSeasons,
  enableSeasons,
  fetchDisableImpact,
  fetchSeasons,
  updateSeason,
} from "@luftuj/features/settings/seasonsApi";

const SEASON_COLORS: Record<SeasonKey, string> = {
  spring: "green",
  summer: "yellow",
  autumn: "orange",
  winter: "blue",
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Leap-year basis so 29 February is always addressable as a boundary. */
const DAYS_IN_YEAR = 366;

/** Day-of-year (0-365, leap-year basis) for an MM-DD boundary. */
function monthDayToOffset(monthDay: string): number {
  const month = Number.parseInt(monthDay.slice(0, 2), 10);
  const day = Number.parseInt(monthDay.slice(3), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return 0;
  let offset = 0;
  for (let index = 0; index < month - 1; index++) offset += DAYS_IN_MONTH[index] ?? 0;
  return offset + day - 1;
}

function formatMonthDay(monthDay: string): string {
  const month = Number.parseInt(monthDay.slice(0, 2), 10);
  const day = Number.parseInt(monthDay.slice(3), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return monthDay;
  return `${day}. ${month}.`;
}

function toMonthDay(month: number, day: number): string {
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The enabled season whose span would swallow this one if it were switched off.
 *
 * Spans are a ring of start days with each end derived from the next start, so
 * disabling a season removes its start point and the preceding one runs on
 * through it. Which neighbour that is has to be said before the toggle:
 * disabling autumn hands September to summer, and the schedule the user tuned
 * for September stops applying - a hardware-visible change presented, until
 * now, as an unlabelled switch.
 */
function absorbingNeighbour(
  seasons: SeasonSummary[],
  season: SeasonSummary,
): SeasonSummary | undefined {
  const enabled = seasons
    .filter((candidate) => candidate.enabled)
    .sort((a, b) => a.spanStart.localeCompare(b.spanStart));
  if (enabled.length < 2) return undefined;

  const index = enabled.findIndex((candidate) => candidate.id === season.id);
  if (index === -1) return undefined;
  return enabled[(index - 1 + enabled.length) % enabled.length];
}

/**
 * The year drawn as a ring of enabled seasons. Widths come from the derived
 * spans, so what is shown is exactly what the scheduler resolves - there is no
 * separate client-side notion of where a season ends.
 */
function YearBar({ seasons, t }: Readonly<{ seasons: SeasonSummary[]; t: (k: string) => string }>) {
  const enabled = seasons.filter((season) => season.enabled);
  const now = new Date();
  const todayOffset = monthDayToOffset(toMonthDay(now.getMonth() + 1, now.getDate()));

  const segments = enabled
    .map((season) => {
      const start = monthDayToOffset(season.spanStart);
      const end = monthDayToOffset(season.spanEnd);
      // A season that wraps the year end still occupies the same total width.
      const length = end >= start ? end - start + 1 : DAYS_IN_YEAR - start + end + 1;
      return { season, start, length };
    })
    .sort((a, b) => a.start - b.start);

  if (segments.length === 0) return null;

  // The bar starts at the first enabled season, not at 1 January, so the marker
  // has to be measured in the same rotated coordinate space as the segments.
  // Measuring it from the start of the year is what put it in the wrong place.
  const origin = segments[0]!.start;
  const todayFraction =
    (((todayOffset - origin + DAYS_IN_YEAR) % DAYS_IN_YEAR) / DAYS_IN_YEAR) * 100;

  return (
    <Stack gap={4}>
      <Group gap={0} wrap="nowrap" style={{ width: "100%", height: 34 }}>
        {segments.map(({ season, length }) => (
          <Tooltip
            key={season.id}
            label={`${t(`settings.seasons.names.${season.seasonKey}`)}: ${formatMonthDay(season.spanStart)} - ${formatMonthDay(season.spanEnd)}`}
          >
            <div
              style={{
                flexGrow: length,
                flexBasis: 0,
                height: "100%",
                backgroundColor: `var(--mantine-color-${SEASON_COLORS[season.seasonKey]}-6)`,
                opacity: season.isActive ? 1 : 0.55,
                borderRight: "1px solid var(--mantine-color-body)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <Text size="xs" c="white" fw={600} truncate>
                {t(`settings.seasons.names.${season.seasonKey}`)}
              </Text>
            </div>
          </Tooltip>
        ))}
      </Group>

      <div style={{ position: "relative", height: 16 }}>
        <div
          style={{
            position: "absolute",
            left: `${todayFraction}%`,
            transform: "translateX(-50%)",
            fontSize: 10,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            color: "var(--mantine-color-dimmed)",
          }}
        >
          {`\u25B2 ${t("settings.seasons.today")}`}
        </div>
      </div>
    </Stack>
  );
}

export function SeasonsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Shares the ["seasons"] cache with the timeline page's switcher. Holding
  // this in local state instead meant a season disabled here stayed visible
  // over there until a full page reload.
  const { data, isLoading: loading } = useQuery({
    queryKey: ["seasons"],
    queryFn: fetchSeasons,
    staleTime: 30 * 1000,
  });

  const seasons: SeasonSummary[] = useMemo(() => data?.seasons ?? [], [data]);
  const featureEnabled = data?.featureEnabled ?? false;

  const [enableOpen, setEnableOpen] = useState(false);
  const [cloneCurrent, setCloneCurrent] = useState(true);
  const [disableOpen, setDisableOpen] = useState(false);
  const [keepSeasonKey, setKeepSeasonKey] = useState<SeasonKey>("spring");
  const [impact, setImpact] = useState<DisableImpact[]>([]);

  /**
   * Refreshes every surface a season change can affect: the season list itself,
   * plus the timeline's events and modes, since disabling a season can move
   * which one is active and therefore what the timeline shows.
   */
  const reload = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["seasons"] }),
      queryClient.invalidateQueries({ queryKey: ["timeline-events"] }),
      queryClient.invalidateQueries({ queryKey: ["timeline-modes"] }),
    ]);
  }, [queryClient]);

  const reportFailure = useCallback(
    (error: unknown) => {
      notifications.show({
        color: "red",
        title: t("settings.seasons.errorTitle"),
        message: translateApiError(error, t),
      });
    },
    [t],
  );

  const handleToggleFeature = useCallback(
    (next: boolean) => {
      if (next) {
        setEnableOpen(true);
        return;
      }
      // Turning the feature off is destructive - it collapses to one season -
      // so show what would be lost before asking for confirmation.
      void (async () => {
        try {
          const preview = await fetchDisableImpact(keepSeasonKey);
          setImpact(preview.seasons);
          setDisableOpen(true);
        } catch (error) {
          reportFailure(error);
        }
      })();
    },
    [keepSeasonKey, reportFailure],
  );

  const confirmEnable = useCallback(async () => {
    setBusy(true);
    try {
      await enableSeasons(cloneCurrent);
      await reload();
      setEnableOpen(false);
      notifications.show({
        color: "green",
        title: t("settings.seasons.enabledTitle"),
        message: cloneCurrent
          ? t("settings.seasons.enabledCloned")
          : t("settings.seasons.enabledEmpty"),
      });
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
    }
  }, [cloneCurrent, reload, reportFailure, t]);

  const confirmDisable = useCallback(async () => {
    setBusy(true);
    try {
      await disableSeasons(keepSeasonKey);
      await reload();
      setDisableOpen(false);
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
    }
  }, [keepSeasonKey, reload, reportFailure]);

  const patchSeason = useCallback(
    async (key: SeasonKey, patch: { enabled?: boolean; spanStart?: string }) => {
      setBusy(true);
      try {
        await updateSeason(key, patch);
        await reload();
      } catch (error) {
        reportFailure(error);
      } finally {
        setBusy(false);
      }
    },
    [reload, reportFailure],
  );

  const handleKeepChange = useCallback(
    (value: string) => {
      const next = value as SeasonKey;
      setKeepSeasonKey(next);
      void fetchDisableImpact(next)
        .then((preview) => setImpact(preview.seasons))
        .catch(reportFailure);
    },
    [reportFailure],
  );

  const enabledCount = useMemo(() => seasons.filter((s) => s.enabled).length, [seasons]);

  return (
    <Accordion.Item value="seasons">
      <Accordion.Control icon={<IconSunLow size={20} />}>
        <Group gap="xs">
          <Text fw={600}>{t("settings.seasons.title")}</Text>
          {featureEnabled && (
            <Badge size="sm" variant="light" color="green">
              {enabledCount}
            </Badge>
          )}
        </Group>
      </Accordion.Control>

      <Accordion.Panel>
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Stack gap={2}>
              <Text size="sm">{t("settings.seasons.description")}</Text>
              <Text size="xs" c="dimmed">
                {t("settings.seasons.hint")}
              </Text>
            </Stack>
            <MotionSwitch
              checked={featureEnabled}
              onChange={(event) => handleToggleFeature(event.currentTarget.checked)}
              disabled={loading || busy}
            />
          </Group>

          {loading && <Loader size="sm" />}

          {featureEnabled && !loading && (
            <>
              <Divider />
              <YearBar seasons={seasons} t={t} />
              <Divider />

              <Stack gap="xs">
                {seasons.map((season) => {
                  const neighbour = absorbingNeighbour(seasons, season);
                  // The server refuses this too; blocking it here means the
                  // user never has to learn the rule from a red toast.
                  const isLastEnabled = season.enabled && enabledCount === 1;

                  return (
                    <Paper key={season.id} withBorder p="sm" radius="md">
                      <Group justify="space-between" wrap="nowrap" align="center">
                        <Group gap="sm" wrap="nowrap">
                          <Tooltip
                            label={t("settings.seasons.lastEnabledBlocked")}
                            disabled={!isLastEnabled}
                            multiline
                            w={240}
                          >
                            <div>
                              <MotionSwitch
                                checked={season.enabled}
                                onChange={(event) =>
                                  void patchSeason(season.seasonKey, {
                                    enabled: event.currentTarget.checked,
                                  })
                                }
                                disabled={busy || isLastEnabled}
                              />
                            </div>
                          </Tooltip>
                          <Stack gap={2}>
                            <Group gap={6}>
                              <Text fw={600} size="sm">
                                {t(`settings.seasons.names.${season.seasonKey}`)}
                              </Text>
                              {season.isActive && (
                                <Badge size="xs" color="green" variant="filled">
                                  {t("settings.seasons.active")}
                                </Badge>
                              )}
                              {season.enabled && season.enabledEvents === 0 && (
                                <Badge
                                  size="xs"
                                  color="red"
                                  variant="light"
                                  leftSection={<IconAlertTriangle size={11} />}
                                >
                                  {t("settings.seasons.noEvents")}
                                </Badge>
                              )}
                              {season.enabled && season.unconfiguredModes > 0 && (
                                <Badge
                                  size="xs"
                                  color="yellow"
                                  variant="light"
                                  leftSection={<IconAlertTriangle size={11} />}
                                >
                                  {season.unconfiguredModes}
                                </Badge>
                              )}
                            </Group>
                            <Text size="xs" c="dimmed">
                              {season.enabled
                                ? `${formatMonthDay(season.spanStart)} - ${formatMonthDay(season.spanEnd)}`
                                : t("settings.seasons.disabledHint")}
                            </Text>
                            {season.enabled && neighbour && (
                              <Text size="xs" c="dimmed">
                                {t("settings.seasons.disablePreview", {
                                  neighbour: t(`settings.seasons.names.${neighbour.seasonKey}`),
                                  start: formatMonthDay(season.spanStart),
                                  end: formatMonthDay(season.spanEnd),
                                })}
                              </Text>
                            )}
                          </Stack>
                        </Group>

                        <SeasonBoundaryEditor
                          season={season}
                          disabled={busy || !season.enabled}
                          onChange={(spanStart) =>
                            void patchSeason(season.seasonKey, { spanStart })
                          }
                          t={t}
                        />
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            </>
          )}
        </Stack>
      </Accordion.Panel>

      <Modal
        opened={enableOpen}
        onClose={() => setEnableOpen(false)}
        title={t("settings.seasons.enableTitle")}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{t("settings.seasons.enableBody")}</Text>
          <Checkbox
            checked={cloneCurrent}
            onChange={(event) => setCloneCurrent(event.currentTarget.checked)}
            label={t("settings.seasons.cloneLabel")}
            description={t("settings.seasons.cloneDescription")}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEnableOpen(false)} disabled={busy}>
              {t("settings.timeline.modal.cancel")}
            </Button>
            <Button onClick={() => void confirmEnable()} loading={busy}>
              {t("settings.seasons.enableConfirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={disableOpen}
        onClose={() => setDisableOpen(false)}
        title={t("settings.seasons.disableTitle")}
        centered
      >
        <Stack gap="md">
          {/* Nothing is deleted any more: the other seasons are parked with
              their events intact and come back when the feature does. The
              dialog is here to say which schedule will be running, not to warn
              about loss. */}
          <Text size="sm">{t("settings.seasons.disableWarning")}</Text>

          <Radio.Group
            value={keepSeasonKey}
            onChange={handleKeepChange}
            label={t("settings.seasons.keepLabel")}
          >
            <Stack gap={4} mt="xs">
              {SEASON_KEYS.map((key) => (
                <Radio
                  key={key}
                  value={key}
                  label={t(`settings.seasons.names.${key}`)}
                  disabled={busy}
                />
              ))}
            </Stack>
          </Radio.Group>

          <Stack gap={2}>
            {impact
              .filter((entry) => !entry.wouldBeKept && entry.enabledEvents > 0)
              .map((entry) => (
                <Text key={entry.seasonKey} size="xs" c="dimmed">
                  {t("settings.seasons.disableParkedRow", {
                    season: t(`settings.seasons.names.${entry.seasonKey}`),
                    count: entry.enabledEvents,
                  })}
                </Text>
              ))}
          </Stack>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDisableOpen(false)} disabled={busy}>
              {t("settings.timeline.modal.cancel")}
            </Button>
            <Button onClick={() => void confirmDisable()} loading={busy}>
              {t("settings.seasons.disableConfirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Accordion.Item>
  );
}

/**
 * Exact boundary entry: which day the season begins on. The month is a named
 * select rather than a bare number so the two fields cannot be confused, and
 * the day maximum follows the chosen month.
 */
function SeasonBoundaryEditor({
  season,
  disabled,
  onChange,
  t,
}: Readonly<{
  season: SeasonSummary;
  disabled: boolean;
  onChange: (spanStart: string) => void;
  t: (k: string) => string;
}>) {
  const { i18n } = useTranslation();
  const [month, setMonth] = useState(() => Number.parseInt(season.spanStart.slice(0, 2), 10));
  // "" while the user has the field cleared: a live boundary must not move on
  // the strength of an empty input.
  const [day, setDay] = useState<number | "">(() => Number.parseInt(season.spanStart.slice(3), 10));

  useEffect(() => {
    setMonth(Number.parseInt(season.spanStart.slice(0, 2), 10));
    setDay(Number.parseInt(season.spanStart.slice(3), 10));
  }, [season.spanStart]);

  const monthOptions = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, { month: "long" });
    return DAYS_IN_MONTH.map((_, index) => ({
      value: String(index + 1),
      // 2024 is a leap year, so February renders with 29 days available.
      label: formatter.format(new Date(2024, index, 1)),
    }));
  }, [i18n.language]);

  const maxDay = DAYS_IN_MONTH[month - 1] ?? 31;

  function commit(nextMonth: number, nextDay: number | "") {
    if (nextDay === "" || !Number.isFinite(nextDay)) {
      // Nothing typed: restore the stored day instead of guessing the 1st,
      // which could silently shift the boundary by up to a month.
      setDay(Number.parseInt(season.spanStart.slice(3), 10));
      return;
    }
    const clampedDay = Math.min(Math.max(nextDay, 1), DAYS_IN_MONTH[nextMonth - 1] ?? 31);
    const next = toMonthDay(nextMonth, clampedDay);
    if (clampedDay !== nextDay) setDay(clampedDay);
    if (next !== season.spanStart) onChange(next);
  }

  return (
    <Group gap={6} wrap="nowrap" align="flex-end">
      <NumberInput
        label={t("settings.seasons.day")}
        value={day}
        onChange={(value) => setDay(value === "" ? "" : Number(value))}
        onBlur={() => commit(month, day)}
        min={1}
        max={maxDay}
        w={68}
        size="xs"
        disabled={disabled}
        clampBehavior="strict"
      />
      <Select
        label={t("settings.seasons.month")}
        data={monthOptions}
        value={String(month)}
        onChange={(value) => {
          const nextMonth = Number(value) || 1;
          setMonth(nextMonth);
          commit(nextMonth, day);
        }}
        w={130}
        size="xs"
        disabled={disabled}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
    </Group>
  );
}
