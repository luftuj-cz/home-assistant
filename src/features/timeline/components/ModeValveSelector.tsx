import {
  Alert,
  Badge,
  Button,
  CopyButton,
  Fieldset,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle, IconDroplet } from "@tabler/icons-react";
import type { TFunction } from "i18next";

import type { Valve } from "@luftuj/shared/types/valve";
import { formatValveValue, getValveStatusColor } from "@luftuj/shared/utils/valve";
import { ValveSlider } from "@luftuj/shared/ui";

interface ModeValveSelectorProps {
  valves: Valve[];
  openings: Record<string, number | undefined>;
  onChange: (
    updater: (prev: Record<string, number | undefined>) => Record<string, number | undefined>,
  ) => void;
  showCopyButton: boolean;
  t: TFunction;
}

export function ModeValveSelector({
  valves,
  openings,
  onChange,
  showCopyButton,
  t,
}: ModeValveSelectorProps) {
  if (valves.length === 0) return null;

  const allClosed = valves.every((v) => {
    const key = v.entityId || v.name;
    return (openings[key] ?? 0) >= v.max;
  });

  return (
    <Fieldset
      legend={
        <Group gap="xs">
          <IconDroplet size={16} color="var(--mantine-primary-color-5)" stroke={1.5} />
          <Text size="sm" fw={600}>
            {t("settings.timeline.modeValves")}
          </Text>
        </Group>
      }
      radius="md"
    >
      {allClosed && (
        <Alert
          color="orange"
          variant="filled"
          title={t("valves.warningTitle")}
          icon={<IconAlertCircle size={24} />}
          mb="md"
        >
          {t("valves.warnings.allClosed")}
        </Alert>
      )}
      <Stack gap="xs">
        {valves.map((v, idx) => {
          const key = v.entityId || v.name || `valve-${idx}`;
          const name = v.name || `Valve ${idx + 1}`;
          const entityId = v.entityId || "";
          const storageKey = v.entityId || key;
          const backendValue = openings[storageKey] ?? 0;
          const statusColor = getValveStatusColor(backendValue, v.min, v.max);
          const badgeText = formatValveValue(backendValue, v.min, v.max, t);

          return (
            <Stack key={key} gap={0}>
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
                  <Badge variant="light" color={statusColor}>
                    {badgeText}
                  </Badge>
                  {showCopyButton && entityId && (
                    <CopyButton value={entityId}>
                      {({ copied, copy }) => (
                        <Button
                          color={copied ? "teal" : "gray"}
                          size="xs"
                          variant="subtle"
                          onClick={copy}
                        >
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
                onChange={(val) =>
                  onChange((prev) => ({ ...prev, [storageKey]: val }))
                }
                color={statusColor}
                size="lg"
                label={null}
              />
            </Stack>
          );
        })}
      </Stack>
    </Fieldset>
  );
}
