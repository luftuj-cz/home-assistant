import type { ReactNode } from "react";
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
import { useDroppable } from "@dnd-kit/core";
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconCopy,
  IconClipboardCheck,
  IconClock,
  IconAlertTriangle,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { TimelineEvent, Mode } from "@luftuj/shared/types/timeline";
import type { ActiveEventRef } from "@luftuj/features/timeline/utils";
import { MotionSwitch } from "@luftuj/shared/ui";

export const DAY_DROP_PREFIX = "day:";

interface TimelineDayCardProps {
  dayIdx: number;
  label: string;
  events: TimelineEvent[];
  /** The event the scheduler applies now, which may belong to an earlier day. */
  activeEvent?: ActiveEventRef;
  modes: Mode[];
  copyDay: number | null;
  /** True while a day is on the clipboard, including one copied from another season. */
  copyActive: boolean;
  loading: boolean;
  onCopy: (day: number) => void;
  onPaste: (day: number) => void;
  onCancelCopy: () => void;
  onAdd: (day: number) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (id: number) => void;
  onToggle: (event: TimelineEvent, enabled: boolean) => void;
  t: TFunction;
}

export function TimelineDayCard({
  dayIdx,
  label,
  events,
  activeEvent,
  modes,
  copyDay,
  copyActive,
  loading,
  onCopy,
  onPaste,
  onCancelCopy,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  t,
}: Readonly<TimelineDayCardProps>) {
  const sortedEvents = events.toSorted((a, b) => a.startTime.localeCompare(b.startTime));
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_DROP_PREFIX}${dayIdx}` });

  let copyAction: ReactNode;
  if (!copyActive) {
    copyAction = (
      <Tooltip label={t("settings.timeline.copyDay")} withArrow>
        <ActionIcon
          variant="light"
          aria-label={t("settings.timeline.copyDay")}
          onClick={() => onCopy(dayIdx)}
        >
          <IconCopy size={16} />
        </ActionIcon>
      </Tooltip>
    );
  } else if (copyDay === dayIdx) {
    copyAction = (
      <Tooltip label={t("settings.timeline.modal.cancel")} withArrow>
        <ActionIcon
          variant="light"
          color="red"
          aria-label={t("settings.timeline.modal.cancel")}
          onClick={onCancelCopy}
        >
          <IconClipboardCheck size={16} />
        </ActionIcon>
      </Tooltip>
    );
  } else {
    copyAction = (
      <Tooltip label={t("settings.timeline.pasteDay")} withArrow>
        <ActionIcon
          variant="light"
          aria-label={t("settings.timeline.pasteDay")}
          onClick={() => onPaste(dayIdx)}
        >
          <IconClipboardCheck size={16} />
        </ActionIcon>
      </Tooltip>
    );
  }

  return (
    <Card
      ref={setNodeRef}
      withBorder
      radius="md"
      p="md"
      style={{
        borderColor: isOver ? "var(--mantine-color-blue-filled)" : undefined,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Group justify="space-between" mb="lg">
        <Title order={4} fw={700}>
          {label}
        </Title>
        <Group gap="xs">
          {copyAction}
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
          style={{
            border: "1px dashed var(--mantine-color-dimmed)",
            borderRadius: "8px",
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text size="sm" c="dimmed" ta="center">
            {t("settings.timeline.noEvents")}
          </Text>
        </Box>
      ) : (
        <Timeline active={-1} bulletSize={24} lineWidth={2}>
          {sortedEvents.map((ev) => {
            // An every-day event appears in all seven columns; it runs only in
            // the one the scheduler picked it from.
            const active =
              ev.id !== undefined &&
              ev.id === activeEvent?.id &&
              (ev.dayOfWeek !== null || dayIdx === activeEvent.day);
            const mode = modes.find((m) => m.id.toString() === ev.hruConfig?.mode?.toString());
            const highlightColor = mode?.color || "blue";
            const modeLabel =
              mode?.name ?? (typeof ev.hruConfig?.mode === "string" ? ev.hruConfig.mode : "-");

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
                    <Group gap={6} wrap="nowrap">
                      <Text fw={700} size="sm">
                        {ev.startTime}
                      </Text>
                      {/* Write-gating should make this unreachable, but a DB
                          import or a cross-season paste can still produce it,
                          and a silently inert event is worse than a marked one. */}
                      {mode?.configured === false && (
                        <Tooltip label={t("settings.timeline.eventModeUnconfigured")}>
                          <IconAlertTriangle
                            size={14}
                            color="var(--mantine-color-yellow-6)"
                            aria-label={t("settings.timeline.eventModeUnconfigured")}
                          />
                        </Tooltip>
                      )}
                    </Group>
                    <Group gap={6} wrap="nowrap">
                      <MotionSwitch
                        size="xs"
                        checked={ev.enabled}
                        onChange={(e) => onToggle(ev, e.currentTarget.checked)}
                      />
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        aria-label={t("settings.timeline.edit")}
                        onClick={() => onEdit(ev)}
                      >
                        <IconEdit size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        aria-label={t("settings.timeline.delete")}
                        onClick={() => ev.id && onDelete(ev.id)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Group>
                }
              >
                <Card
                  withBorder={active}
                  p="xs"
                  radius="sm"
                  variant={active ? "light" : "transparent"}
                  color={active ? highlightColor : undefined}
                  style={{
                    borderLeft: active ? `3px solid ${highlightColor}` : undefined,
                  }}
                >
                  <Text size="xs" fw={active ? 600 : 400}>
                    {t("settings.timeline.hru")}: {modeLabel}
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
