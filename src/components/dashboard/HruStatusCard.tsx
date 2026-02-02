import { Badge, Card, Group, Progress, Stack, Text, Title, ThemeIcon } from "@mantine/core";
import {
  IconFlame,
  IconThermometer,
  IconCheck,
  IconSettings,
  IconRefresh,
  IconAlertCircle,
} from "@tabler/icons-react";
import type { HruState } from "../../hooks/useDashboardStatus";
import type { TFunction } from "i18next";

interface HruStatusCardProps {
  status: HruState;
  hruName?: string | null;
  t: TFunction;
}

export function HruStatusCard({ status, hruName, t }: HruStatusCardProps) {
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
  const powerUnit = status.registers?.power?.unit ?? "%";
  const tempValue = status.temperature;
  const tempUnit = status.registers?.temperature?.unit ?? "°C";
  const modeValue = status.mode;

  return (
    <Card shadow="sm" padding="lg" withBorder radius="md">
      <Group justify="space-between" align="flex-start" mb="xl">
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

      <Stack gap="lg">
        <Card shadow="none" padding="md" withBorder radius="md" variant="light">
          <Group justify="space-between" align="flex-start" mb="xs">
            <Text size="sm" fw={500} c="dimmed">
              {t("hru.power")}
            </Text>
            <Text size="lg" fw={700} c="teal">
              {powerValue}
              {powerUnit}
            </Text>
          </Group>
          <Progress
            value={Math.max(0, Math.min(100, powerValue))}
            color="teal"
            size="xl"
            radius="xl"
          />
        </Card>

        <Group gap="md">
          <Card
            shadow="none"
            padding="md"
            withBorder
            radius="md"
            variant="light"
            style={{ flex: 1 }}
          >
            <Stack gap={8}>
              <ThemeIcon color="blue" variant="light" size={40} radius="xl">
                <IconThermometer size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" fw={500} c="dimmed">
                  {t("hru.temperature")}
                </Text>
                <Text size="xl" fw={700} c="blue" mt={4}>
                  {tempValue}
                  {tempUnit}
                </Text>
              </div>
            </Stack>
          </Card>

          <Card
            shadow="none"
            padding="md"
            withBorder
            radius="md"
            variant="light"
            style={{ flex: 1 }}
          >
            <Stack gap={8}>
              <ThemeIcon color="grape" variant="light" size={40} radius="xl">
                <IconSettings size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" fw={500} c="dimmed">
                  {t("dashboard.hruMode", { defaultValue: "Mode" })}
                </Text>
                <Text size="lg" fw={700} c="grape" mt={4} lineClamp={1}>
                  {modeValue}
                </Text>
              </div>
            </Stack>
          </Card>
        </Group>
      </Stack>
    </Card>
  );
}
