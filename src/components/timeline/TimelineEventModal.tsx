import { Modal, Stack, TextInput, Select, Divider, Group, Button, Text } from "@mantine/core";
import { IconClock, IconAdjustments, IconCalendar } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { TimelineEvent } from "../../types/timeline";

interface TimelineEventModalProps {
  opened: boolean;
  event: TimelineEvent | null;
  modeOptions: { value: string; label: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onChange: (event: TimelineEvent) => void;
  t: TFunction;
  hruCapabilities?: {
    hasModeControl?: boolean;
    hasPowerControl?: boolean;
    hasTemperatureControl?: boolean;
  };
}

const TIME_REGEX = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

export function TimelineEventModal({
  opened,
  event,
  modeOptions,
  saving,
  onClose,
  onSave,
  onChange,
  t,
  hruCapabilities,
}: TimelineEventModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconCalendar size={20} color="var(--mantine-primary-color-5)" />
          <Text fw={600}>{t("settings.timeline.modal.title")}</Text>
        </Group>
      }
      size="md"
      radius="md"
    >
      {event && (
        <Stack gap="md">
          <Group grow>
            <TextInput
              label={t("settings.timeline.form.startTime")}
              placeholder="08:00"
              value={event.startTime}
              type="time"
              onChange={(e) => onChange({ ...event, startTime: e.target.value })}
              pattern={TIME_REGEX.source}
              leftSection={<IconClock size={16} stroke={1.5} />}
              required
            />
          </Group>

          {(hruCapabilities?.hasModeControl !== false ||
            hruCapabilities?.hasPowerControl !== false ||
            hruCapabilities?.hasTemperatureControl !== false) && (
            <Select
              label={t("schedule.modeSelect", { defaultValue: "Select mode" })}
              data={modeOptions}
              value={event.hruConfig?.mode?.toString() || null}
              onChange={(value) => {
                if (!value) return;
                onChange({
                  ...event,
                  hruConfig: { ...(event.hruConfig ?? {}), mode: value },
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
                    ? t("validation.modeRequired", { defaultValue: "Mode is required" })
                    : null
              }
            />
          )}

          <Divider mt="xs" />

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
