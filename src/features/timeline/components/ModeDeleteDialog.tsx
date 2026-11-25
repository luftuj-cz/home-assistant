import { IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchSeasons } from "@luftuj/features/settings/seasonsApi";
import { fetchModeUsage, type ModeUsage } from "@luftuj/features/timeline/api";
import type { Mode } from "@luftuj/shared/types/timeline";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";
import { Dot } from "@luftuj/shared/ui/dot";
import { Spinner } from "@luftuj/shared/ui/spinner";
import { Well } from "@luftuj/shared/ui/well";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";

interface ModeDeleteDialogProps {
  mode: Mode | null;
  unitId?: string;
  onCancel: () => void;
  onConfirm: (id: number) => void;
}

/**
 * Smazat mód (replaces ModeDeleteConfirm). Mode identity is shared, so deleting one also removes events in seasons
 * the user is not looking at: this lists the events per season and custom plan first, says when a running plan
 * would stop, and names seasons that would be left with no schedule. The delete waits for that report.
 */
export function ModeDeleteDialog({
  mode,
  unitId,
  onCancel,
  onConfirm,
}: Readonly<ModeDeleteDialogProps>) {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<ModeUsage | null>(null);
  const { data: seasonsData } = useQuery({
    queryKey: ["seasons"],
    queryFn: fetchSeasons,
    staleTime: 30 * 1000,
  });
  // The usage report carries season keys; the names the user gave them live here.
  function nameOf(seasonKey: string): string {
    const season = seasonsData?.seasons.find((candidate) => candidate.seasonKey === seasonKey);
    return seasonLabel(season ?? { seasonKey }, t);
  }

  useEffect(() => {
    if (!mode) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    void fetchModeUsage(mode.id, unitId)
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      // A failed dry run must not block the deletion, only leave it unexplained.
      .catch(() => {
        if (!cancelled) setUsage({ seasons: [], customTimelines: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, unitId]);

  const affected = (usage?.seasons ?? []).filter((entry) => entry.enabledEvents > 0);
  const emptied = (usage?.seasons ?? []).filter((entry) => entry.wouldBeLeftEmpty);
  const customAffected = usage?.customTimelines ?? [];
  const endsOverride = customAffected.find((entry) => entry.isOverriding && entry.wouldBeLeftEmpty);

  let report = (
    <div className="flex items-center gap-2.5">
      <Spinner size={18} />
      <span className="body text-muted-foreground">{t("settings.timeline.modeDeleteLoading")}</span>
    </div>
  );
  if (usage && affected.length === 0 && customAffected.length === 0) {
    report = (
      <p className="body text-muted-foreground">{t("settings.timeline.modeDeleteNoEvents")}</p>
    );
  } else if (usage) {
    report = (
      <Well legend={t("settings.timeline.modeDeleteUsage")}>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {affected.map((entry) => (
            <li key={entry.timelineId} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <Dot color={`var(--season-${entry.seasonKey})`} />
                <span className="body truncate">{nameOf(entry.seasonKey)}</span>
              </span>
              <span className="code text-muted-foreground">{entry.enabledEvents}</span>
            </li>
          ))}
          {customAffected.map((entry) => (
            <li
              key={`custom-${entry.customTimelineId}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Dot tone="plan" />
                <span className="body truncate">{entry.name}</span>
              </span>
              <span className="code text-muted-foreground">{entry.enabledEvents}</span>
            </li>
          ))}
        </ul>
      </Well>
    );
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent size="sm" tone="danger">
        <DialogHeader
          legend={t("settings.timeline.modeDeleteConfirm")}
          title={
            <span className="inline-flex items-center gap-2">
              <Dot color={mode?.color ?? "var(--mode-8)"} />
              {t("settings.timeline.modeDeleteTitle", { name: mode?.name ?? "" })}
            </span>
          }
        />
        <DialogBody>
          <p className="body">{t("settings.timeline.modeDeleteBody")}</p>
          {report}
          {endsOverride && (
            <Alert variant="plan">
              {t("settings.customTimelines.modeDeleteEndsOverride", { name: endsOverride.name })}
            </Alert>
          )}
          {emptied.length > 0 && (
            <Alert variant="destructive">
              {t("settings.timeline.modeDeleteEmptyWarning", {
                seasons: emptied.map((entry) => nameOf(entry.seasonKey)).join(", "),
              })}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button
            variant="destructive"
            icon={IconTrash}
            disabled={usage === null}
            onClick={() => mode && onConfirm(mode.id)}
          >
            {t("settings.timeline.modeDeleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
