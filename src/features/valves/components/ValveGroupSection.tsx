import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

import type { Valve } from "@luftuj/shared/types/valve";
import { ValveSlider } from "@luftuj/shared/ui";
import {
  formatValveValue,
  getValveGroupBounds,
  getValveStatusColor,
} from "@luftuj/shared/utils/valve";

import { ValveCard } from "./ValveCard";

export interface ValveGroupSectionProps {
  title?: string;
  valves: Valve[];
  onPreview: (entityId: string, value: number) => void;
  onCommit: (entityId: string, value: number) => void | Promise<void>;
  onBulkCommit?: (value: number) => void | Promise<void>;
}

export function ValveGroupSection({
  title,
  valves,
  onPreview,
  onCommit,
  onBulkCommit,
}: Readonly<ValveGroupSectionProps>) {
  const { t } = useTranslation();

  const bounds = useMemo(() => getValveGroupBounds(valves), [valves]);

  const averageValue = useMemo(() => {
    if (valves.length === 0) return bounds.min;
    return valves.reduce((sum, v) => sum + v.value, 0) / valves.length;
  }, [valves, bounds.min]);

  const isMixed = useMemo(
    () => valves.length > 0 && !valves.every((v) => v.value === valves[0].value),
    [valves],
  );

  const initialBulkValue = isMixed ? bounds.min : averageValue;

  const [bulkValue, setBulkValue] = useState(initialBulkValue);
  const [bulkOverridden, setBulkOverridden] = useState(false);

  useEffect(() => {
    setBulkValue(initialBulkValue);
    setBulkOverridden(false);
  }, [initialBulkValue]);

  const hasUnavailableValve = valves.some((v) => !v.isAvailable);

  const showMixedLabel = isMixed && !bulkOverridden;

  const sliderColor = showMixedLabel
    ? "gray"
    : getValveStatusColor(bulkValue, bounds.min, bounds.max);

  const handleBulkPreview = useCallback(
    (value: number) => {
      setBulkValue(value);
      setBulkOverridden(true);
      for (const valve of valves) {
        onPreview(valve.entityId, value);
      }
    },
    [valves, onPreview],
  );

  const handleBulkCommit = useCallback(
    (value: number) => {
      // Only ever invoked while onBulkCommit's slider is rendered (see below),
      // which already requires onBulkCommit to be present - a per-valve
      // onCommit loop here would double-write every valve in the group.
      if (onBulkCommit) {
        void onBulkCommit(value);
        return;
      }
      for (const valve of valves) {
        void onCommit(valve.entityId, value);
      }
    },
    [valves, onCommit, onBulkCommit],
  );

  if (valves.length === 0) return null;

  return (
    <Stack gap="sm">
      {title ? (
        <Group justify="space-between" align="center">
          <Title order={3}>{title}</Title>
          <Text size="sm" c="dimmed">
            {t("valves.groups.valveCount", {
              count: valves.length,
              defaultValue: "{{count}} valves",
            })}
          </Text>
        </Group>
      ) : null}
      {onBulkCommit ? (
        <Group gap="md" align="center" wrap="nowrap">
          <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {t("valves.groups.bulkSetValue", { defaultValue: "Set all" })}
          </Text>
          <ValveSlider
            value={bulkValue}
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            label={(val) =>
              showMixedLabel
                ? t("valves.groups.mixedValues", { defaultValue: "Mixed" })
                : formatValveValue(val, bounds.min, bounds.max, t)
            }
            onChange={handleBulkPreview}
            onChangeEnd={handleBulkCommit}
            color={sliderColor}
            size="md"
            disabled={hasUnavailableValve}
          />
        </Group>
      ) : null}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        {valves.map((valve) => (
          <ValveCard key={valve.entityId} valve={valve} onPreview={onPreview} onCommit={onCommit} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}
