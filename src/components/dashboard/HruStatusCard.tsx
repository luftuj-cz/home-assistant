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
  Paper,
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
  const displayTitle = hruName ? `${title} - ${hruName}` : title;

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
            Loading
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
            Error
          </Badge>
        </Group>
        <Text size="sm" c="red" mt="sm">
          {status.error}
        </Text>
      </Card>
    );
  }

  const powerValue = Math.round(status.power);
  const powerUnit = status.powerUnit ?? status.registers?.power?.unit ?? "%";
  const maxPower = status.maxPower ?? 100;

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

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" p="lg" pt="md">
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
                      {powerValue}
                      {powerUnit}
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

        <Card shadow="none" withBorder radius="md" p="md" variant="light">
          <Center h="100%" mih={140}>
            <Stack align="center" gap="xs">
              <IconThermometer size={32} style={{ color: "var(--mantine-color-blue-filled)" }} />
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
      </SimpleGrid>

      <Paper
        p="lg"
        radius="0"
        style={{
          borderTop: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-dark-6)",
        }}
        bg="var(--mantine-color-gray-light)"
      >
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
                <Title order={3} c="grape" lineClamp={1}>
                  {activeMode.source === "manual"
                    ? t("dashboard.activeMode.manual", { defaultValue: "Manual" })
                    : activeMode.source === "boost"
                      ? t("dashboard.activeMode.boost", {
                          defaultValue: "Boost: {{name}}",
                          name: activeMode.modeName || "?",
                        })
                      : t("dashboard.activeMode.schedule", {
                          defaultValue: "Schedule: {{name}}",
                          name: activeMode.modeName || "?",
                        })}
                </Title>
                <Text size="sm" c="dimmed" mt={4}>
                  {t("dashboard.nativeMode", { defaultValue: "Native mode" })}: {modeValue}
                </Text>
              </>
            ) : (
              <Title order={3} c="grape" lineClamp={1}>
                {modeValue}
              </Title>
            )}
          </div>
        </Group>
      </Paper>
    </Card>
  );
}
