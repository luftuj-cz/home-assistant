import {
  Modal,
  Stack,
  TextInput,
  Group,
  NumberInput,
  Text,
  Button,
  ColorInput,
  Fieldset,
  Slider,
  Badge,
  Switch,
  Select,
  Alert,
  SimpleGrid,
} from "@mantine/core";
import {
  IconFileText,
  IconThermometer,
  IconDroplet,
  IconPlus,
  IconEdit,
  IconPalette,
  IconSettings,
  IconAlertCircle,
  IconTestPipe,
  IconWind,
} from "@tabler/icons-react";
import { useEffect, useState, useRef } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "../../types/timeline";
import type { Valve } from "../../types/valve";
import { cancelBoost, testTimelineMode } from "../../api/timeline";
import { notifications } from "@mantine/notifications";
import type { HruVariable, LocalizedText } from "../../api/hru";

interface TimelineModeModalProps {
  opened: boolean;
  mode: Mode | null;
  valves: Valve[];
  saving: boolean;
  onClose: () => void;
  onSave: (mode: Partial<Mode>) => void;
  t: TFunction;
  hruVariables?: HruVariable[];
  powerUnit?: string;
  maxPower?: number;
  existingModes?: Mode[];
  unitId?: string;
  nameError?: string | null;
  onNameChange?: () => void;
}

