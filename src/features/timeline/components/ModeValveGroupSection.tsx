import { useMemo, useState } from "react";
import { ActionIcon, Group, Stack, Text } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { TFunction } from "i18next";

import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";
import { formatValveValue, getValveGroupBounds } from "@luftuj/shared/utils/valve";
import { ValveSlider } from "@luftuj/shared/ui";

import type { OpeningsUpdater } from "./ModeValveSelector.types";
import { valveStorageKey } from "./ModeValveSelector.types";
import { ValveRow } from "./ValveRow";

interface ModeValveGroupSectionProps {
  group: ValveGroup;
  groupValves: Valve[];
  openings: Record<string, number | undefined>;
  onChange: (updater: OpeningsUpdater) => void;
  showCopyButton: boolean;
  t: TFunction;
}

export function ModeValveGroupSection({
  group,
  groupValves,
  openings,
  onChange,
  showCopyButton,
  t,
}: Readonly<ModeValveGroupSectionProps>) {
  const uniformValue = useMemo(() => {
    if (groupValves.length === 0) return null;
    const values = groupValves.map(
      (v, idx) => openings[v.entityId || valveStorageKey(v, idx)] ?? 0,
    );
    return values.every((value) => value === values[0]) ? values[0] : null;
  }, [groupValves, openings]);

  const [collapsed, setCollapsed] = useState(() => uniformValue !== null);

  const bounds = useMemo(() => getValveGroupBounds(groupValves), [groupValves]);

  const [bulkValue, setBulkValue] = useState(uniformValue ?? bounds.min);
  const [bulkOverridden, setBulkOverridden] = useState(false);

  const showMixedLabel = uniformValue === null && !bulkOverridden;

  function handleBulkChange(value: number) {
    setBulkValue(value);
    setBulkOverridden(true);
    onChange((prev) => {
      const next = { ...prev };
      groupValves.forEach((v, idx) => {
        const key = v.entityId || valveStorageKey(v, idx);
        next[key] = value;
      });
      return next;
    });
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={
              collapsed
                ? t("valves.groups.expand", { defaultValue: "Expand" })
                : t("valves.groups.collapse", { defaultValue: "Collapse" })
            }
          >
            {collapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
          </ActionIcon>
          <Text size="sm" fw={600}>
            {group.name}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {t("valves.groups.valveCount", {
            count: groupValves.length,
            defaultValue: "{{count}} valves",
          })}
        </Text>
      </Group>

      {collapsed ? (
        <Group gap="md" align="center" wrap="nowrap" pl="lg">
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
            onChange={handleBulkChange}
            color="blue"
            size="md"
          />
        </Group>
      ) : (
        <Stack gap="xs" pl="lg">
          {groupValves.map((v, idx) => (
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
      )}
    </Stack>
  );
}
