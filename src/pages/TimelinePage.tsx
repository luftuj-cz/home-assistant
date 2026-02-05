import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Stack, Text, Title, Button, SimpleGrid, Divider, Container } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { IconCalendar, IconCopy } from "@tabler/icons-react";

import { useTimelineModes } from "../hooks/useTimelineModes";
import { useTimelineEvents } from "../hooks/useTimelineEvents";
import { useDashboardStatus } from "../hooks/useDashboardStatus";
import { TimelineModeList } from "../components/timeline/TimelineModeList";
import { TimelineDayCard } from "../components/timeline/TimelineDayCard";
import { TimelineEventModal } from "../components/timeline/TimelineEventModal";
import { TimelineModeModal } from "../components/timeline/TimelineModeModal";

import { resolveApiUrl } from "../utils/api";
import * as hruApi from "../api/hru";
import * as valveApi from "../api/valves";
import type { TimelineEvent, Mode } from "../types/timeline";
import type { Valve } from "../types/valve";

export function TimelinePage() {
  const { t } = useTranslation();

  const { modes, loadModes, saveMode, deleteMode, savingMode } = useTimelineModes(t);
  const {
    eventsByDay,
    loadEvents,
    saveEvent,
    deleteEvent,
    saving: savingEvent,
  } = useTimelineEvents(modes, t);

  const { tempUnit } = useDashboardStatus();

  const [loading, setLoading] = useState(false);

  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);

  const [copyDay, setCopyDay] = useState<number | null>(null);

  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [editingMode, setEditingMode] = useState<Mode | null>(null);

  const [valves, setValves] = useState<Valve[]>([]);
  const [hruCapabilities, setHruCapabilities] = useState<
    Pick<hruApi.HruUnit, "capabilities">["capabilities"]
  >({});
  const [powerUnit, setPowerUnit] = useState<string>("%");
  const [maxPower, setMaxPower] = useState<number>(100);
  const [activeUnitId, setActiveUnitId] = useState<string | undefined>(undefined);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const valves = await valveApi.fetchValves().catch(() => []);
        setValves(valves);

        const [settingsRes, units] = await Promise.all([
          fetch(resolveApiUrl("/api/settings/hru")).then(
            (r) => r.json() as Promise<{ unit?: string }>,
          ),
          hruApi.fetchHruUnits().catch(() => []),
        ]);

        const activeUnit = units.find((u) => u.id === settingsRes.unit) || units[0];
        const unitId = activeUnit?.id;
        setActiveUnitId(unitId);

        if (activeUnit) {
          setHruCapabilities(activeUnit.capabilities || {});
          setPowerUnit(activeUnit.controlUnit || "%");
          setMaxPower(activeUnit.maxValue || 100);
        }

        // Now load modes and events with the explicit unitId
        await Promise.all([loadModes(unitId), loadEvents(unitId)]);
      } catch (err) {
        console.error("Failed to load HRU context:", err);
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [loadModes, loadEvents]);

  const dayLabels = useMemo(
    () => [
      t("settings.timeline.monday"),
      t("settings.timeline.tuesday"),
      t("settings.timeline.wednesday"),
      t("settings.timeline.thursday"),
      t("settings.timeline.friday"),
      t("settings.timeline.saturday"),
      t("settings.timeline.sunday"),
    ],
    [t],
  );

  const dayOrder = useMemo(() => [0, 1, 2, 3, 4, 5, 6], []);

  useEffect(() => {
    if (copyDay !== null) {
      notifications.show({
        id: "copy-hint",
        icon: <IconCopy size={16} />,
        title: t("settings.timeline.copying", {
          defaultValue: "Copying",
          day: dayLabels[copyDay],
        }),
        message: (
          <Stack gap="xs">
            <Text size="xs">
              {t("settings.timeline.copyHint", {
                defaultValue: "Select a day to paste events.",
              })}
            </Text>
            <Button
              size="compact-xs"
              variant="light"
              color="gray"
              fullWidth
              onClick={() => setCopyDay(null)}
            >
              {t("settings.timeline.modal.cancel")}
            </Button>
          </Stack>
        ),
        autoClose: false,
        withCloseButton: false,
        color: "blue",
        loading: true,
      });
    } else {
      notifications.hide("copy-hint");
    }
  }, [copyDay, dayLabels, t]);

  const modeOptions = useMemo(() => {
    return modes.map((m) => ({ value: m.id.toString(), label: m.name }));
  }, [modes]);

  const handleAddEvent = useCallback(
    (day: number) => {
      const startTime = "08:00";

      setEditingEvent({
        startTime,
        dayOfWeek: day,
        hruConfig: { mode: modes[0]?.id?.toString() },
        enabled: true,
      });
      setEventModalOpen(true);
    },
    [modes],
  );

  const handleEditEvent = useCallback((event: TimelineEvent) => {
    setEditingEvent(event);
    setEventModalOpen(true);
  }, []);

  const handleSaveEvent = useCallback(async () => {
    if (editingEvent) {
      if (!editingEvent.hruConfig?.mode) {
        notifications.show({
          title: t("settings.timeline.notifications.validationFailedTitle"),
          message: t("validation.modeRequired", { defaultValue: "Mode is required" }),
          color: "red",
        });
        return;
      }
      const success = await saveEvent(editingEvent);
      if (success) {
        setEventModalOpen(false);
        setEditingEvent(null);
      }
    }
  }, [editingEvent, saveEvent, t]);

  const handleToggleEvent = useCallback(
    (event: TimelineEvent, enabled: boolean) => {
      void saveEvent({ ...event, enabled });
    },
    [saveEvent],
  );

  const handlePasteDay = useCallback(
    async (targetDay: number) => {
      if (copyDay === null) return;
      const source = eventsByDay.get(copyDay) ?? [];
      for (const ev of source) {
        await saveEvent({
          startTime: ev.startTime,
          dayOfWeek: targetDay,
          hruConfig: ev.hruConfig,
          luftatorConfig: ev.luftatorConfig,
          enabled: ev.enabled,
        });
      }
      setCopyDay(null);
      notifications.show({
        title: t("settings.timeline.notifications.saveSuccessTitle"),
        message: t("settings.timeline.pasteDay", { defaultValue: "Events pasted" }),
        color: "green",
      });
    },
    [copyDay, eventsByDay, saveEvent, t],
  );

  const handleAddMode = useCallback(() => {
    setEditingMode(null);
    setModeModalOpen(true);
  }, []);

  const handleEditMode = useCallback((mode: Mode) => {
    setEditingMode(mode);
    setModeModalOpen(true);
  }, []);

  const handleSaveMode = useCallback(
    async (modeData: Partial<Mode>) => {
      const success = await saveMode(modeData);
      if (success) {
        setModeModalOpen(false);
        setEditingMode(null);
      }
    },
    [saveMode],
  );

  const handleDeleteMode = useCallback(
    async (id: number) => {
      const success = await deleteMode(id);
      if (success) {
        void loadEvents(activeUnitId);
      }
    },
    [deleteMode, loadEvents, activeUnitId],
  );

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap={0}>
          <Group gap="sm">
            <IconCalendar size={32} color="var(--mantine-primary-color-5)" />
            <Title order={1}>{t("settings.timeline.title")}</Title>
          </Group>
          <Text size="lg" c="dimmed" mt="xs">
            {t("settings.timeline.description")}
          </Text>
        </Stack>

        <TimelineModeList
          modes={modes}
          onAdd={handleAddMode}
          onEdit={handleEditMode}
          onDelete={handleDeleteMode}
          t={t}
          powerUnit={powerUnit}
          temperatureUnit={tempUnit}
        />

        <Stack gap="md">
          <Divider
            label={
              <Group gap="xs">
                <Text fw={700} size="sm">
                  Weekly Schedule
                </Text>
              </Group>
            }
            labelPosition="left"
          />
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="lg">
            {dayOrder.map((dayIdx) => (
              <TimelineDayCard
                key={dayIdx}
                dayIdx={dayIdx}
                label={dayLabels[dayIdx]}
                events={eventsByDay.get(dayIdx) ?? []}
                modes={modes}
                copyDay={copyDay}
                loading={loading}
                onCopy={setCopyDay}
                onPaste={handlePasteDay}
                onCancelCopy={() => setCopyDay(null)}
                onAdd={handleAddEvent}
                onEdit={handleEditEvent}
                onDelete={deleteEvent}
                onToggle={handleToggleEvent}
                t={t}
              />
            ))}
          </SimpleGrid>
        </Stack>

        <TimelineEventModal
          opened={eventModalOpen}
          event={editingEvent}
          modeOptions={modeOptions}
          saving={savingEvent}
          onClose={() => {
            setEventModalOpen(false);
            setEditingEvent(null);
          }}
          onSave={handleSaveEvent}
          onChange={setEditingEvent}
          t={t}
          hruCapabilities={hruCapabilities}
        />

        <TimelineModeModal
          opened={modeModalOpen}
          mode={editingMode}
          valves={valves}
          saving={savingMode}
          onClose={() => setModeModalOpen(false)}
          onSave={handleSaveMode}
          t={t}
          hruCapabilities={hruCapabilities}
          powerUnit={powerUnit}
          temperatureUnit={tempUnit}
          maxPower={maxPower}
        />
      </Stack>
    </Container>
  );
}
