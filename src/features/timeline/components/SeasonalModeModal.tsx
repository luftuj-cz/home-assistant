import {
  Button,
  Fieldset,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useEffect } from "react";
import { useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { IconDroplet, IconSettings, IconWind } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import { useTimelineModesQuery } from "../hooks/useTimelineModesQuery";
import type { HruVariable, LocalizedText } from "@luftuj/shared/api/hru";
import type { Season, SeasonalMode } from "@luftuj/shared/types/timeline";
import type { Valve } from "@luftuj/shared/types/valve";
import { ValveSlider } from "@luftuj/shared/ui";
import { formatValveValue, getValveStatusColor } from "@luftuj/shared/utils/valve";

type VariableValue = number | string | boolean;

interface Props {
  opened: boolean;
  season: Season | null;
  initial: SeasonalMode | null;
  unitId: string | null;
  valves: Valve[];
  hruVariables: HruVariable[];
  maxPower?: number;
  onClose: () => void;
  onSubmit: (body: Omit<SeasonalMode, "season" | "hruId">) => void;
  pending: boolean;
}

function localized(text: LocalizedText, t: TFunction): string {
  if (typeof text === "string") return t(text, { defaultValue: text });
  if (text.translate) return t(text.text, { defaultValue: text.text });
  return text.text;
}

function isVariableEnabled(values: Record<string, VariableValue>, name: string): boolean {
  return Object.hasOwn(values, name);
}

function getDefaultVariableValue(variable: HruVariable): VariableValue {
  if (variable.type === "boolean") return 0;
  if (variable.type === "select") return Number(variable.options?.[0]?.value ?? 0);
  return Number(variable.min ?? 0);
}

function getValveKey(valve: Valve, index: number): string {
  return valve.entityId || valve.name || `valve-${index}`;
}

export function SeasonalModeModal({
  opened,
  season,
  initial,
  unitId,
  valves,
  hruVariables,
  maxPower,
  onClose,
  onSubmit,
  pending,
}: Props) {
  const { t } = useTranslation();
  const { modes = [] } = useTimelineModesQuery(unitId ?? undefined);

  const form = useForm({
    initialValues: {
      baseModeId: initial?.baseModeId ?? 0,
      powerEnabled: initial?.power != null,
      power: initial?.power ?? 0,
      temperatureEnabled: initial?.temperature != null,
      temperature: initial?.temperature ?? 0,
      variables: initial?.variables ?? ({} as Record<string, VariableValue>),
      valveOpenings: initial?.luftatorConfig ?? ({} as Record<string, number>),
      enabled: initial?.enabled ?? true,
    },
  });

  useEffect(() => {
    if (!opened) return;
    form.setValues({
      baseModeId: initial?.baseModeId ?? 0,
      powerEnabled: initial?.power != null,
      power: initial?.power ?? 0,
      temperatureEnabled: initial?.temperature != null,
      temperature: initial?.temperature ?? 0,
      variables: initial?.variables ?? {},
      valveOpenings: initial?.luftatorConfig ?? {},
      enabled: initial?.enabled ?? true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, initial, season]);

  function setVariableEnabled(variable: HruVariable, enabled: boolean): void {
    const next = { ...form.values.variables };
    if (enabled) {
      next[variable.name] = getDefaultVariableValue(variable);
    } else {
      delete next[variable.name];
    }
    form.setFieldValue("variables", next);
  }

  function setVariableValue(variable: HruVariable, value: VariableValue): void {
    form.setFieldValue("variables", { ...form.values.variables, [variable.name]: value });
  }

  function setValveEnabled(key: string, enabled: boolean): void {
    const next = { ...form.values.valveOpenings };
    if (enabled) {
      next[key] = next[key] ?? 0;
    } else {
      delete next[key];
    }
    form.setFieldValue("valveOpenings", next);
  }

  function setValveValue(key: string, value: number): void {
    form.setFieldValue("valveOpenings", { ...form.values.valveOpenings, [key]: value });
  }

  function handleSubmit(): void {
    onSubmit({
      baseModeId: form.values.baseModeId,
      power: form.values.powerEnabled ? form.values.power : null,
      temperature: form.values.temperatureEnabled ? form.values.temperature : null,
      variables: Object.keys(form.values.variables).length ? form.values.variables : null,
      luftatorConfig: Object.keys(form.values.valveOpenings).length
        ? form.values.valveOpenings
        : null,
      enabled: form.values.enabled,
    });
  }

  if (!season) return null;

  const editableVariables = hruVariables.filter((variable) => variable.editable);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t(
        initial ? "settings.timeline.seasons.editTitle" : "settings.timeline.seasons.createTitle",
        {
          season: t(`settings.timeline.seasons.${season}`),
        },
      )}
      size="lg"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <Select
            label={t("settings.timeline.seasons.baseModeLabel")}
            data={modes.map((mode) => ({ value: String(mode.id), label: mode.name }))}
            value={String(form.values.baseModeId || "")}
            onChange={(value) => form.setFieldValue("baseModeId", value ? Number(value) : 0)}
            required
          />

          <Fieldset legend={t("settings.timeline.hruSettings")} radius="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Stack gap="xs">
                <Switch
                  label={t("settings.timeline.seasons.overridePower")}
                  checked={form.values.powerEnabled}
                  onChange={(event) =>
                    form.setFieldValue("powerEnabled", event.currentTarget.checked)
                  }
                />
                {form.values.powerEnabled && (
                  <NumberInput
                    value={form.values.power}
                    onChange={(value) =>
                      form.setFieldValue("power", typeof value === "number" ? value : 0)
                    }
                    min={0}
                    max={maxPower}
                    leftSection={<IconWind size={16} stroke={1.5} />}
                  />
                )}
              </Stack>

              <Stack gap="xs">
                <Switch
                  label={t("settings.timeline.seasons.overrideTemperature")}
                  checked={form.values.temperatureEnabled}
                  onChange={(event) =>
                    form.setFieldValue("temperatureEnabled", event.currentTarget.checked)
                  }
                />
                {form.values.temperatureEnabled && (
                  <NumberInput
                    value={form.values.temperature}
                    onChange={(value) =>
                      form.setFieldValue("temperature", typeof value === "number" ? value : 0)
                    }
                    leftSection={<IconSettings size={16} stroke={1.5} />}
                  />
                )}
              </Stack>
            </SimpleGrid>
          </Fieldset>

          {editableVariables.length > 0 && (
            <Fieldset legend={t("settings.timeline.seasons.overrideVariables")} radius="md">
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {editableVariables.map((variable) => {
                  const enabled = isVariableEnabled(form.values.variables, variable.name);
                  const label = localized(variable.label, t);
                  const value = form.values.variables[variable.name];
                  return (
                    <Stack key={variable.name} gap="xs">
                      <Switch
                        label={label}
                        checked={enabled}
                        onChange={(event) =>
                          setVariableEnabled(variable, event.currentTarget.checked)
                        }
                      />
                      {enabled && variable.type === "select" && variable.options && (
                        <Select
                          data={variable.options.map((option) => ({
                            value: String(option.value),
                            label: localized(option.label, t),
                          }))}
                          value={String(value)}
                          onChange={(next) =>
                            setVariableValue(variable, next ? Number.parseInt(next, 10) : 0)
                          }
                        />
                      )}
                      {enabled && variable.type === "boolean" && (
                        <Switch
                          label={t("settings.timeline.enabled")}
                          checked={value === 1 || value === true}
                          onChange={(event) =>
                            setVariableValue(variable, event.currentTarget.checked ? 1 : 0)
                          }
                        />
                      )}
                      {enabled && variable.type !== "select" && variable.type !== "boolean" && (
                        <NumberInput
                          value={typeof value === "number" ? value : 0}
                          min={variable.min}
                          max={
                            variable.class === "power" && variable.maxConfigurable
                              ? maxPower
                              : variable.max
                          }
                          step={variable.step}
                          onChange={(next) =>
                            setVariableValue(variable, typeof next === "number" ? next : 0)
                          }
                        />
                      )}
                    </Stack>
                  );
                })}
              </SimpleGrid>
            </Fieldset>
          )}

          {valves.length > 0 && (
            <Fieldset
              legend={
                <Group gap="xs">
                  <IconDroplet size={16} color="var(--mantine-primary-color-5)" stroke={1.5} />
                  <Text size="sm" fw={600}>
                    {t("settings.timeline.seasons.overrideValves")}
                  </Text>
                </Group>
              }
              radius="md"
            >
              <Stack gap="md">
                {valves.map((valve, index) => {
                  const key = getValveKey(valve, index);
                  const enabled = Object.hasOwn(form.values.valveOpenings, key);
                  const opening = form.values.valveOpenings[key] ?? 0;
                  const statusColor = getValveStatusColor(opening, valve.min, valve.max);
                  return (
                    <Stack key={key} gap="xs">
                      <Group justify="space-between">
                        <Switch
                          label={valve.name || key}
                          checked={enabled}
                          onChange={(event) => setValveEnabled(key, event.currentTarget.checked)}
                        />
                        {enabled && (
                          <Text size="xs" c="dimmed">
                            {formatValveValue(opening, valve.min, valve.max, t)}
                          </Text>
                        )}
                      </Group>
                      {enabled && (
                        <ValveSlider
                          value={opening}
                          min={valve.min}
                          max={valve.max}
                          step={valve.step}
                          onChange={(value) => setValveValue(key, value)}
                          color={statusColor}
                          size="lg"
                          label={null}
                        />
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            </Fieldset>
          )}

          <Switch
            label={t("settings.timeline.enabled")}
            checked={form.values.enabled}
            onChange={(event) => form.setFieldValue("enabled", event.currentTarget.checked)}
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("settings.timeline.modal.cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("settings.timeline.modal.save")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
