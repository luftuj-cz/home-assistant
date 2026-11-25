import { IconCheck } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { SeasonSummary } from "@luftuj/shared/types/season";
import type { Mode } from "@luftuj/shared/types/timeline";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader } from "@luftuj/shared/ui/dialog";
import { Dot } from "@luftuj/shared/ui/dot";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";

interface ModeCoverageDialogProps {
  mode: Mode | null;
  seasons: SeasonSummary[];
  missingSeasons: SeasonSummary[];
  seasonsEnabled: boolean;
  onClose: () => void;
  onOpenSeason: (seasonId: number) => void;
}

/**
 * A mode opened on a custom timeline (replaces ModeCoverageModal). Its values belong to the seasons, so this shows
 * per season whether it has them and links there: a filled mark with a check, or a dashed amber ring and Nastavit.
 */
export function ModeCoverageDialog({
  mode,
  seasons,
  missingSeasons,
  seasonsEnabled,
  onClose,
  onOpenSeason,
}: Readonly<ModeCoverageDialogProps>) {
  const { t } = useTranslation();
  const missing = new Set(missingSeasons.map((season) => season.id));

  return (
    <Dialog open={mode !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          legend={t("settings.timeline.coverageLegend")}
          title={
            <span className="inline-flex items-center gap-2">
              <Dot color={mode?.color ?? "var(--mode-8)"} />
              {mode?.name ?? ""}
            </span>
          }
        />
        <DialogBody>
          <p className="body text-muted-foreground">
            {t("settings.customTimelines.modeValuesFromSeason")}
          </p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {seasons.map((season) => {
              const configured = !missing.has(season.id);
              return (
                <li
                  key={season.id}
                  className="flex min-h-11 items-center gap-3 rounded-md px-1"
                  style={{ "--sc": `var(--season-${season.seasonKey})` } as CSSProperties}
                >
                  <span
                    aria-hidden="true"
                    className={
                      configured
                        ? "grid size-5 flex-none place-items-center rounded-full bg-(--sc) text-background"
                        : "size-5 flex-none rounded-full border-[1.5px] border-dashed border-warning"
                    }
                  >
                    {configured && <IconCheck size={14} stroke={2} />}
                  </span>
                  <span className="label min-w-0 flex-1 truncate">
                    {seasonsEnabled
                      ? seasonLabel(season, t)
                      : t("settings.customTimelines.defaultPlan")}
                  </span>
                  {!configured && (
                    <Badge variant="warning">{t("settings.timeline.modeUnconfigured")}</Badge>
                  )}
                  <Button
                    variant={configured ? "ghost" : "secondary"}
                    size="sm"
                    onClick={() => onOpenSeason(season.id)}
                  >
                    {configured
                      ? t("settings.customTimelines.editInSeason")
                      : t("settings.customTimelines.configureInSeason")}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p role="status" className="caption text-muted-foreground">
            {missing.size > 0
              ? t("settings.timeline.coverageMissing", {
                  missing: missing.size,
                  count: seasons.length,
                })
              : t("settings.timeline.coverageAll")}
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
