import { useCallback, useMemo } from "react";
import { Alert, Button, Group, Select, Text } from "@mantine/core";
import { IconCalendarEvent, IconCalendarOff } from "@tabler/icons-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { SeasonSummary } from "@luftuj/shared/types/season";
import type {
  CustomOverride,
  CustomTimelineSummary,
  TimelineRef,
} from "@luftuj/shared/types/customTimeline";
import { fetchCustomTimelines } from "@luftuj/features/timeline/customTimelinesApi";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";
import { useSeasonView } from "@luftuj/features/timeline/components/SeasonSwitcher";

/** The override as it affects the hardware right now: stored, due, this unit, applying. */
export function isOverrideApplying(override: CustomOverride | null | undefined): boolean {
  return (
    !!override && override.phase === "active" && override.appliesToCurrentUnit && !override.degraded
  );
}

/**
 * Which plan the timeline page is *looking at* - a season or a custom
 * timeline. View state only, like the season view: selecting a custom timeline
 * here never activates it; that happens on the dashboard.
 */
export function usePlanView(unitId?: string) {
  const seasonView = useSeasonView();
  const search = useSearch({ from: "/timeline" }) as { custom?: number };
  const navigate = useNavigate({ from: "/timeline" });

  const { data } = useQuery({
    queryKey: ["custom-timelines", unitId ?? "current"],
    queryFn: () => fetchCustomTimelines(unitId),
    staleTime: 15 * 1000,
  });

  const customTimelines = useMemo(() => data?.timelines ?? [], [data]);
  const override = data?.override ?? null;
  const viewedCustom = customTimelines.find((timeline) => timeline.id === search.custom);

  const setViewedCustom = useCallback(
    (id: number) => {
      void navigate({ search: { custom: id }, replace: true });
    },
    [navigate],
  );

  /** Back to the season plan, for installs where there is no season to pick. */
  const clearCustomView = useCallback(() => {
    void navigate({ search: {}, replace: true });
  }, [navigate]);

  const ref: TimelineRef = viewedCustom
    ? { kind: "custom", id: viewedCustom.id }
    : { kind: "season", id: seasonView.viewedSeasonId };

  return {
    ...seasonView,
    customTimelines,
    override,
    viewedCustom,
    setViewedCustom,
    clearCustomView,
    ref,
  };
}

interface CustomTimelineSelectProps {
  timelines: CustomTimelineSummary[];
  viewedId?: number;
  onChange: (id: number) => void;
  canLeave?: () => boolean;
}

/**
 * Custom timelines are unbounded, so they get a select next to the season
 * segments rather than more segments.
 */
export function CustomTimelineSelect({
  timelines,
  viewedId,
  onChange,
  canLeave,
}: Readonly<CustomTimelineSelectProps>) {
  const { t } = useTranslation();
  if (timelines.length === 0) return null;

  return (
    <Select
      aria-label={t("settings.customTimelines.viewLabel")}
      placeholder={t("settings.customTimelines.viewPlaceholder")}
      leftSection={<IconCalendarEvent size={16} />}
      data={timelines.map((timeline) => ({
        value: String(timeline.id),
        label:
          timeline.overridePhase === "active"
            ? `${timeline.name} · ${t("settings.customTimelines.phaseActive")}`
            : timeline.name,
      }))}
      value={viewedId === undefined ? null : String(viewedId)}
      onChange={(value) => {
        if (!value || (canLeave && !canLeave())) return;
        onChange(Number(value));
      }}
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
      miw={220}
    />
  );
}

/**
 * The season control when there is nothing to switch between: with seasons off
 * there is one default plan, and a way back to it is all that is needed.
 */
export function DefaultPlanButton({
  active,
  onSelect,
}: Readonly<{ active: boolean; onSelect: () => void }>) {
  const { t } = useTranslation();
  return (
    <Button variant={active ? "filled" : "default"} onClick={onSelect}>
      {t("settings.customTimelines.defaultPlan")}
    </Button>
  );
}

/**
 * Says, persistently, what is applied when it is not what is on screen: either
 * a custom timeline is viewed that is not running, or a season is viewed while
 * a custom timeline overrides the season schedule.
 */
export function PlanViewNotice({
  viewedCustom,
  viewedSeason,
  activeSeason,
  seasonsEnabled,
  override,
}: Readonly<{
  viewedCustom?: CustomTimelineSummary;
  viewedSeason?: SeasonSummary;
  activeSeason?: SeasonSummary;
  /** With seasons off there is one season row, but the user has no seasons to name. */
  seasonsEnabled: boolean;
  override: CustomOverride | null;
}>) {
  const { t } = useTranslation();
  const applying = isOverrideApplying(override);

  if (viewedCustom) {
    if (applying && override?.customTimelineId === viewedCustom.id) return null;
    let running = t("settings.customTimelines.defaultPlan");
    if (applying) running = override?.name ?? "?";
    else if (seasonsEnabled && activeSeason) running = seasonLabel(activeSeason, t);
    return (
      <Alert color="blue" variant="light" icon={<IconCalendarOff size={16} />}>
        <Text size="sm">
          {t("settings.customTimelines.viewingNotApplied", { viewed: viewedCustom.name, running })}
        </Text>
      </Alert>
    );
  }

  if (applying && viewedSeason) {
    return (
      <Alert color="grape" variant="light" icon={<IconCalendarEvent size={16} />}>
        <Group gap="xs">
          <Text size="sm">
            {t("settings.customTimelines.seasonOverridden", {
              season: seasonLabel(viewedSeason, t),
              custom: override?.name ?? "?",
            })}
          </Text>
        </Group>
      </Alert>
    );
  }

  return null;
}
