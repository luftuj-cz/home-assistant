import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { fetchSeasons } from "@luftuj/features/settings/seasonsApi";
import { fetchCustomTimelines } from "@luftuj/features/timeline/customTimelinesApi";
import type { CustomOverride, TimelineRef } from "@luftuj/shared/types/customTimeline";

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

  // Mirrors the scheduler's unit-wide check, parked seasons included: it only
  // reaches for the safe state once some schedule has existed on this unit.
  const unitHasEnabledEvents = useMemo(
    () => (data?.seasons ?? []).some((season) => season.enabledEvents > 0),
    [data],
  );

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
    unitHasEnabledEvents,
    seasons,
    activeSeasonId,
    viewedSeasonId,
    setViewedSeason,
    viewedSeason: seasons.find((s) => s.id === viewedSeasonId),
    activeSeason: seasons.find((s) => s.id === activeSeasonId),
  };
}

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
