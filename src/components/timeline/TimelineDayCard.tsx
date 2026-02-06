import { useState } from "react";
import {
  Button,
  Card,
  Group,
  Text,
  Title,
  ActionIcon,
  Tooltip,
  Timeline,
  Box,
} from "@mantine/core";
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconCopy,
  IconClipboardCheck,
  IconClock,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { TimelineEvent, Mode } from "../../types/timeline";
import { ActionIcon as MantineActionIcon } from "@mantine/core";
import { MotionSwitch } from "../common/MotionSwitch";

interface TimelineDayCardProps {
  dayIdx: number;
  label: string;
  events: TimelineEvent[];
  modes: Mode[];
  copyDay: number | null;
  loading: boolean;
  onCopy: (day: number) => void;
  onPaste: (day: number) => void;
  onCancelCopy: () => void;
  onAdd: (day: number) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (id: number) => void;
  onToggle: (event: TimelineEvent, enabled: boolean) => void;
  onDropMode: (day: number, mode: Mode) => void;
  t: TFunction;
}

function isEventActive(ev: TimelineEvent, allDayEvents: TimelineEvent[], dayIdx: number): boolean {
  const now = new Date();
  const jsDay = now.getDay();
  const currentDayIdx = jsDay === 0 ? 6 : jsDay - 1;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  function toMins(time: string) {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  }

  if (dayIdx === currentDayIdx) {
    const startedEvents = allDayEvents.filter((e) => toMins(e.startTime) <= nowMinutes);
    if (startedEvents.length === 0) return false;
    const latest = startedEvents[startedEvents.length - 1];
    return ev.id === latest.id && ev.startTime === latest.startTime;
  }

  const yesterdayIdx = (currentDayIdx - 1 + 7) % 7;
  if (dayIdx === yesterdayIdx) {
    const isLastOfItsDay = ev === allDayEvents[allDayEvents.length - 1];
    if (!isLastOfItsDay) return false;
    return false;
  }

  return false;
}

export function TimelineDayCard({
  dayIdx,
  label,
  events,
  modes,
  copyDay,
  loading,
  onCopy,
  onPaste,
  onCancelCopy,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onDropMode,
  t,
}: TimelineDayCardProps) {
  const sortedEvents = [...events].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        try {
          const data = e.dataTransfer.getData("application/json");
          if (data) {
            const mode = JSON.parse(data) as Mode;
            onDropMode(dayIdx, mode);
          }
        } catch (err) {
          console.error("Failed to parse dropped mode", err);
        }
      }}
      style={{
        transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
        "&:hover": {
          boxShadow: "var(--mantine-shadow-md)",
          transform: "translateY(-2px)",
        },
        borderColor: isDragOver ? "var(--mantine-color-blue-filled)" : undefined,
      }}
    >
      <Group justify="space-between" mb="lg">
        <Title order={4} fw={700}>
          {label}
        </Title>
        <Group gap="xs">
          {copyDay === null ? (
            <Tooltip label={t("settings.timeline.copyDay", { defaultValue: "Copy day" })} withArrow>
              <ActionIcon variant="light" aria-label="Copy day" onClick={() => onCopy(dayIdx)}>
                <IconCopy size={16} />
              </ActionIcon>
            </Tooltip>
          ) : copyDay === dayIdx ? (
            <Tooltip label={t("settings.timeline.modal.cancel")} withArrow>
              <ActionIcon
                variant="light"
                color="red"
                aria-label="Cancel copy"
                onClick={onCancelCopy}
              >
                <IconClipboardCheck size={16} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip
              label={t("settings.timeline.pasteDay", { defaultValue: "Paste day" })}
              withArrow
            >
              <ActionIcon variant="light" aria-label="Paste day" onClick={() => onPaste(dayIdx)}>
                <IconClipboardCheck size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <Button
            size="compact-xs"
            variant="filled"
            leftSection={<IconPlus size={14} />}
            onClick={() => onAdd(dayIdx)}
            disabled={loading || modes.length === 0}
          >
            {t("settings.timeline.addEvent")}
          </Button>
        </Group>
      </Group>

      {events.length === 0 ? (
        <Box
          py="xl"
          style={{ border: "1px dashed var(--mantine-color-dimmed)", borderRadius: "8px" }}
        >
          <Text size="sm" c="dimmed" ta="center">
            {t("settings.timeline.noEvents")}
          </Text>
        </Box>
      ) : (
        <Timeline active={-1} bulletSize={24} lineWidth={2}>
          {sortedEvents.map((ev) => {
            const active = isEventActive(ev, sortedEvents, dayIdx);
            const mode = modes.find((m) => m.id.toString() === ev.hruConfig?.mode?.toString());
            const highlightColor = mode?.color || "blue";

            return (
              <Timeline.Item
                key={ev.id ?? `${ev.startTime}-${ev.hruConfig?.mode}`}
                bullet={
                  active ? (
                    <IconClock size={12} stroke={2.5} />
                  ) : (
                    <Box
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: highlightColor,
                      }}
                    />
                  )
                }
                color={highlightColor}
                title={
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <Text fw={700} size="sm">
                      {ev.startTime}
                    </Text>
                    <Group gap={6} wrap="nowrap">
                      <MotionSwitch
                        size="xs"
                        checked={ev.enabled}
                        onChange={(e) => onToggle(ev, e.currentTarget.checked)}
                      />
                      <MantineActionIcon
                        variant="subtle"
                        size="sm"
                        aria-label="Edit"
                        onClick={() => onEdit(ev)}
                      >
                        <IconEdit size={14} />
                      </MantineActionIcon>
                      <MantineActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        aria-label="Delete"
                        onClick={() => ev.id && onDelete(ev.id)}
                      >
                        <IconTrash size={14} />
                      </MantineActionIcon>
                    </Group>
                  </Group>
                }
              >
                <Card
                  withBorder={active}
                  padding="xs"
                  radius="sm"
                  variant={active ? "light" : "transparent"}
                  color={active ? highlightColor : undefined}
                  style={{
                    borderLeft: active ? `3px solid ${highlightColor}` : undefined,
                  }}
                >
                  <Text size="xs" fw={active ? 600 : 400}>
                    {t("settings.timeline.hru")}: {mode?.name ?? ev.hruConfig?.mode ?? "-"}
                  </Text>
                </Card>
              </Timeline.Item>
            );
          })}
        </Timeline>
      )}
    </Card>
  );
}
