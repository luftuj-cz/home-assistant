import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { Mode } from "@luftuj/shared/types/timeline";
import { fetchModeUsage, type ModeSeasonUsage } from "@luftuj/features/timeline/api";

interface ModeDeleteConfirmProps {
  mode: Mode | null;
  unitId?: string;
  onCancel: () => void;
  onConfirm: (id: number) => void;
}

/**
 * Deleting a mode used to happen with no confirmation at all. With seasons that
 * is worse than untidy: mode identity is shared, so the deletion also removes
 * events from seasons the user is not looking at. This shows the damage per
 * season first, and names any season that would be left with no schedule.
 */
export function ModeDeleteConfirm({
  mode,
  unitId,
  onCancel,
  onConfirm,
}: Readonly<ModeDeleteConfirmProps>) {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<ModeSeasonUsage[] | null>(null);

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
        if (!cancelled) setUsage([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, unitId]);

  const affected = (usage ?? []).filter((entry) => entry.enabledEvents > 0);
  const emptied = (usage ?? []).filter((entry) => entry.wouldBeLeftEmpty);

  return (
    <Modal
      opened={mode !== null}
      onClose={onCancel}
      centered
      title={
        <Text fw={600}>{t("settings.timeline.modeDeleteTitle", { name: mode?.name ?? "" })}</Text>
      }
    >
      <Stack gap="md">
        <Text size="sm">{t("settings.timeline.modeDeleteBody")}</Text>

        {usage === null && <Loader size="sm" />}

        {usage !== null && affected.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("settings.timeline.modeDeleteNoEvents")}
          </Text>
        )}

        {affected.length > 0 && (
          <Stack gap={2}>
            {affected.map((entry) => (
              <Text key={entry.timelineId} size="sm">
                {t("settings.timeline.modeDeleteSeasonRow", {
                  season: t(`settings.seasons.names.${entry.seasonKey}`),
                  count: entry.enabledEvents,
                })}
              </Text>
            ))}
          </Stack>
        )}

        {emptied.length > 0 && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            {t("settings.timeline.modeDeleteEmptyWarning", {
              seasons: emptied
                .map((entry) => t(`settings.seasons.names.${entry.seasonKey}`))
                .join(", "),
            })}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button color="red" onClick={() => mode && onConfirm(mode.id)}>
            {t("settings.timeline.modeDeleteConfirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
