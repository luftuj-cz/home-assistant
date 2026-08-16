import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Group, SegmentedControl, Text } from "@mantine/core";
import { IconAlertTriangle, IconCalendarClock } from "@tabler/icons-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { SeasonSummary } from "@luftuj/shared/types/season";
import { fetchSeasons } from "@luftuj/features/settings/seasonsApi";

/**
 * Which season the timeline page is *looking at*.
 *
 * View state only. The season that actually drives the hardware is derived from
 * the calendar, so switching here never writes anything - if one control did
 * both, browsing to winter in July would retune a real house.
 */
export function useSeasonView() {
  const search = useSearch({ from: "/timeline" }) as { season?: number };
  const navigate = useNavigate({ from: "/timeline" });

  const { data } = useQuery({
    queryKey: ["seasons"],
    queryFn: fetchSeasons,
    staleTime: 30 * 1000,
  });

  const seasons = useMemo(() => data?.seasons.filter((s) => s.enabled) ?? [], [data]);
  const activeSeasonId = data?.activeSeasonId ?? undefined;

  // Default to the active season, so opening the page shows what is running.
  const viewedSeasonId = useMemo(() => {
    if (search.season && seasons.some((s) => s.id === search.season)) return search.season;
    return activeSeasonId;
  }, [search.season, seasons, activeSeasonId]);

  const setViewedSeason = useCallback(
    (id: number) => {
      void navigate({ search: { season: id }, replace: true });
    },
    [navigate],
  );

  return {
    featureEnabled: data?.featureEnabled ?? false,
    seasons,
    activeSeasonId,
    viewedSeasonId,
    setViewedSeason,
    viewedSeason: seasons.find((s) => s.id === viewedSeasonId),
    activeSeason: seasons.find((s) => s.id === activeSeasonId),
  };
}

interface SeasonSwitcherProps {
  seasons: SeasonSummary[];
  viewedSeasonId?: number;
  activeSeasonId?: number;
  onChange: (id: number) => void;
  /** Consulted before switching, so an unsaved dialog can block it. */
  canLeave?: () => boolean;
}

/**
 * At most four seasons exist, so a segmented control always fits - there is no
 * scrollable-tabs fallback to maintain.
 */
export function SeasonSwitcher({
  seasons,
  viewedSeasonId,
  activeSeasonId,
  onChange,
  canLeave,
}: Readonly<SeasonSwitcherProps>) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<string | undefined>(undefined);

  useEffect(() => {
    setPending(viewedSeasonId === undefined ? undefined : String(viewedSeasonId));
  }, [viewedSeasonId]);

  if (seasons.length < 2) return null;

  return (
    <SegmentedControl
      value={pending}
      onChange={(value) => {
        if (canLeave && !canLeave()) return;
        setPending(value);
        onChange(Number(value));
      }}
      fullWidth
      data={seasons.map((season) => ({
        value: String(season.id),
        label: (
          <Group gap={6} justify="center" wrap="nowrap">
            <Text size="sm">{t(`settings.seasons.names.${season.seasonKey}`)}</Text>
            {season.id === activeSeasonId && (
              <Badge size="xs" color="green" variant="filled" circle>
                {" "}
              </Badge>
            )}
            {season.unconfiguredModes > 0 && (
              <Badge size="xs" color="yellow" variant="light">
                {season.unconfiguredModes}
              </Badge>
            )}
          </Group>
        ),
      }))}
    />
  );
}

/**
 * Tells the user, persistently, that what they are editing is not what is
 * running. Without it someone can spend ten minutes tuning autumn while
 * believing they are adjusting the live schedule.
 *
 * The link matters as much as the sentence: having learnt they are in the wrong
 * season, the next question is when the viewed one begins - and if that answer
 * is wrong, the boundaries are what needs editing. Both live in Settings.
 */
export function SeasonViewNotice({
  viewedSeason,
  activeSeason,
}: Readonly<{ viewedSeason?: SeasonSummary; activeSeason?: SeasonSummary }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!viewedSeason || !activeSeason || viewedSeason.id === activeSeason.id) return null;

  return (
    <Alert color="blue" variant="light" icon={<IconCalendarClock size={16} />}>
      <Group gap="xs" wrap="wrap">
        <Text size="sm">
          {t("settings.timeline.seasonViewNotice", {
            viewed: t(`settings.seasons.names.${viewedSeason.seasonKey}`),
            active: t(`settings.seasons.names.${activeSeason.seasonKey}`),
          })}
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          onClick={() => void navigate({ to: "/settings", search: { section: "seasons" } })}
        >
          {t("settings.timeline.seasonEditBoundaries")}
        </Button>
      </Group>
    </Alert>
  );
}

/**
 * The active season applying no schedule is the condition that used to leave
 * the unit frozen on stale values. The safe state catches it now, but running
 * the house on minimum ventilation is still not what anyone intended.
 */
export function EmptyActiveSeasonNotice({
  activeSeason,
}: Readonly<{ activeSeason?: SeasonSummary }>) {
  const { t } = useTranslation();
  if (!activeSeason || activeSeason.enabledEvents > 0) return null;

  return (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
      {t("settings.timeline.seasonEmptyWarning", {
        season: t(`settings.seasons.names.${activeSeason.seasonKey}`),
      })}
    </Alert>
  );
}
