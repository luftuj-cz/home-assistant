import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Card, Group, Stack, Text, Title, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconPlayerPlay,
  IconPencil,
  IconX,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { translateApiError } from "@luftuj/shared/utils/apiError";
import type { CustomOverride } from "@luftuj/shared/types/customTimeline";
import {
  activateCustomOverride,
  endCustomOverride,
  fetchCustomTimelines,
} from "@luftuj/features/timeline/customTimelinesApi";
import {
  CustomOverrideModal,
  type OverrideRequest,
} from "@luftuj/features/dashboard/components/CustomOverrideModal";

function formatWhen(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3 d 4 h", "4 h 12 min" or "12 min" until `iso`, whichever reads best. */
function formatRemaining(iso: string, t: TFunction): string {
  const total = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days > 0) return t("dashboard.customOverride.remainingDays", { days, hours });
  if (hours > 0) return t("dashboard.customOverride.remainingHours", { hours, minutes });
  return t("dashboard.customOverride.remainingMinutes", { minutes });
}

/**
 * The days-to-weeks counterpart of boost: one line saying which custom
 * timeline runs instead of the schedule and until when, with a way to end it,
 * and otherwise a single button into the activation dialog. It sits on the
 * dashboard rather than the timeline page because viewing a plan must never
 * be what activates it.
 */
export function CustomOverrideCard({ unitId }: Readonly<{ unitId?: string }>) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["custom-timelines", unitId ?? "current"],
    queryFn: () => fetchCustomTimelines(unitId),
    refetchInterval: 30_000,
  });
  const timelines = data?.timelines ?? [];
  const override: CustomOverride | null = data?.override ?? null;
  const usable = timelines.some((timeline) => timeline.enabledEvents > 0);

  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["custom-timelines"] });
  }, [queryClient]);

  const fail = useCallback(
    (error: unknown) => {
      notifications.show({
        color: "red",
        title: t("dashboard.customOverride.errorTitle"),
        message: translateApiError(error, t),
      });
    },
    [t],
  );

  const activate = useCallback(
    async (request: OverrideRequest) => {
      setBusy(true);
      try {
        await activateCustomOverride(request, unitId);
        await refresh();
        setModalOpen(false);
        const name =
          timelines.find((timeline) => timeline.id === request.customTimelineId)?.name ?? "";
        notifications.show({
          color: "grape",
          title: t("dashboard.customOverride.title"),
          message: t(
            request.startsAt
              ? "dashboard.customOverride.scheduledMessage"
              : "dashboard.customOverride.activatedMessage",
            { name },
          ),
        });
      } catch (error) {
        fail(error);
      } finally {
        setBusy(false);
      }
    },
    [fail, refresh, t, timelines, unitId],
  );

  const end = useCallback(async () => {
    setBusy(true);
    try {
      await endCustomOverride(unitId);
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }, [fail, refresh, unitId]);

  // Nothing to switch on and nothing running: the feature stays out of the way.
  if (timelines.length === 0 && !override) return null;

  const scheduled = override?.phase === "scheduled";
  let headline = t("dashboard.customOverride.title");
  let detail = t("dashboard.customOverride.description");
  if (override) {
    const name = override.name ?? "?";
    headline = scheduled
      ? t("dashboard.customOverride.scheduledRow", {
          name,
          start: formatWhen(override.startsAt, i18n.language),
        })
      : t("dashboard.customOverride.activeRow", { name });
    const parts = [
      override.endsAt
        ? t("dashboard.customOverride.until", { end: formatWhen(override.endsAt, i18n.language) })
        : t("dashboard.customOverride.untilEnded"),
    ];
    if (override.endsAt && !scheduled) parts.push(formatRemaining(override.endsAt, t));
    detail = parts.join(" · ");
  }

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="md">
          <Group gap="md" wrap="nowrap" style={{ flex: "1 1 280px", minWidth: 0 }}>
            <Box
              style={{
                padding: 8,
                borderRadius: 12,
                backgroundColor: override
                  ? "var(--mantine-color-grape-filled)"
                  : "var(--mantine-color-grape-light)",
                display: "flex",
                flexShrink: 0,
              }}
            >
              <IconCalendarEvent
                size={24}
                color={override ? "white" : "var(--mantine-color-grape-6)"}
                stroke={2.5}
              />
            </Box>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Title order={4} fw={700} style={{ overflowWrap: "anywhere" }}>
                {headline}
              </Title>
              <Text size="sm" c="dimmed">
                {detail}
              </Text>
            </Stack>
          </Group>

          <Group gap="xs" wrap="nowrap" style={{ marginLeft: "auto" }}>
            {override ? (
              <>
                <Button
                  variant="subtle"
                  color="gray"
                  size="sm"
                  leftSection={<IconPencil size={16} />}
                  onClick={() => setModalOpen(true)}
                  disabled={busy || !usable}
                >
                  {t("dashboard.customOverride.change")}
                </Button>
                <Button
                  variant="light"
                  color="red"
                  size="sm"
                  leftSection={<IconX size={16} />}
                  onClick={() => void end()}
                  loading={busy}
                >
                  {scheduled
                    ? t("dashboard.customOverride.cancel")
                    : t("dashboard.customOverride.end")}
                </Button>
              </>
            ) : (
              <Tooltip
                label={t("dashboard.customOverride.noneUsable")}
                disabled={usable}
                multiline
                w={260}
              >
                <Button
                  color="grape"
                  size="sm"
                  leftSection={<IconPlayerPlay size={16} />}
                  // `data-disabled` instead of `disabled`: a disabled button
                  // swallows hover, and the tooltip explains why it is off.
                  data-disabled={!usable}
                  onClick={(event) => {
                    if (!usable) {
                      event.preventDefault();
                      return;
                    }
                    setModalOpen(true);
                  }}
                >
                  {t("dashboard.customOverride.open")}
                </Button>
              </Tooltip>
            )}
          </Group>
        </Group>

        {override?.degraded && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            {t("dashboard.customOverride.degraded")}
          </Alert>
        )}
        {override && !override.appliesToCurrentUnit && (
          <Text size="sm" c="dimmed">
            {t("dashboard.customOverride.otherUnit")}
          </Text>
        )}
      </Stack>

      <CustomOverrideModal
        opened={modalOpen}
        timelines={timelines}
        current={override}
        busy={busy}
        onClose={() => setModalOpen(false)}
        onSubmit={(request) => void activate(request)}
      />
    </Card>
  );
}
