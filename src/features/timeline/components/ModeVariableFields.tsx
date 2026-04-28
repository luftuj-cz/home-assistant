import { Fieldset, Group, NumberInput, Select, SimpleGrid, Switch, Text } from "@mantine/core";
import { IconSettings, IconThermometer, IconWind } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { HruVariable, LocalizedText } from "../../../shared/api/hru";

interface ModeVariableFieldsProps {
  hruVariables: HruVariable[];
  values: Record<string, number | string | boolean>;
  onChange: (
    updater: (
      prev: Record<string, number | string | boolean>,
    ) => Record<string, number | string | boolean>,
  ) => void;
  maxPower?: number;
  submitted: boolean;
  t: TFunction;
}

function localized(text: LocalizedText, t: TFunction): string {
  if (typeof text === "string") return t(text, { defaultValue: text });
  if (text.translate) return t(text.text, { defaultValue: text.text });
  return text.text;
}

export function ModeVariableFields({
  hruVariables,
  values,
  onChange,
  maxPower,
  submitted,
  t,
}: ModeVariableFieldsProps) {
  const editable = hruVariables.filter((v) => v.editable);
  if (editable.length === 0) return null;

  return (
    <Fieldset
      legend={
        <Group gap="xs">
          <IconSettings size={16} />
          <Text size="sm" fw={700}>
            {t("settings.timeline.hruSettings")}
          </Text>
        </Group>
      }
      radius="md"
    >
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {editable.map((variable) => {
          const label = localized(variable.label, t);
          const unit = variable.unit ? localized(variable.unit, t) : "";
          const val = values[variable.name];

          if (variable.type === "boolean") {
            return (
              <Switch
                key={variable.name}
                label={label}
                checked={val === 1}
                onChange={(e) => {
                  const checked = e?.currentTarget?.checked ?? false;
                  onChange((prev) => ({ ...prev, [variable.name]: checked ? 1 : 0 }));
                }}
                mt="xs"
              />
            );
          }

          if (variable.type === "select" && variable.options) {
            return (
              <Select
                key={variable.name}
                label={label}
                data={variable.options.map((opt) => ({
                  value: opt.value.toString(),
                  label: localized(opt.label, t),
                }))}
                value={val !== undefined ? val.toString() : null}
                onChange={(v) =>
                  onChange((prev) => ({
                    ...prev,
                    [variable.name]: v ? parseInt(v, 10) : 0,
                  }))
                }
                leftSection={
                  variable.class === "mode" ? <IconSettings size={16} stroke={1.5} /> : undefined
                }
                required
                error={val === undefined && submitted ? t("validation.required") : null}
              />
            );
          }

          const effectiveMax =
            variable.class === "power" && variable.maxConfigurable && maxPower != null
              ? maxPower
              : variable.max;

          return (
            <NumberInput
              key={variable.name}
              label={`${label}${unit ? ` (${unit})` : ""}`}
              value={typeof val === "number" ? val : undefined}
              onChange={(v) =>
                onChange((prev) => ({
                  ...prev,
                  [variable.name]: typeof v === "number" ? v : 0,
                }))
              }
              min={variable.min}
              max={effectiveMax}
              step={variable.step}
              leftSection={
                variable.class === "power" ? (
                  <IconWind size={16} stroke={1.5} />
                ) : variable.class === "temperature" ? (
                  <IconThermometer size={16} stroke={1.5} />
                ) : undefined
              }
              required
              error={val === undefined && submitted ? t("validation.required") : null}
            />
          );
        })}
      </SimpleGrid>
    </Fieldset>
  );
}
