import {
  Alert,
  Badge,
  Button,
  CopyButton,
  Fieldset,
  Group,
  Slider,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle, IconDroplet } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { Valve } from "../../../shared/types/valve";

interface ModeValveSelectorProps {
  valves: Valve[];
  openings: Record<string, number | undefined>;
  onChange: (
    updater: (
      prev: Record<string, number | undefined>,
    ) => Record<string, number | undefined>,
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
    return (openings[key] ?? 0) >= 90;
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
          const uiValue = 90 - backendValue;
          const statusColor =
            backendValue >= 90 ? "red" : backendValue <= 0 ? "green" : "orange";
          let badgeText = `${Math.round(90 - backendValue)}°`;
          if (backendValue === 0) badgeText = t("valves.status.open");
          if (backendValue >= 90) badgeText = t("valves.status.closed");

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
                      {showCopyButton && (
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
                  )}
                </Stack>
                <Badge variant="light" color={statusColor}>
                  {badgeText}
                </Badge>
              </Group>
              <Slider
                value={uiValue}
                onChange={(val) =>
                  onChange((prev) => ({ ...prev, [storageKey]: 90 - val }))
                }
                min={0}
                max={90}
                step={5}
                marks={[
                  { value: 0 },
                  { value: 15 },
                  { value: 30 },
                  { value: 45 },
                  { value: 60 },
                  { value: 75 },
                  { value: 90 },
                ]}
                label={null}
                size="lg"
                color={statusColor}
                thumbSize={28}
              />
            </Stack>
          );
        })}
      </Stack>
    </Fieldset>
  );
}
