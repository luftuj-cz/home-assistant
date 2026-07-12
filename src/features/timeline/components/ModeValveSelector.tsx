import { Alert, Fieldset, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconDroplet } from "@tabler/icons-react";
import type { TFunction } from "i18next";

import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";

import type { OpeningsUpdater } from "./ModeValveSelector.types";
import { valveStorageKey } from "./ModeValveSelector.types";
import { ModeValveGroupSection } from "./ModeValveGroupSection";
import { ValveRow } from "./ValveRow";

interface ModeValveSelectorProps {
  valves: Valve[];
  valveGroups?: ValveGroup[];
  openings: Record<string, number | undefined>;
  onChange: (updater: OpeningsUpdater) => void;
  showCopyButton: boolean;
  t: TFunction;
}

export function ModeValveSelector({
  valves,
  valveGroups = [],
  openings,
  onChange,
  showCopyButton,
  t,
}: Readonly<ModeValveSelectorProps>) {
  if (valves.length === 0) return null;

  const allClosed = valves.every((v) => {
    const key = v.entityId || v.name;
    return (openings[key] ?? 0) >= v.max;
  });

  const sortedGroups = valveGroups.toSorted((a, b) => a.sortOrder - b.sortOrder);
  const groupedEntityIds = new Set(sortedGroups.flatMap((group) => group.entityIds));
  const ungroupedValves = valves.filter((v) => !groupedEntityIds.has(v.entityId));

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
      <Stack gap="lg">
        {sortedGroups.map((group) => {
          const groupValves = valves.filter((v) => group.entityIds.includes(v.entityId));
          if (groupValves.length === 0) return null;
          return (
            <ModeValveGroupSection
              key={group.id}
              group={group}
              groupValves={groupValves}
              openings={openings}
              onChange={onChange}
              showCopyButton={showCopyButton}
              t={t}
            />
          );
        })}
        {ungroupedValves.length > 0 && (
          <Stack gap="xs">
            {sortedGroups.length > 0 && (
              <Text size="sm" fw={600} c="dimmed">
                {t("valves.groups.ungrouped", { defaultValue: "Ungrouped" })}
              </Text>
            )}
            <Stack gap="xs">
              {ungroupedValves.map((v, idx) => (
                <ValveRow
                  key={valveStorageKey(v, idx)}
                  valve={v}
                  idx={idx}
                  openings={openings}
                  onChange={onChange}
                  showCopyButton={showCopyButton}
                  t={t}
                />
              ))}
            </Stack>
          </Stack>
        )}
      </Stack>
    </Fieldset>
  );
}
