import { Badge, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconCircleCheck, IconCircleDashed } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { Mode } from "@luftuj/shared/types/timeline";
import type { SeasonSummary } from "@luftuj/shared/types/season";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";

interface ModeCoverageModalProps {
  mode: Mode | null;
  seasons: SeasonSummary[];
  missingSeasons: SeasonSummary[];
  seasonsEnabled: boolean;
  onClose: () => void;
  onOpenSeason: (seasonId: number) => void;
}

/**
 * A mode opened on a custom timeline. Its values are not edited here - they
 * belong to the seasons, and a custom timeline borrows whichever season's are
 * running - so this shows where the mode is set up and links to the rest.
 */
export function ModeCoverageModal({
  mode,
  seasons,
  missingSeasons,
  seasonsEnabled,
  onClose,
  onOpenSeason,
}: Readonly<ModeCoverageModalProps>) {
  const { t } = useTranslation();
  const missing = new Set(missingSeasons.map((season) => season.id));

  return (
    <Modal
      opened={mode !== null}
      onClose={onClose}
      centered
      title={<Text fw={600}>{mode?.name ?? ""}</Text>}
    >
      <Stack gap="md">
        <Text size="sm">{t("settings.customTimelines.modeValuesFromSeason")}</Text>
        <Stack gap="xs">
          {seasons.map((season) => {
            const configured = !missing.has(season.id);
            return (
              <Group key={season.id} justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  {configured ? (
                    <IconCircleCheck size={18} color="var(--mantine-color-green-6)" />
                  ) : (
                    <IconCircleDashed size={18} color="var(--mantine-color-yellow-6)" />
                  )}
                  <Text size="sm">
                    {seasonsEnabled
                      ? seasonLabel(season, t)
                      : t("settings.customTimelines.defaultPlan")}
                  </Text>
                  {!configured && (
                    <Badge size="xs" color="yellow" variant="light">
                      {t("settings.timeline.modeUnconfigured")}
                    </Badge>
                  )}
                </Group>
                <Button size="compact-xs" variant="subtle" onClick={() => onOpenSeason(season.id)}>
                  {configured
                    ? t("settings.customTimelines.editInSeason")
                    : t("settings.customTimelines.configureInSeason")}
                </Button>
              </Group>
            );
          })}
        </Stack>
      </Stack>
    </Modal>
  );
}
