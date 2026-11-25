import { IconLeaf } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { RenameDialog } from "@luftuj/features/settings/components/RenameDialog";
import {
  DisableSeasonsDialog,
  EnableSeasonsDialog,
} from "@luftuj/features/settings/components/SeasonDialogs";
import { SeasonEditor } from "@luftuj/features/settings/components/SeasonEditor";
import { SettingsSection, SummaryChip } from "@luftuj/features/settings/components/SettingsSection";
import {
  disableSeasons,
  enableSeasons,
  fetchDisableImpact,
  fetchSeasons,
  updateSeason,
} from "@luftuj/features/settings/seasonsApi";
import type {
  DisableImpact,
  EnablePreview,
  SeasonKey,
  SeasonSummary,
} from "@luftuj/shared/types/season";
import { notify } from "@luftuj/shared/ui/notify";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import { Switch } from "@luftuj/shared/ui/switch";
import { translateApiError } from "@luftuj/shared/utils/apiError";
import { formatMonthDay } from "@luftuj/shared/utils/monthDay";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";

/**
 * Roční období: the feature switch (with its enable and disable dialogs) and the SeasonEditor - boundaries on a bar
 * and a row per season. Every change goes to the backend at once and refreshes everything a season can affect.
 */
export function SeasonsSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Shares the ["seasons"] cache with the timeline page, so a change here shows there without a reload.
  const { data, isLoading: loading } = useQuery({
    queryKey: ["seasons"],
    queryFn: fetchSeasons,
    staleTime: 30 * 1000,
  });

  const seasons: SeasonSummary[] = useMemo(() => data?.seasons ?? [], [data]);
  const featureEnabled = data?.featureEnabled ?? false;
  const activeSeason = featureEnabled
    ? seasons.find((season) => season.id === data?.activeSeasonId)
    : undefined;

  const [enableOpen, setEnableOpen] = useState(false);
  const [cloneCurrent, setCloneCurrent] = useState(true);
  const [disableOpen, setDisableOpen] = useState(false);
  const [keepSeasonKey, setKeepSeasonKey] = useState<SeasonKey>("spring");
  const [impact, setImpact] = useState<DisableImpact[]>([]);
  const [renaming, setRenaming] = useState<SeasonSummary | null>(null);

  /** Everything a season change can move: the list, and the timeline's events and modes (the active season). */
  const reload = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["seasons"] }),
      queryClient.invalidateQueries({ queryKey: ["timeline-events"] }),
      queryClient.invalidateQueries({ queryKey: ["timeline-modes"] }),
    ]);
  }, [queryClient]);

  const reportFailure = useCallback(
    (error: unknown) => {
      notify({
        variant: "error",
        title: t("settings.seasons.errorTitle"),
        message: translateApiError(error, t),
      });
    },
    [t],
  );

  function toggleFeature(next: boolean) {
    if (next) {
      setEnableOpen(true);
      return;
    }
    // The running season is the natural one to keep.
    const keep = activeSeason?.seasonKey ?? keepSeasonKey;
    setKeepSeasonKey(keep);
    void fetchDisableImpact(keep)
      .then((preview) => {
        setImpact(preview.seasons);
        setDisableOpen(true);
      })
      .catch(reportFailure);
  }

  async function confirmEnable() {
    // The dialog's dry run: parked seasons come back as they were, so "a copy everywhere" would not be true.
    const restored = queryClient.getQueryData<EnablePreview>([
      "seasons-enable-preview",
    ])?.restoresParked;
    let message = t("settings.seasons.enabledEmpty");
    if (restored) message = t("settings.seasons.enabledRestored");
    else if (cloneCurrent) message = t("settings.seasons.enabledCloned");
    setBusy(true);
    try {
      await enableSeasons(cloneCurrent);
      await reload();
      setEnableOpen(false);
      notify({ variant: "success", title: t("settings.seasons.enabledTitle"), message });
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable() {
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
  }

  async function patchSeason(
    key: SeasonKey,
    patch: { enabled?: boolean; spanStart?: string; name?: string | null },
  ) {
    setBusy(true);
    try {
      await updateSeason(key, patch);
      return true;
    } catch (error) {
      reportFailure(error);
      return false;
    } finally {
      // Also after a refusal: the editor falls back to the boundaries the server kept.
      await reload();
      setBusy(false);
    }
  }

  function changeKeep(key: SeasonKey) {
    setKeepSeasonKey(key);
    void fetchDisableImpact(key)
      .then((preview) => setImpact(preview.seasons))
      .catch(reportFailure);
  }

  return (
    <SettingsSection
      value="seasons"
      index="03"
      icon={IconLeaf}
      title={t("settings.seasons.title")}
      description={t("settings.seasons.description")}
      summary={
        activeSeason ? (
          <SummaryChip tone="success">
            {t("settings.seasons.summary", {
              season: seasonLabel(activeSeason, t),
              end: formatMonthDay(activeSeason.spanEnd, i18n.language),
            })}
          </SummaryChip>
        ) : (
          <SummaryChip>{t("settings.seasons.off")}</SummaryChip>
        )
      }
    >
      <Switch
        label={t("settings.seasons.use")}
        checked={featureEnabled}
        disabled={loading || busy}
        onCheckedChange={toggleFeature}
      />
      {loading && <Skeleton className="h-[220px] rounded-lg" />}
      {featureEnabled && !loading && (
        <SeasonEditor
          seasons={seasons}
          activeSeasonId={data?.activeSeasonId ?? undefined}
          busy={busy}
          onStartChange={(key, spanStart) => void patchSeason(key, { spanStart })}
          onEnabledChange={(key, enabled) => void patchSeason(key, { enabled })}
          onRename={setRenaming}
        />
      )}

      <RenameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        legend={t("settings.seasons.renameLegend")}
        title={t("settings.seasons.renameTitle")}
        label={t("settings.customTimelines.nameLabel")}
        defaultValue={renaming ? seasonLabel(renaming, t) : ""}
        defaultName={renaming ? t(`settings.seasons.names.${renaming.seasonKey}`) : undefined}
        busy={busy}
        onSave={(name) => {
          if (!renaming) return;
          void patchSeason(renaming.seasonKey, { name }).then((ok) => {
            if (ok) setRenaming(null);
          });
        }}
      />
      <EnableSeasonsDialog
        open={enableOpen}
        onOpenChange={setEnableOpen}
        cloneCurrent={cloneCurrent}
        onCloneCurrentChange={setCloneCurrent}
        busy={busy}
        onConfirm={() => void confirmEnable()}
      />
      <DisableSeasonsDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        seasons={seasons}
        activeSeasonId={data?.activeSeasonId ?? undefined}
        keepSeasonKey={keepSeasonKey}
        onKeepChange={changeKeep}
        impact={impact}
        busy={busy}
        onConfirm={() => void confirmDisable()}
      />
    </SettingsSection>
  );
}
