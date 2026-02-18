import {
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
  ActionIcon,
  Slider,
  Box,
  Divider,
  Center,
  Flex,
} from "@mantine/core";
import {
  IconBolt,
  IconClock,
  IconPlayerPlay,
  IconX,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useState, useEffect, useCallback } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "../../types/timeline";
import { activateBoost, cancelBoost, fetchActiveBoost } from "../../api/timeline";
import { notifications } from "@mantine/notifications";
import { logger } from "../../utils/logger";

interface BoostButtonsProps {
  modes: Mode[];
  t: TFunction;
  activeUnitId?: string;
}

const INFINITE_DURATION = 999999;

export function BoostButtons({ modes, t, activeUnitId }: BoostButtonsProps) {
  const boostModes = modes.filter((m) => m.isBoost);
  const [duration, setDuration] = useState<number>(15);
  const [activeBoost, setActiveBoost] = useState<{
    modeId: number;
    endTime: string;
    durationMinutes: number;
  } | null>(null);
  const [remainingMinutes, setRemainingMinutes] = useState<number>(0);
  const [loadingModeId, setLoadingModeId] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const displayMinutes = activeBoost ? remainingMinutes : duration;

  const refreshActiveBoost = useCallback(async function refreshActiveBoost() {
    try {
      const active = await fetchActiveBoost();
      setActiveBoost(active);
    } catch (err) {
      logger.error("Failed to fetch active boost", { err });
    }
  }, []);

  useEffect(() => {
    refreshActiveBoost().catch((err) =>
      logger.error("Failed to refresh active boost on mount", { err }),
    );
    const interval = setInterval(refreshActiveBoost, 10000);
    return () => clearInterval(interval);
  }, [refreshActiveBoost]);

  useEffect(() => {
    if (!activeBoost) {
      setRemainingMinutes(0);
      return;
    }

    function calc() {
      const diff = new Date(activeBoost?.endTime ?? 0).getTime() - Date.now();
      const mins = Math.max(0, Math.ceil(diff / 60000));
      setRemainingMinutes(mins);
      if (mins === 0) {
        setActiveBoost(null);
      }
    }

    calc();
    const interval = setInterval(calc, 10000);
    return () => clearInterval(interval);
  }, [activeBoost]);

  async function handleActivate(modeId: number) {
    setLoadingModeId(modeId);
    try {
      const active = await activateBoost(modeId, duration, activeUnitId);

      const diff = new Date(active.endTime).getTime() - Date.now();
      const mins = Math.max(0, Math.ceil(diff / 60000));
      setRemainingMinutes(mins);
      setActiveBoost(active);

      notifications.show({
        title: t("dashboard.boostTitle"),
        message: t("dashboard.boostActive", { minutes: duration }),
        color: "green",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("settings.timeline.notifications.unknown");
      notifications.show({
        title: t("valves.alertTitle"),
        message,
        color: "red",
      });
    } finally {
      setLoadingModeId(null);
    }
  }

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await cancelBoost();
      setRemainingMinutes(0);
      setActiveBoost(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("settings.timeline.notifications.unknown");
      notifications.show({
        title: t("valves.alertTitle"),
        message,
        color: "red",
      });
    } finally {
      setIsCancelling(false);
    }
  }

  if (boostModes.length === 0) return null;

  return (
    <Card withBorder radius="lg" padding="xl">
      <Stack gap="xl">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="md">
            <Box
              style={{
                padding: 8,
                borderRadius: 12,
                backgroundColor: "var(--mantine-color-orange-light)",
                display: "flex",
              }}
            >
              <IconBolt size={24} color="orange" stroke={2.5} />
            </Box>
            <Stack gap={0}>
              <Title order={3} fw={800} style={{ letterSpacing: -0.5 }}>
                {t("dashboard.boostTitle", { defaultValue: "Quick Boost" })}
              </Title>
              <Text size="xs" c="dimmed" fw={500}>
                {t("dashboard.boostDescription", {
                  defaultValue: "Temporary overrides for the official schedule.",
                })}
              </Text>
            </Stack>
          </Group>

          {activeBoost && (
            <Button
              variant="light"
              color="red"
              leftSection={<IconX size={16} />}
              onClick={handleCancel}
              radius="md"
              size="sm"
              loading={isCancelling}
            >
              {t("dashboard.boostCancel", { defaultValue: "Cancel Boost" })}
            </Button>
          )}
        </Group>

        <Divider style={{ opacity: 0.1 }} />

        <Flex direction={{ base: "column", md: "row" }} gap="xl" justify="center" align="center">
          <Card
            withBorder
            radius="xl"
            p="lg"
            variant="light"
            shadow="none"
            w={{ base: "100%", md: 360 }}
          >
            <Stack gap="md">
              <Stack gap="xs">
                <Group gap="xs">
                  <IconClock
                    size={16}
                    color={activeBoost ? "orange" : "var(--mantine-color-dimmed)"}
                  />
                  <Text size="sm" fw={700} c={activeBoost ? "orange" : "dimmed"} tt="uppercase">
                    {activeBoost
                      ? t("dashboard.boostTimeRemaining", { defaultValue: "Time Remaining" })
                      : t("dashboard.boostSetDuration", { defaultValue: "Set Duration" })}
                  </Text>
                </Group>

                {!activeBoost && (
                  <Group
                    gap={6}
                    justify="center"
                    style={{ flexWrap: "wrap", maxWidth: 280 }}
                    mx="auto"
                  >
                    {[5, 15, 30, 60, 120, INFINITE_DURATION].map((v) => (
                      <Button
                        key={v}
                        variant={duration === v ? "filled" : "default"}
                        color="orange"
                        size="xs"
                        radius="md"
                        disabled={loadingModeId !== null || isCancelling}
                        onClick={() => setDuration(v)}
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          minWidth: 40,
                          height: 30,
                          padding: "0 4px",
                          transition: "all 0.2s ease",
                        }}
                      >
                        {v === INFINITE_DURATION
                          ? "∞"
                          : v >= 60
                            ? v % 60 === 0
                              ? `${v / 60}h`
                              : `${v / 60}h`
                            : v}
                      </Button>
                    ))}
                  </Group>
                )}
              </Stack>

              <Center h={100}>
                <Group gap="xl" align="center">
                  {!activeBoost && duration !== INFINITE_DURATION && (
                    <ActionIcon
                      variant="subtle"
                      color="orange"
                      onClick={() => setDuration((d) => Math.max(1, d - 1))}
                      size="lg"
                      radius="xl"
                    >
                      <IconMinus size={22} />
                    </ActionIcon>
                  )}

                  <Stack gap={0} align="center">
                    <Text
                      size="xl"
                      fw={900}
                      style={{
                        fontSize: 52,
                        lineHeight: 0.8,
                        letterSpacing: -2,
                        color: activeBoost ? "var(--mantine-color-orange-6)" : "inherit",
                      }}
                    >
                      {activeBoost
                        ? activeBoost.durationMinutes === INFINITE_DURATION
                          ? "∞"
                          : displayMinutes
                        : duration === INFINITE_DURATION
                          ? "∞"
                          : displayMinutes}
                    </Text>
                    <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt={10}>
                      {t("dashboard.boostMinutes", { defaultValue: "minutes" })}
                    </Text>
                  </Stack>

                  {!activeBoost && duration !== INFINITE_DURATION && (
                    <ActionIcon
                      variant="subtle"
                      color="orange"
                      onClick={() => setDuration((d) => Math.min(240, d + 1))}
                      size="lg"
                      radius="xl"
                    >
                      <IconPlus size={22} />
                    </ActionIcon>
                  )}
                </Group>
              </Center>

              {(!activeBoost || activeBoost.durationMinutes !== INFINITE_DURATION) && (
                <Slider
                  value={
                    (activeBoost ? remainingMinutes : duration) === INFINITE_DURATION
                      ? 481
                      : activeBoost
                        ? remainingMinutes
                        : duration
                  }
                  onChange={(val) => {
                    if (activeBoost) return;
                    setDuration(val === 481 ? INFINITE_DURATION : val);
                  }}
                  min={activeBoost ? 0 : 1}
                  max={activeBoost ? activeBoost.durationMinutes : 481}
                  step={1}
                  label={null}
                  size="lg"
                  color="orange"
                  disabled={!!activeBoost || loadingModeId !== null || isCancelling}
                  styles={{
                    thumb: {
                      borderWidth: 2,
                      padding: 3,
                      width: 22,
                      height: 22,
                      display: activeBoost ? "none" : "block",
                    },
                    track: { backgroundColor: "rgba(255,255,255,0.15)" },
                  }}
                />
              )}
            </Stack>
          </Card>

          <Stack gap="md" style={{ flex: 1 }} align="center">
            <Group gap="xs" w="100%" justify="center">
              <IconPlayerPlay
                size={16}
                color={activeBoost ? "orange" : "var(--mantine-color-dimmed)"}
              />
              <Text size="sm" fw={700} c={activeBoost ? "orange" : "dimmed"} tt="uppercase">
                {activeBoost
                  ? t("dashboard.boostActiveMode", { defaultValue: "Active Mode" })
                  : t("dashboard.boostSelectMode", { defaultValue: "Select Mode" })}
              </Text>
            </Group>

            <Flex wrap="wrap" gap="md" justify="center" align="center">
              {boostModes.map((m) => {
                const isActive = activeBoost?.modeId === m.id;
                return (
                  <Button
                    key={m.id}
                    variant={isActive || loadingModeId === m.id ? "filled" : "light"}
                    color={isActive || loadingModeId === m.id ? "orange" : "blue"}
                    radius="24px"
                    disabled={
                      (activeBoost !== null && !isActive) || loadingModeId !== null || isCancelling
                    }
                    loading={loadingModeId === m.id}
                    loaderProps={{ type: "bars", size: "md" }}
                    onClick={() => (isActive ? handleCancel() : handleActivate(m.id))}
                    style={{
                      width: 130,
                      height: 130,
                      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                      padding: 16,
                      opacity:
                        (activeBoost !== null && !isActive) ||
                        (loadingModeId !== null && loadingModeId !== m.id)
                          ? 0.3
                          : 1,
                      transform: isActive || loadingModeId === m.id ? "scale(1.05)" : "scale(1)",
                      boxShadow:
                        isActive || loadingModeId === m.id
                          ? "0 10px 40px rgba(255, 165, 0, 0.3)"
                          : "none",
                    }}
                  >
                    <Stack gap={10} align="center" justify="center" h="100%" w="100%">
                      <IconPlayerPlay
                        size={32}
                        fill="currentColor"
                        style={{ opacity: isActive ? 1 : 0.6 }}
                      />
                      <Text
                        fw={800}
                        size="sm"
                        ta="center"
                        style={{ lineHeight: 1.2, whiteSpace: "normal" }}
                      >
                        {m.name}
                      </Text>
                    </Stack>
                  </Button>
                );
              })}
            </Flex>
          </Stack>
        </Flex>
      </Stack>
    </Card>
  );
}
