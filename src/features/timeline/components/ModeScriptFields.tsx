import { ActionIcon, Button, Fieldset, Group, Select, Stack, Text } from "@mantine/core";
import { IconPlus, IconScript, IconTrash } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { ScriptRow } from "@luftuj/features/timeline/hooks/useModeForm";
import { useHaScriptsQuery } from "@luftuj/features/timeline/hooks/useHaScriptsQuery";

interface ModeScriptFieldsProps {
  scriptRows: ScriptRow[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  onChange: (id: number, value: string | null) => void;
  t: TFunction;
}

export function ModeScriptFields({
  scriptRows,
  onAdd,
  onRemove,
  onChange,
  t,
}: Readonly<ModeScriptFieldsProps>) {
  const { data: scripts = [], isLoading } = useHaScriptsQuery();

  const baseData = scripts.map((s) => ({ value: s.entityId, label: s.friendlyName }));
  // Scripts picked in other rows, so each row can exclude them (no duplicates).
  const selected = new Set(
    scriptRows.map((row) => row.value).filter((v): v is string => typeof v === "string"),
  );

  return (
    <Fieldset
      legend={t("settings.timeline.modeScripts", { defaultValue: "Run scripts on activation" })}
    >
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          {t("settings.timeline.modeScriptsDescription", {
            defaultValue:
              "Home Assistant scripts to run whenever this mode is activated (boost, schedule or test).",
          })}
        </Text>

        {scriptRows.map((row) => {
          // Exclude scripts already chosen in other rows; keep this row's own value.
          let data = baseData.filter((d) => d.value === row.value || !selected.has(d.value));
          // Preserve a saved value even if HA did not return it (e.g. offline).
          if (row.value && !data.some((d) => d.value === row.value)) {
            data = [...data, { value: row.value, label: row.value }];
          }
          return (
            <Group key={row.id} gap="xs" wrap="nowrap">
              <Select
                flex={1}
                data={data}
                value={row.value}
                onChange={(v) => onChange(row.id, v)}
                placeholder={t("settings.timeline.modeScriptPlaceholder", {
                  defaultValue: "Select a script",
                })}
                nothingFoundMessage={t("settings.timeline.modeScriptNothingFound", {
                  defaultValue: "No scripts found",
                })}
                leftSection={<IconScript size={16} stroke={1.5} />}
                searchable
                clearable
                disabled={isLoading}
              />
              <ActionIcon
                variant="light"
                color="red"
                onClick={() => onRemove(row.id)}
                aria-label={t("settings.timeline.modeScriptRemove", { defaultValue: "Remove" })}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          );
        })}

        <Group>
          <Button variant="light" size="xs" leftSection={<IconPlus size={16} />} onClick={onAdd}>
            {t("settings.timeline.modeScriptAdd", { defaultValue: "Add script" })}
          </Button>
        </Group>
      </Stack>
    </Fieldset>
  );
}
