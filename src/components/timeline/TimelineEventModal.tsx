import { Modal, Stack, Select, Group, Button, Text } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { IconClock, IconAdjustments, IconCalendar } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { TimelineEvent } from "../../types/timeline";
import type { HruVariable } from "../../api/hru";

interface TimelineEventModalProps {
  opened: boolean;
  event: TimelineEvent | null;
  modeOptions: { value: string; label: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onChange: (event: TimelineEvent) => void;
  t: TFunction;
  hruVariables?: HruVariable[];
}

export function TimelineEventModal({
  opened,
  event,
  modeOptions,
  saving,
  onClose,
  onSave,
  onChange,
  t,
}: TimelineEventModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconCalendar size={20} color="var(--mantine-color-luftBlue-5)" />
          <Text fw={600}>{t("settings.timeline.modal.title")}</Text>
        </Group>
      }
      size="md"
      radius="md"
    >
      {event && (
        <Stack gap="md">
          <TimeInput
            label={t("settings.timeline.form.startTime")}
            value={event.startTime}
            onChange={(e) => onChange({ ...event, startTime: e.currentTarget.value })}
            leftSection={<IconClock size={16} stroke={1.5} />}
            required
          />

          <Select
            label={t("schedule.modeSelect")}
            data={modeOptions}
            value={event.hruConfig?.mode?.toString() || null}
            onChange={(value) => {
              if (!value) return;
              onChange({
                ...event,
                hruConfig: { ...event.hruConfig, mode: value },
              });
            }}
            searchable
            allowDeselect={false}
            disabled={modeOptions.length === 0}
            placeholder={
              modeOptions.length === 0 ? t("settings.timeline.noModesCreated") : undefined
            }
            leftSection={<IconAdjustments size={16} stroke={1.5} />}
            required
            error={
              modeOptions.length === 0
                ? t("settings.timeline.noModesCreatedDescription")
                : !event.hruConfig?.mode
                  ? t("validation.modeRequired")
                  : null
            }
          />

          <Group justify="flex-end" gap="sm">
            <Button variant="light" onClick={onClose} radius="md">
              {t("settings.timeline.modal.cancel")}
            </Button>
            <Button onClick={onSave} loading={saving} radius="md" disabled={!event.hruConfig?.mode}>
              {t("settings.timeline.modal.save")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
