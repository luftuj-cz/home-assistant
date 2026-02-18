import {
  Badge,
  Card,
  Group,
  RingProgress,
  Stack,
  Text,
  Title,
  ThemeIcon,
  SimpleGrid,
  Center,
} from "@mantine/core";
import {
  IconFlame,
  IconThermometer,
  IconCheck,
  IconSettings,
  IconRefresh,
  IconAlertCircle,
  IconWind,
} from "@tabler/icons-react";
import type { HruState, TemperatureUnit, ActiveMode } from "../../hooks/useDashboardStatus";
import type { TFunction } from "i18next";
import { formatTemperature, getTemperatureLabel } from "../../utils/temperature";

interface HruStatusCardProps {
  status: HruState;
  hruName?: string | null;
  t: TFunction;
  tempUnit?: TemperatureUnit;
  activeMode?: ActiveMode | null;
}

export function HruStatusCard({
  status,
  hruName,
  t,
  tempUnit = "c",
  activeMode,
}: HruStatusCardProps) {
  const title = t("dashboard.hruStatusTitle", { defaultValue: "HRU live values" });
  const displayTitle = hruName ? `${hruName}` : title;

  if (status === null) {
    return (
      <Card shadow="sm" padding="lg" withBorder radius="md">
        <Group justify="space-between" align="flex-start" mb="md">
          <Group gap="xs">
            <ThemeIcon color="blue" variant="light" size={32} radius="md">
              <IconRefresh size={18} className="mantine-rotate-animation" />
            </ThemeIcon>
            <div>
              <Title order={4}>{displayTitle}</Title>
              <Text size="xs" c="dimmed">
                {t("dashboard.haStatus.loading")}
              </Text>
            </div>
          </Group>
          <Badge color="blue" variant="light" size="lg" radius="sm">
            {t("dashboard.haStatus.loading")}
          </Badge>
        </Group>
      </Card>
    );
  }

  if ("error" in status) {
    return (
      <Card shadow="sm" padding="lg" withBorder radius="md">
        <Group justify="space-between" align="flex-start" mb="md">
          <Group gap="xs">
            <ThemeIcon color="red" variant="light" size={32} radius="md">
              <IconAlertCircle size={18} />
            </ThemeIcon>
            <div>
              <Title order={4}>{displayTitle}</Title>
              <Text size="xs" c="red" fw={500}>
                {t("dashboard.hruStatusError", { defaultValue: "Error" })}
              </Text>
            </div>
          </Group>
          <Badge color="red" variant="light" size="lg" radius="sm">
            {t("dashboard.haStatus.error")}
          </Badge>
        </Group>
        <Text size="sm" c="red" mt="sm">
          {status.error}
        </Text>
      </Card>
    );
  }

  const powerValue = Math.round(status.power);
  const rawPowerUnit = status.powerUnit ?? status.registers?.power?.unit ?? "%";
  const maxPower = status.maxPower ?? 100;
  const powerUnit = t(`app.units.${rawPowerUnit}`, { defaultValue: rawPowerUnit });

  const powerPercentage = Math.min(100, Math.max(0, (powerValue / maxPower) * 100));

  let progressColor = "teal";
  if (powerPercentage < 40) {
    progressColor = "green";
  } else if (powerPercentage < 70) {
    progressColor = "orange";
  } else {
    progressColor = "red";
  }

  const tempValue = formatTemperature(status.temperature, tempUnit);
  const displayTempUnit = getTemperatureLabel(tempUnit);
  const modeValue = status.mode;

  const capabilities = status.capabilities ?? {};
  const hasPower = capabilities.hasPowerControl !== false;
  const hasTemp = capabilities.hasTemperatureControl !== false;
  const hasMode = capabilities.hasModeControl !== false;

  const visibleItems = (hasPower || hasMode || !!activeMode ? 1 : 0) + (hasTemp ? 1 : 0);
  const gridCols = Math.max(1, Math.min(2, visibleItems));

  return (
    <Card shadow="sm" padding="0" withBorder radius="md">
      <Group justify="space-between" align="flex-start" p="lg" pb="xs">
        <Group gap="xs">
          <ThemeIcon color="grape" variant="light" size={32} radius="md">
            <IconFlame size={18} />
          </ThemeIcon>
          <div>
            <Title order={4}>{displayTitle}</Title>
            <Text size="xs" c="dimmed">
              {t("dashboard.hruStatusDescription", {
                defaultValue: "Reads HRU registers every 10 seconds",
              })}
            </Text>
          </div>
        </Group>
        <Badge
          color="green"
          variant="light"
          size="lg"
          radius="sm"
          leftSection={<IconCheck size={14} />}
        >
          {t("dashboard.hruStatusOk", { defaultValue: "OK" })}
        </Badge>
      </Group>

      {visibleItems > 0 && (
        <SimpleGrid cols={{ base: 1, sm: gridCols }} spacing="md" p="lg" pt="md">
          {(hasPower || hasMode || !!activeMode) && (
            <Stack gap="md">
              {hasPower && (
                <Card shadow="none" withBorder radius="md" p="md" variant="light">
                  <Center>
                    <RingProgress
                      size={140}
                      thickness={12}
                      roundCaps
                      sections={[{ value: powerPercentage, color: progressColor }]}
                      label={
                        <Center>
                          <Stack align="center" gap={0}>
                            <IconWind size={24} style={{ opacity: 0.7 }} />
                            <Text fw={700} size="xl" ta="center">
                              {powerValue} {powerUnit}
                            </Text>
                            <Text c="dimmed" size="xs">
                              {t("hru.power")}
                            </Text>
                          </Stack>
                        </Center>
                      }
                    />
                  </Center>
                </Card>
              )}

              {(hasMode || !!activeMode) && (
                <Card shadow="none" withBorder radius="md" p="md" variant="light">
                  <Group>
                    <ThemeIcon color="grape" variant="light" size="xl" radius="md">
                      <IconSettings size={28} />
                    </ThemeIcon>
                    <div style={{ flex: 1 }}>
                      <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                        {t("dashboard.hruMode", { defaultValue: "Mode" })}
                      </Text>
                      {activeMode ? (
                        <>
                          <Title order={3} c="grape">
                            {activeMode.source === "manual"
                              ? t("dashboard.activeMode.manual")
                              : activeMode.source === "boost"
                                ? t("dashboard.activeMode.boost", {
                                    name: activeMode.modeName || "?",
                                  })
                                : t("dashboard.activeMode.schedule", {
                                    name: activeMode.modeName || "?",
                                  })}
                          </Title>
                          {hasMode && (
                            <Text size="sm" c="dimmed" mt={4}>
                              {t("dashboard.nativeMode")}: {modeValue}
                            </Text>
                          )}
                        </>
                      ) : (
                        <Title order={3} c="grape">
                          {modeValue}
                        </Title>
                      )}
                    </div>
                  </Group>
                </Card>
              )}
            </Stack>
          )}

          {hasTemp && (
            <Card shadow="none" withBorder radius="md" p="md" variant="light">
              <Center h="100%" mih={140}>
                <Stack align="center" gap="xs">
                  <IconThermometer
                    size={32}
                    style={{ color: "var(--mantine-color-blue-filled)" }}
                  />
                  <Text
                    fw={900}
                    size="3rem"
                    variant="gradient"
                    gradient={{ from: "blue", to: "cyan", deg: 90 }}
                    style={{ lineHeight: 1 }}
                  >
                    {tempValue.toFixed(1)}
                    <Text span size="1.5rem" c="dimmed" ml={4}>
                      {displayTempUnit}
                    </Text>
                  </Text>
                  <Text c="dimmed" size="sm" tt="uppercase" fw={700}>
                    {t("hru.temperature")}
                  </Text>
                </Stack>
              </Center>
            </Card>
          )}
        </SimpleGrid>
      )}
    </Card>
  );
}
