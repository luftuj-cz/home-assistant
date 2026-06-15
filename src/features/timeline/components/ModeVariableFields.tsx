import { Fieldset, Group, NumberInput, Select, SimpleGrid, Switch, Text } from "@mantine/core";
import { IconSettings, IconThermometer, IconWind } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { HruVariable, LocalizedText } from "@luftuj/shared/api/hru";

type VariableValue = number | string | boolean;

interface ModeVariableFieldsProps {
  hruVariables: HruVariable[];
  values: Record<string, VariableValue>;
  onChange: (
    updater: (prev: Record<string, VariableValue>) => Record<string, VariableValue>,
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

interface VariableFieldProps {
  variable: HruVariable;
  val: VariableValue;
  onChange: ModeVariableFieldsProps["onChange"];
  submitted: boolean;
  maxPower?: number;
  t: TFunction;
}

function BooleanVariableField({
  variable,
  val,
  onChange,
  t,
}: Readonly<Pick<VariableFieldProps, "variable" | "val" | "onChange" | "t">>) {
  const label = localized(variable.label, t);
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

function SelectVariableField({
  variable,
  val,
  onChange,
  submitted,
  t,
}: Readonly<Pick<VariableFieldProps, "variable" | "val" | "onChange" | "submitted" | "t">>) {
  const label = localized(variable.label, t);
  return (
    <Select
      key={variable.name}
      label={label}
      data={variable.options!.map((opt) => ({
        value: opt.value.toString(),
        label: localized(opt.label, t),
      }))}
      value={val === undefined ? null : val.toString()}
      onChange={(v) =>
        onChange((prev) => ({
          ...prev,
          [variable.name]: v ? Number.parseInt(v, 10) : 0,
        }))
      }
      leftSection={variable.class === "mode" ? <IconSettings size={16} stroke={1.5} /> : undefined}
      required
      error={val === undefined && submitted ? t("validation.required") : null}
    />
  );
}

function NumberVariableField({
  variable,
  val,
  onChange,
  submitted,
  maxPower,
  t,
}: Readonly<VariableFieldProps>) {
  const label = localized(variable.label, t);
  const unit = variable.unit ? localized(variable.unit, t) : "";

  const effectiveMax =
    variable.class === "power" && variable.maxConfigurable && maxPower != null
      ? maxPower
      : variable.max;

  let leftSection;
  if (variable.class === "power") {
    leftSection = <IconWind size={16} stroke={1.5} />;
  } else if (variable.class === "temperature") {
    leftSection = <IconThermometer size={16} stroke={1.5} />;
  }

  const labelText = unit ? `${label} (${unit})` : label;

  return (
    <NumberInput
      key={variable.name}
      label={labelText}
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
      leftSection={leftSection}
      required
      error={val === undefined && submitted ? t("validation.required") : null}
    />
  );
}

function VariableField({
  variable,
  val,
  onChange,
  submitted,
  maxPower,
  t,
}: Readonly<VariableFieldProps>) {
  if (variable.type === "boolean") {
    return <BooleanVariableField variable={variable} val={val} onChange={onChange} t={t} />;
  }

  if (variable.type === "select" && variable.options) {
    return (
      <SelectVariableField
        variable={variable}
        val={val}
        onChange={onChange}
        submitted={submitted}
        t={t}
      />
    );
  }

  return (
    <NumberVariableField
      variable={variable}
      val={val}
      onChange={onChange}
      submitted={submitted}
      maxPower={maxPower}
      t={t}
    />
  );
}

export function ModeVariableFields({
  hruVariables,
  values,
  onChange,
  maxPower,
  submitted,
  t,
}: Readonly<ModeVariableFieldsProps>) {
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
        {editable.map((variable) => (
          <VariableField
            key={variable.name}
            variable={variable}
            val={values[variable.name]}
            onChange={onChange}
            submitted={submitted}
            maxPower={maxPower}
            t={t}
          />
        ))}
      </SimpleGrid>
    </Fieldset>
  );
}
