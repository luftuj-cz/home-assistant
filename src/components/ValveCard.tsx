import { Badge, Card, Group, Slider, Stack, Text, ThemeIcon, rem } from "@mantine/core";
import { IconAdjustments } from "@tabler/icons-react";

import type { Valve } from "../types/valve";

export interface ValveCardProps {
  valve: Valve;
  formatValue: (value: number) => string;
  onPreview: (entityId: string, value: number) => void;
  onCommit: (entityId: string, value: number) => void | Promise<void>;
}

export function ValveCard({ valve, formatValue, onPreview, onCommit }: ValveCardProps) {
  // Transformation: Backend 0 -> UI Max; Backend Max -> UI 0
  // uiValue = valve.max - valve.value + valve.min;
  const uiValue = valve.max - valve.value + valve.min;

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
    if (val >= valve.max) return "red";
    if (val <= valve.min) return "green";
    return "orange";
  }

  const statusColor = getValveColor(valve.value);

  return (
    <Card shadow="sm" radius="md" padding="lg" withBorder>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            <ThemeIcon
              size={42}
              radius="md"
              variant="light"
              color={statusColor}
              style={{ transition: "all 0.3s ease" }}
            >
              <IconAdjustments size={24} />
            </ThemeIcon>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600} size="lg" truncate style={{ lineHeight: 1.2 }}>
                {valve.name}
              </Text>
              <Text size="xs" c="dimmed" truncate mt={2}>
                {valve.entityId}
              </Text>
            </div>
          </Group>
          <Badge
            size="xl"
            variant="light"
            color={statusColor}
            style={{
              transition: "all 0.3s ease",
              minWidth: rem(80),
              justifyContent: "center",
            }}
          >
            {formatValue(valve.value)}
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
          size="xl"
          color={statusColor}
          thumbSize={28}
          styles={(theme) => ({
            track: {
              backgroundColor: "var(--mantine-color-blue-1)",
            },
            mark: {
              display: "none",
            },
            markFilled: {
              display: "none",
            },
            thumb: {
              backgroundColor: "var(--mantine-color-white)",
              borderWidth: 2,
              borderColor: "var(--mantine-color-blue-6)",
              boxShadow: theme.shadows.sm,
              transition: "border-color 0.2s ease, transform 0.1s ease",
            },
          })}
        />
      </Stack>
    </Card>
  );
}
