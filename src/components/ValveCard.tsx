import { Badge, Card, Group, Slider, Stack, Text, ThemeIcon, rem, Tooltip } from "@mantine/core";
import { IconAdjustments } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type { Valve } from "../types/valve";

export interface ValveCardProps {
  valve: Valve;
  formatValue: (value: number) => string;
  onPreview: (entityId: string, value: number) => void;
  onCommit: (entityId: string, value: number) => void | Promise<void>;
}

export function ValveCard({ valve, formatValue, onPreview, onCommit }: ValveCardProps) {
  const { t } = useTranslation();
  // Transformation: Backend 0 -> UI Max; Backend Max -> UI 0
  // uiValue = valve.max - valve.value + valve.min;
  const uiValue = valve.max - valve.value + valve.min;

  const isUnavailable = !valve.isAvailable;

  function handleUiChange(val: number) {
    const backendVal = valve.max - val + valve.min;
    onPreview(valve.entityId, backendVal);
  }

  function handleUiChangeEnd(val: number) {
    const backendVal = valve.max - val + valve.min;
    void onCommit(valve.entityId, backendVal);
  }

  function formatUiValue(val: number) {
    const backendVal = valve.max - val + valve.min;
    return formatValue(backendVal);
  }
  function getValveColor(val: number) {
    if (isUnavailable) return "gray";
    if (val >= valve.max) return "red";
    if (val <= valve.min) return "green";
    return "orange";
  }

  const statusColor = getValveColor(valve.value);

  return (
    <Card shadow="sm" radius="md" p="lg" withBorder>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            <ThemeIcon
              size={42}
              radius="md"
              variant="light"
              color={statusColor}
              style={{ transition: "all 0.3s ease", opacity: isUnavailable ? 0.4 : 1 }}
            >
              <IconAdjustments size={24} />
            </ThemeIcon>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Tooltip label={valve.name} openDelay={500} withArrow>
                <Text fw={600} size="lg" truncate style={{ lineHeight: 1.2, cursor: "pointer" }}>
                  {valve.name}
                </Text>
              </Tooltip>
              <Tooltip label={valve.entityId} openDelay={500} withArrow>
                <Text size="xs" c="dimmed" truncate mt={2} style={{ cursor: "pointer" }}>
                  {valve.entityId}
                </Text>
              </Tooltip>
            </div>
          </Group>
          <Badge
            size="xl"
            variant={isUnavailable ? "outline" : "light"}
            color={statusColor}
            style={{
              transition: "all 0.3s ease",
              minWidth: rem(80),
              justifyContent: "center",
              opacity: isUnavailable ? 0.7 : 1,
            }}
          >
            {isUnavailable
              ? t("valves.status.offlineLabel", { defaultValue: "Offline" })
              : formatValue(valve.value)}
          </Badge>
        </Group>

        <Slider
          value={uiValue}
          min={valve.min}
          max={valve.max}
          step={valve.step}
          label={formatUiValue}
          onChange={handleUiChange}
          onChangeEnd={handleUiChangeEnd}
          disabled={isUnavailable}
          size="xl"
          color={statusColor}
          thumbSize={28}
          styles={{
            root: { width: "100%" },
            track: {
              backgroundColor: isUnavailable
                ? "var(--mantine-color-gray-3)"
                : "var(--mantine-color-blue-1)",
              opacity: isUnavailable ? 0.6 : 1,
            },
            thumb: {
              backgroundColor: isUnavailable
                ? "var(--mantine-color-gray-2)"
                : "var(--mantine-color-white)",
              borderWidth: 2,
              borderColor: isUnavailable
                ? "var(--mantine-color-gray-5)"
                : "var(--mantine-color-blue-6)",
              boxShadow: "var(--mantine-shadow-sm)",
              transition: "border-color 0.2s ease, transform 0.1s ease",
            },
          }}
        />
      </Stack>
    </Card>
  );
}
