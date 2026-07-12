import { Badge, Button, CopyButton, Group, Stack, Text } from "@mantine/core";
import type { TFunction } from "i18next";

import type { Valve } from "@luftuj/shared/types/valve";
import { formatValveValue, getValveStatusColor } from "@luftuj/shared/utils/valve";
import { ValveSlider } from "@luftuj/shared/ui";

import type { OpeningsUpdater } from "./ModeValveSelector.types";
import { valveStorageKey } from "./ModeValveSelector.types";

interface ValveRowProps {
  valve: Valve;
  idx: number;
  openings: Record<string, number | undefined>;
  onChange: (updater: OpeningsUpdater) => void;
  showCopyButton: boolean;
  t: TFunction;
}

export function ValveRow({
  valve: v,
  idx,
  openings,
  onChange,
  showCopyButton,
  t,
}: Readonly<ValveRowProps>) {
  const key = valveStorageKey(v, idx);
  const name = v.name || `Valve ${idx + 1}`;
  const entityId = v.entityId || "";
  const storageKey = v.entityId || key;
  const backendValue = openings[storageKey] ?? 0;
  const isUnavailable = !v.isAvailable;
  const statusColor = isUnavailable ? "gray" : getValveStatusColor(backendValue, v.min, v.max);
  const badgeText = formatValveValue(backendValue, v.min, v.max, t);

  return (
    <Stack gap={0}>
      <Group justify="space-between" mb={4}>
        <Stack gap={0}>
          <Text size="sm" fw={500} lh={1.2}>
            {name}
          </Text>
          {entityId && (
            <Group gap={6} align="center">
              <Text size="xs" c="dimmed">
                {entityId}
              </Text>
            </Group>
          )}
        </Stack>
        <Group gap="xs" align="center">
          {isUnavailable && (
            <Badge variant="light" color="gray">
              {t("settings.timeline.deadValve")}
            </Badge>
          )}
          <Badge variant="light" color={statusColor}>
            {badgeText}
          </Badge>
          {showCopyButton && entityId && (
            <CopyButton value={entityId}>
              {({ copied, copy }) => (
                <Button color={copied ? "teal" : "gray"} size="xs" variant="subtle" onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </CopyButton>
          )}
        </Group>
      </Group>
      <ValveSlider
        value={backendValue}
        min={v.min}
        max={v.max}
        step={v.step}
        onChange={(val) => onChange((prev) => ({ ...prev, [storageKey]: val }))}
        disabled={isUnavailable}
        color={statusColor}
        size="lg"
        label={null}
      />
    </Stack>
  );
}
