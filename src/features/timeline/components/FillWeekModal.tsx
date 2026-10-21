import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { Mode } from "@luftuj/shared/types/timeline";

interface FillWeekModalProps {
  opened: boolean;
  /** Only modes usable on a custom timeline: configured in every enabled season. */
  modes: Mode[];
  existingEvents: number;
  saving: boolean;
  onClose: () => void;
  onConfirm: (modeId: number) => void;
}

/**
 * "Run this mode the whole time": a new custom timeline starts empty, and for a
 * holiday one mode for the whole week is often all it needs.
 */
export function FillWeekModal({
  opened,
  modes,
  existingEvents,
  saving,
  onClose,
  onConfirm,
}: Readonly<FillWeekModalProps>) {
  const { t } = useTranslation();
  const [modeId, setModeId] = useState<string | null>(null);

  useEffect(() => {
    if (opened) setModeId(null);
  }, [opened]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={<Text fw={600}>{t("settings.customTimelines.fillTitle")}</Text>}
    >
      <Stack gap="md">
        <Text size="sm">{t("settings.customTimelines.fillBody")}</Text>
        <Select
          label={t("settings.customTimelines.fillMode")}
          data={modes.map((mode) => ({ value: String(mode.id), label: mode.name }))}
          value={modeId}
          onChange={setModeId}
          comboboxProps={{ withinPortal: true }}
        />
        {existingEvents > 0 && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            {t("settings.customTimelines.fillReplaces", { count: existingEvents })}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button
            onClick={() => modeId && onConfirm(Number(modeId))}
            disabled={!modeId}
            loading={saving}
          >
            {t("settings.customTimelines.fillConfirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
