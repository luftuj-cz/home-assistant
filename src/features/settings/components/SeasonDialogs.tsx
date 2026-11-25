import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchEnablePreview } from "@luftuj/features/settings/seasonsApi";
import { SeasonBand } from "@luftuj/features/timeline/components/SeasonBand";
import type { DisableImpact, SeasonKey, SeasonSummary } from "@luftuj/shared/types/season";
import { Button } from "@luftuj/shared/ui/button";
import { Checkbox } from "@luftuj/shared/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";
import { Dot } from "@luftuj/shared/ui/dot";
import { Field } from "@luftuj/shared/ui/field";
import { RadioGroup } from "@luftuj/shared/ui/radio-group";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import { Well } from "@luftuj/shared/ui/well";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";

interface EnableSeasonsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cloneCurrent: boolean;
  onCloneCurrentChange: (clone: boolean) => void;
  busy: boolean;
  onConfirm: () => void;
}

/**
 * Zapnout roční období? Shows the boundaries enabling will produce (from the backend's dry run: this year's equinoxes
 * and solstices, or the seasons an earlier disable parked) on a SeasonBand, and offers copying today's plan into
 * every season.
 */
export function EnableSeasonsDialog({
  open,
  onOpenChange,
  cloneCurrent,
  onCloneCurrentChange,
  busy,
  onConfirm,
}: Readonly<EnableSeasonsDialogProps>) {
  const { t } = useTranslation();
  const { data, isFetching } = useQuery({
    queryKey: ["seasons-enable-preview"],
    queryFn: fetchEnablePreview,
    enabled: open,
    staleTime: 0,
  });
  // Not the preview cached from an earlier opening: the seasons may have been parked since. Confirm waits for it.
  const preview = isFetching ? undefined : data;
  // SeasonBand speaks SeasonSummary; the preview has no ids yet, so the key order stands in for them.
  const previewSeasons: SeasonSummary[] = (preview?.seasons ?? [])
    .filter((season) => season.enabled)
    .map((season, index) => ({
      ...season,
      id: index + 1,
      hruId: null,
      sortOrder: index,
      isActive: season.seasonKey === preview?.activeSeasonKey,
      unconfiguredModes: 0,
      enabledEvents: 0,
    }));
  const activeId = previewSeasons.find((season) => season.isActive)?.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          legend={t("settings.seasons.renameLegend")}
          title={t("settings.seasons.enableTitle")}
        />
        <DialogBody>
          <p className="body">
            {preview?.restoresParked
              ? t("settings.seasons.enableRestoreBody")
              : t("settings.seasons.enableBody")}
          </p>
          {preview ? (
            <SeasonBand
              seasons={previewSeasons}
              activeSeasonId={activeId}
              viewedSeasonId={activeId}
              onSeasonChange={() => undefined}
              plans={[]}
              override={null}
              onPlanChange={() => undefined}
              seasonsEnabled
              showEditLink={false}
            />
          ) : (
            <Skeleton className="h-[150px] rounded-xl" />
          )}
          <Well className="gap-1">
            <Checkbox
              checked={cloneCurrent}
              onCheckedChange={(checked) => onCloneCurrentChange(checked === true)}
              label={t("settings.seasons.cloneLabel")}
            />
            <p className="caption pl-7 text-muted-foreground">
              {t("settings.seasons.cloneDescription")}
            </p>
          </Well>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("ui.cancel")}
          </Button>
          <Button loading={busy} disabled={!preview} onClick={onConfirm}>
            {t("settings.seasons.enableConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DisableSeasonsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seasons: SeasonSummary[];
  activeSeasonId?: number;
  keepSeasonKey: SeasonKey;
  onKeepChange: (key: SeasonKey) => void;
  impact: DisableImpact[];
  busy: boolean;
  onConfirm: () => void;
}

/**
 * Vypnout období? Which season becomes the whole-year schedule (the active one preselected), and a well listing
 * what gets parked - nothing is deleted, the parked seasons come back when the feature does.
 */
export function DisableSeasonsDialog({
  open,
  onOpenChange,
  seasons,
  activeSeasonId,
  keepSeasonKey,
  onKeepChange,
  impact,
  busy,
  onConfirm,
}: Readonly<DisableSeasonsDialogProps>) {
  const { t } = useTranslation();
  const enabled = seasons.filter((season) => season.enabled);
  const parked = enabled.filter((season) => season.seasonKey !== keepSeasonKey);
  function eventsOf(season: SeasonSummary) {
    return (
      impact.find((entry) => entry.seasonKey === season.seasonKey)?.enabledEvents ??
      season.enabledEvents
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" tone="danger">
        <DialogHeader
          legend={t("settings.seasons.renameLegend")}
          title={t("settings.seasons.disableTitle")}
        />
        <DialogBody>
          <p className="body">{t("settings.seasons.disableWarning")}</p>
          <Field label={t("settings.seasons.keepLabel")}>
            <RadioGroup
              value={keepSeasonKey}
              onValueChange={(value) => onKeepChange(value as SeasonKey)}
              items={enabled.map((season) => ({
                value: season.seasonKey,
                label: seasonLabel(season, t),
                description:
                  season.id === activeSeasonId
                    ? t("settings.seasons.nowActive")
                    : t("settings.seasons.events", { count: eventsOf(season) }),
                disabled: busy,
              }))}
            />
          </Field>
          {parked.length > 0 && (
            <Well legend={t("settings.seasons.parkedLegend")}>
              <ul className="m-0 grid list-none p-0">
                {parked.map((season) => (
                  <li
                    key={season.id}
                    className="flex items-center justify-between gap-3 border-t border-border py-1.5 first:border-t-0"
                  >
                    <span className="body flex items-center gap-2">
                      <Dot color={`var(--season-${season.seasonKey})`} />
                      {seasonLabel(season, t)}
                    </span>
                    <span className="code text-muted-foreground">
                      {t("settings.seasons.events", { count: eventsOf(season) })}
                    </span>
                  </li>
                ))}
              </ul>
            </Well>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("ui.cancel")}
          </Button>
          <Button variant="destructive" loading={busy} onClick={onConfirm}>
            {t("settings.seasons.disableConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
