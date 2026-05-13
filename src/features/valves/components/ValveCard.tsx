import { Badge, Group, Stack, Text, ThemeIcon, rem, Tooltip } from "@mantine/core";
import { IconAdjustments } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type { Valve } from "@luftuj/shared/types/valve";
import { formatValveValue, getValveStatusColor } from "@luftuj/shared/utils/valve";
import { BaseCard, ValveSlider } from "@luftuj/shared/ui";

export interface ValveCardProps {
  valve: Valve;
  onPreview: (entityId: string, value: number) => void;
  onCommit: (entityId: string, value: number) => void | Promise<void>;
}

export function ValveCard({ valve, onPreview, onCommit }: ValveCardProps) {
  const { t } = useTranslation();
  const isUnavailable = !valve.isAvailable;
  const statusColor = getValveStatusColor(valve.value, valve.min, valve.max, isUnavailable);

  return (
    <BaseCard>
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
              : formatValveValue(valve.value, valve.min, valve.max, t)}
          </Badge>
        </Group>

        <ValveSlider
          value={valve.value}
          min={valve.min}
          max={valve.max}
          step={valve.step}
          label={(val) => formatValveValue(val, valve.min, valve.max, t)}
          onChange={(val) => onPreview(valve.entityId, val)}
          onChangeEnd={(val) => void onCommit(valve.entityId, val)}
          disabled={isUnavailable}
          color={statusColor}
        />
      </Stack>
    </BaseCard>
  );
}