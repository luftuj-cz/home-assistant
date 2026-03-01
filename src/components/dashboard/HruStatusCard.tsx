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
  Box,
} from "@mantine/core";
import {
  IconFlame,
  IconThermometer,
  IconCheck,
  IconSettings,
  IconRefresh,
  IconAlertCircle,
  IconWind,
  IconEye,
} from "@tabler/icons-react";
import type {
  HruState,
  ActiveMode,
  HruVariable,
  LocalizedText,
} from "../../hooks/useDashboardStatus";
import type { TFunction } from "i18next";

interface HruStatusCardProps {
  status: HruState;
  hruName?: string | null;
  t: TFunction;
  activeMode?: ActiveMode | null;
  configuredMaxPower?: number;
}

export function HruStatusCard({ status, hruName, t, activeMode, configuredMaxPower }: HruStatusCardProps) {
  const title = t("dashboard.hruStatusTitle", { defaultValue: "HRU live values" });
  const displayTitle = hruName ? `${hruName}` : title;

  function getLocalizedText(text: LocalizedText): string {
    if (typeof text === "string") return t(text, { defaultValue: text });
    if (text.translate) return t(text.text, { defaultValue: text.text });
    return text.text;
  }

  function getModeText(val: unknown): string {
    if (typeof val === "string") return t(val, { defaultValue: val });
    return String(val ?? "?");
  }

  function getOptionLabel(variable: HruVariable | undefined, raw: unknown): string | undefined {
    if (!variable?.options) return undefined;
    const numeric = typeof raw === "number" ? raw : Number(raw);
    const match = variable.options.find((o) => o.value === numeric);
    if (!match) return undefined;
    return getLocalizedText(match.label);
  }

  function resolveDisplayValue(
    variable: HruVariable | undefined,
    displayVal: unknown,
    rawVal: unknown,
  ) {
    const fromOption = getOptionLabel(variable, rawVal);
    if (fromOption) return fromOption;
    if (typeof displayVal === "string") return t(displayVal, { defaultValue: displayVal });
    return String(displayVal ?? rawVal ?? "?");
  }

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

  const { values, displayValues, variables } = status;
  // Filter to only show variables explicitly marked for dashboard (default false)
  const dashboardVars = variables.filter((v) => v.onDashboard === true);
  const powerVar = dashboardVars.find((v) => v.class === "power" || v.name === "power");
  const tempVars = dashboardVars.filter((v) => v.class === "temperature");
  const modeVar = dashboardVars.find((v) => v.class === "mode" || v.name === "mode");
  const otherVars = dashboardVars.filter(
    (v) =>
      v.class !== "power" &&
      v.class !== "temperature" &&
      v.class !== "mode" &&
      v.name !== "power" &&
      v.name !== "mode",
  );

  function renderPower(variable: HruVariable) {
    const rawVal = values[variable.name];
    const val = typeof rawVal === "number" ? rawVal : Number(rawVal ?? 0);
    const maxFromConfig =
      variable.class === "power" && variable.maxConfigurable && configuredMaxPower != null
        ? configuredMaxPower
        : undefined;
    const max =
      typeof maxFromConfig === "number"
        ? maxFromConfig
        : typeof variable.max === "number"
          ? variable.max
          : 100;
    const percentage = Math.min(100, Math.max(0, (val / max) * 100));
    const unit = variable.unit ? getLocalizedText(variable.unit) : "%";

    let color = "green";
    if (percentage > 70) color = "red";
    else if (percentage > 40) color = "orange";

    return (
      <Card key={variable.name} shadow="none" withBorder radius="md" p="md" variant="light">
        <Center>
          <RingProgress
            size={140}
            thickness={12}
            roundCaps
            sections={[{ value: percentage, color }]}
            label={
              <Center>
                <Stack align="center" gap={0}>
                  <IconWind size={24} style={{ opacity: 0.7 }} />
                  <Text fw={700} size="xl" ta="center">
                    {val} {unit}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {getLocalizedText(variable.label)}
                  </Text>
                </Stack>
              </Center>
            }
          />
        </Center>
      </Card>
    );
  }

  function renderTemp(variable: HruVariable) {
    const rawVal = values[variable.name];
    const val = typeof rawVal === "number" ? rawVal : Number(rawVal ?? 0);
    const unit = variable.unit ? getLocalizedText(variable.unit) : "°C";

    return (
      <Card key={variable.name} shadow="none" withBorder radius="md" p="md" variant="light">
        <Center h="100%" mih={100}>
          <Stack align="center" gap="xs">
            <IconThermometer size={32} color="var(--mantine-color-blue-filled)" />
            <Text
              fw={900}
              size="2.5rem"
              variant="gradient"
              gradient={{ from: "blue", to: "cyan", deg: 90 }}
              style={{ lineHeight: 1 }}
            >
              {Number.isFinite(val) ? val.toFixed(1) : String(rawVal ?? "-")}
              <Text span size="1.2rem" c="dimmed" ml={4}>
                {unit}
              </Text>
            </Text>
            <Text c="dimmed" size="sm" tt="uppercase" fw={700}>
              {getLocalizedText(variable.label)}
            </Text>
          </Stack>
        </Center>
      </Card>
    );
  }

  function renderMode() {
    const modeDisplay = modeVar ? displayValues[modeVar.name] : "?";
    const modeRaw = modeVar ? values[modeVar.name] : undefined;
    const modeValue = resolveDisplayValue(modeVar, modeDisplay, modeRaw);

    return (
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
                          name: getModeText(activeMode.modeName || modeValue),
                        })
                      : t("dashboard.activeMode.schedule", {
                          name: getModeText(activeMode.modeName || modeValue),
                        })}
                </Title>
                {modeVar && (
                  <Text size="sm" c="dimmed" mt={4}>
                    {t("dashboard.nativeMode")}: {getModeText(modeValue)}
                  </Text>
                )}
              </>
            ) : (
              <Title order={3} c="grape">
                {getModeText(modeValue)}
              </Title>
            )}
          </div>
        </Group>
      </Card>
    );
  }

  function renderOther(variable: HruVariable) {
    const displayVal = displayValues[variable.name];
    const rawVal = values[variable.name];
    const unit = variable.unit ? getLocalizedText(variable.unit) : "";
    const value = resolveDisplayValue(variable, displayVal, rawVal);

    let Icon = IconEye;
    if (variable.class === "power") Icon = IconWind;
    else if (variable.class === "temperature") Icon = IconThermometer;
    else if (variable.class === "mode") Icon = IconSettings;

    return (
      <Card key={variable.name} shadow="none" withBorder radius="md" p="sm" variant="light">
        <Group wrap="nowrap" gap="sm">
          <ThemeIcon color="gray" variant="light" size="md" radius="sm">
            <Icon size={16} />
          </ThemeIcon>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Text size="xs" c="dimmed" truncate fw={500}>
              {getLocalizedText(variable.label)}
            </Text>
            <Text fw={700} size="sm" truncate>
              {value} {unit}
            </Text>
          </div>
        </Group>
      </Card>
    );
  }

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

      <Box p="lg" pt="md">
        <SimpleGrid cols={{ base: 1, sm: tempVars.length > 0 ? 2 : 1 }} spacing="md">
          {/* Main Column: Power and Mode */}
          <Stack gap="md">
            {powerVar && renderPower(powerVar)}
            {renderMode()}
          </Stack>

          {/* Side Column: Temperatures */}
          {tempVars.length > 0 && <Stack gap="md">{tempVars.map((v) => renderTemp(v))}</Stack>}
        </SimpleGrid>

        {/* Footer Grid: Other variables */}
        {otherVars.length > 0 && (
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs" mt="md">
            {otherVars.map((v) => renderOther(v))}
          </SimpleGrid>
        )}
      </Box>
    </Card>
  );
}