export function TimelineModeModal({
  opened,
  mode,
  valves,
  saving,
  onClose,
  onSave,
  t,
  hruVariables = [],
  existingModes = [],
  nameError,
  onNameChange,
}: TimelineModeModalProps) {
  const [name, setName] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, number | string | boolean>>(
    {},
  );
  const [color, setColor] = useState("");
  const [isBoost, setIsBoost] = useState(false);
  const [valveOpenings, setValveOpenings] = useState<Record<string, number | undefined>>({});
  const [submitted, setSubmitted] = useState(false);
  const [testRemainingSeconds, setTestRemainingSeconds] = useState<number | null>(null);
  const testTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function getLocalizedText(text: LocalizedText): string {
    if (typeof text === "string") return t(text, { defaultValue: text });
    if (text.translate) return t(text.text, { defaultValue: text.text });
    return text.text;
  }

  const allValvesClosed =
    valves.length > 0 &&
    valves.every((v) => {
      const key = v.entityId || v.name;
      const val = valveOpenings[key] ?? 0;
      return val >= 90;
    });

  useEffect(() => {
    if (opened) {
      setSubmitted(false);
      if (mode) {
        setName(mode.name);
        setVariableValues(mode.variables || {});
        setColor(mode.color ?? "");
        setIsBoost(mode.isBoost ?? false);
        setValveOpenings(mode.luftatorConfig ?? {});
      } else {
        setName("");
        setVariableValues({});
        setColor("");
        setIsBoost(false);
        setValveOpenings({});
      }
    } else {
      // Clear test state on close
      setTestRemainingSeconds(null);
      if (testTimerRef.current) {
        clearInterval(testTimerRef.current);
        testTimerRef.current = null;
      }
    }
  }, [opened, mode]);

  // Countdown timer effect
  useEffect(() => {
    if (testRemainingSeconds !== null && testRemainingSeconds > 0) {
      testTimerRef.current = setInterval(() => {
        setTestRemainingSeconds((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(testTimerRef.current!);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (testTimerRef.current) clearInterval(testTimerRef.current);
    };
  }, [testRemainingSeconds]);

  function getModePayload() {
    const trimmedName = name.trim();
    const cleanedValveOpenings = valves.reduce(
      (acc, valve) => {
        const key = valve.entityId || valve.name;
        if (!key) return acc;

        const value = valveOpenings[key] ?? 0;

        if (!Number.isNaN(value) && value >= 0 && value <= 100) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      name: trimmedName,
      variables: variableValues,
      color: color || undefined,
      isBoost,
      luftatorConfig: Object.keys(cleanedValveOpenings).length ? cleanedValveOpenings : undefined,
    };
  }

  function validateForm(): boolean {
    const trimmedName = name.trim();
    if (!trimmedName) {
      notifications.show({
        title: t("settings.timeline.notifications.validationFailedTitle"),
        message: t("validation.requiredField"),
        color: "red",
      });
      return false;
    }

    return true;
  }

  function handleTest() {
    if (testRemainingSeconds !== null) {
      // STOP Test
      cancelBoost().then(() => {
        setTestRemainingSeconds(null);
        if (testTimerRef.current) {
          clearInterval(testTimerRef.current);
          testTimerRef.current = null;
        }
        notifications.show({
          title: t("settings.timeline.notifications.testStoppedTitle"),
          message: t("settings.timeline.notifications.testStoppedMessage"),
        });
      });
      return;
    }

    setSubmitted(true);
    if (!validateForm()) return;

    const payload = getModePayload();

    // Dynamic import to avoid circular dependencies if any, although unlikely here
    testTimelineMode(payload, 1)
      .then(() => {
        setTestRemainingSeconds(60);
        notifications.show({
          title: t("settings.timeline.notifications.testStartedTitle"),
          message: t("settings.timeline.notifications.testStartedMessage"),
          color: "blue",
        });
      })
      .catch((err) => {
        notifications.show({
          title: t("valves.alertTitle"),
          message: err.message || t("settings.timeline.notifications.unknown"),
          color: "red",
        });
      });
  }

  function handleSave() {
    setSubmitted(true);
    if (!validateForm()) return;

    const payload = getModePayload();

    // Duplicate Check only for Save
    const isDuplicate = existingModes.some(
      (m) => m.name.toLowerCase() === payload.name.toLowerCase() && (!mode || m.id !== mode.id),
    );

    if (isDuplicate) {
      notifications.show({
        title: t("settings.timeline.notifications.validationFailedTitle"),
        message: t("validation.duplicateModeName"),
        color: "red",
      });
      return;
    }

    onSave({ ...payload, id: mode?.id });
  }

  const editableVariables = hruVariables.filter((v) => v.editable);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          {mode ? (
            <IconEdit size={20} color="var(--mantine-primary-color-5)" />
          ) : (
            <IconPlus size={20} color="var(--mantine-primary-color-5)" />
          )}
          <Text fw={600}>
            {t(mode ? "settings.timeline.modeEditTitle" : "settings.timeline.modeDialogTitle")}
          </Text>
        </Group>
      }
      size="lg"
      radius="md"
    >
      <Stack gap="md">
        <TextInput
          label={t("settings.timeline.modeName")}
          placeholder={t("settings.timeline.modePlaceholder")}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            onNameChange?.();
          }}
          leftSection={<IconFileText size={16} stroke={1.5} />}
          error={nameError || (!name.trim() && submitted ? t("validation.required") : null)}
          required
          styles={{ error: { position: "absolute", bottom: -20 } }}
        />

        {editableVariables.length > 0 && (
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
              {editableVariables.map((variable) => {
                const label = getLocalizedText(variable.label);
                const unit = variable.unit ? getLocalizedText(variable.unit) : "";
                const val = variableValues[variable.name];

                if (variable.type === "boolean") {
                  return (
                    <Switch
                      key={variable.name}
                      label={label}
                      checked={val === 1}
                      onChange={(e) => {
                        const checked = e?.currentTarget?.checked ?? false;
                        setVariableValues((prev) => ({
                          ...prev,
                          [variable.name]: checked ? 1 : 0,
                        }));
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
                        label: getLocalizedText(opt.label),
                      }))}
                      value={val !== undefined ? val.toString() : null}
                      onChange={(v) =>
                        setVariableValues((prev) => ({
                          ...prev,
                          [variable.name]: v ? parseInt(v, 10) : 0,
                        }))
                      }
                      leftSection={
                        variable.class === "mode" ? (
                          <IconSettings size={16} stroke={1.5} />
                        ) : undefined
                      }
                      required
                      error={val === undefined && submitted ? t("validation.required") : null}
                    />
                  );
                }

                return (
                  <NumberInput
                    key={variable.name}
                    label={`${label}${unit ? ` (${unit})` : ""}`}
                    value={typeof val === "number" ? val : undefined}
                    onChange={(v) =>
                      setVariableValues((prev) => ({
                        ...prev,
                        [variable.name]: typeof v === "number" ? v : 0,
                      }))
                    }
                    min={variable.min}
                    max={variable.max}
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
        )}

        {valves.length > 0 && (
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
            {allValvesClosed && (
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

                // Use a consistent key for storage (state/config)
                const storageKey = v.entityId || key;

                const backendValue = valveOpenings[storageKey] ?? 0;

                // Backend 0 (Open) -> UI 90 (Max). Backend 90 (Closed) -> UI 0.
                const uiValue = 90 - backendValue;

                const statusColor =
                  backendValue >= 90 ? "red" : backendValue <= 0 ? "green" : "orange";

                let badgeText = `${Math.round(90 - backendValue)}°`;
                if (backendValue === 0) badgeText = t("valves.status.open");
                if (backendValue >= 90) badgeText = t("valves.status.closed");

                return (
                  <Stack key={key} gap={0}>
                    <Group justify="space-between" mb={4}>
                      <div>
                        <Text size="sm" fw={500} lh={1.2}>
                          {name}
                        </Text>
                        {entityId && (
                          <Text size="xs" c="dimmed">
                            {entityId}
                          </Text>
                        )}
                      </div>
                      <Badge variant="light" color={statusColor}>
                        {badgeText}
                      </Badge>
                    </Group>
                    <Slider
                      value={uiValue}
                      onChange={(val) =>
                        setValveOpenings((prev) => ({
                          ...prev,
                          [storageKey]: 90 - val,
                        }))
                      }
                      min={0}
                      max={90}
                      step={5}
                      marks={[]}
                      label={null}
                      size="lg"
                      color={statusColor}
                      thumbSize={22}
                    />
                  </Stack>
                );
              })}
            </Stack>
          </Fieldset>
        )}

        <ColorInput
          label={t("settings.timeline.modeColor")}
          placeholder={t("settings.timeline.modeColorPlaceholder")}
          value={color}
          onChange={setColor}
          leftSection={<IconPalette size={16} stroke={1.5} />}
        />

        <Switch
          label={t("settings.timeline.modeIsBoost")}
          description={t("settings.timeline.modeIsBoostDescription")}
          checked={isBoost}
          onChange={(e) => setIsBoost(e.currentTarget.checked)}
        />

        <Group justify="flex-end" gap="sm" mt="xs">
          <Button variant="light" onClick={onClose} radius="md">
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button
            variant="outline"
            leftSection={<IconTestPipe size={16} />}
            onClick={handleTest}
            color={testRemainingSeconds !== null ? "red" : "blue"}
          >
            {testRemainingSeconds !== null
              ? `${t("settings.timeline.modal.cancel")} (${testRemainingSeconds}s)`
              : t("settings.timeline.modal.test")}
          </Button>
          <Button onClick={handleSave} loading={saving} radius="md">
            {t(mode ? "settings.timeline.modeUpdateAction" : "settings.timeline.modeCreateAction")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
