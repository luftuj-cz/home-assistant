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
} from "@mantine/core";
import {
  IconFileText,
  IconBolt,
  IconThermometer,
  IconDroplet,
  IconPlus,
  IconEdit,
  IconPalette,
  IconSettings,
  IconAlertCircle,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "../../types/timeline";
import type { Valve } from "../../types/valve";
import { formatTemperature, parseTemperature, getTemperatureLabel } from "../../utils/temperature";
import type { TemperatureUnit } from "../../hooks/useDashboardStatus";

// Quick fetch fallback if service not imported
async function fetchNativeModes(unitId?: string) {
  const query = unitId ? `?unitId=${unitId}` : "";
  const res = await fetch(`/api/hru/modes${query}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.modes as { id: number; name: string }[];
}

interface TimelineModeModalProps {
  opened: boolean;
  mode: Mode | null;
  valves: Valve[];
  saving: boolean;
  onClose: () => void;
  onSave: (mode: Partial<Mode>) => void;
  t: TFunction;
  hruCapabilities?: {
    hasPowerControl?: boolean;
    hasTemperatureControl?: boolean;
    hasModeControl?: boolean;
  };
  powerUnit?: string;
  maxPower?: number;
  temperatureUnit?: TemperatureUnit;
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
  hruCapabilities,
  powerUnit = "%",
  maxPower = 100,
  temperatureUnit = "c",
  existingModes = [],
  unitId,
  nameError,
  onNameChange,
}: TimelineModeModalProps) {
  const [name, setName] = useState("");
  const [power, setPower] = useState<number | undefined>(undefined);
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [color, setColor] = useState("");
  const [isBoost, setIsBoost] = useState(false);
  const [valveOpenings, setValveOpenings] = useState<Record<string, number | undefined>>({});
  const [nativeMode, setNativeMode] = useState<string | null>(null);
  const [availableNativeModes, setAvailableNativeModes] = useState<
    { value: string; label: string }[]
  >([]);

  useEffect(() => {
    if (opened && hruCapabilities?.hasModeControl) {
      fetchNativeModes(unitId).then((modes) => {
        setAvailableNativeModes(modes.map((m) => ({ value: m.id.toString(), label: m.name })));
      });
    }
  }, [opened, hruCapabilities, unitId]);

  const allValvesClosed =
    valves.length > 0 &&
    valves.every((v) => {
      const key = v.entityId || v.name;
      const val = valveOpenings[key] ?? 0;
      return val >= 90;
    });

  useEffect(() => {
    if (opened) {
      if (mode) {
        setName(mode.name);
        setPower(mode.power);
        setTemperature(
          mode.temperature !== undefined
            ? formatTemperature(mode.temperature, temperatureUnit)
            : undefined,
        );
        setColor(mode.color ?? "");
        setIsBoost(mode.isBoost ?? false);
        setValveOpenings(mode.luftatorConfig ?? {});
        setNativeMode(mode.nativeMode !== undefined ? mode.nativeMode.toString() : null);
      } else {
        setName("");
        setPower(undefined);
        setTemperature(undefined);
        setColor("");
        setIsBoost(false);
        setValveOpenings({});
        setNativeMode(null);
      }
    }
  }, [opened, mode, temperatureUnit]);

  function handleSave() {
    // Duplicate Check
    const trimmedName = name.trim();
    if (!trimmedName) {
      // Just in case, though required field handles UI
      return;
    }

    const isDuplicate = existingModes.some(
      (m) => m.name.toLowerCase() === trimmedName.toLowerCase() && (!mode || m.id !== mode.id), // Ignore self usage if editing
    );

    if (isDuplicate) {
      import("@mantine/notifications").then(({ notifications }) => {
        notifications.show({
          title: t("settings.timeline.notifications.validationFailedTitle", {
            defaultValue: "Validation Error",
          }),
          message: t("validation.duplicateModeName", {
            defaultValue: "A mode with this name already exists.",
          }),
          color: "red",
        });
      });
      return;
    }

    const cleanedValveOpenings = valves.reduce(
      (acc, valve) => {
        const key = valve.entityId || valve.name;
        if (!key) return acc;

        const value = valveOpenings[key] ?? 0;

        if (typeof value === "number" && !Number.isNaN(value) && value >= 0 && value <= 100) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    onSave({
      id: mode?.id,
      name: trimmedName,
      power,
      temperature:
        temperature !== undefined ? parseTemperature(temperature, temperatureUnit) : undefined,
      color: color || undefined,
      isBoost,
      luftatorConfig: Object.keys(cleanedValveOpenings).length ? cleanedValveOpenings : undefined,
      nativeMode: nativeMode ? parseInt(nativeMode, 10) : undefined,
    });
  }

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
            {t(mode ? "settings.timeline.modeEditTitle" : "settings.timeline.modeDialogTitle", {
              defaultValue: mode ? "Edit mode" : "Create mode",
            })}
          </Text>
        </Group>
      }
      size="md"
      radius="md"
    >
      <Stack gap="md">
        <TextInput
          label={t("settings.timeline.modeName", { defaultValue: "Mode name" })}
          placeholder={t("settings.timeline.modePlaceholder", { defaultValue: "e.g., Comfort" })}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            onNameChange?.();
          }}
          leftSection={<IconFileText size={16} stroke={1.5} />}
          error={nameError}
          required
        />

        {hruCapabilities?.hasModeControl && (
          <Select
            label={t("settings.timeline.nativeMode", { defaultValue: "Native Unit Mode" })}
            placeholder={t("settings.timeline.nativeModePlaceholder", {
              defaultValue: "Select mode...",
            })}
            data={availableNativeModes}
            value={nativeMode}
            onChange={setNativeMode}
            leftSection={<IconSettings size={16} stroke={1.5} />}
            clearable
          />
        )}

        <Group grow>
          {hruCapabilities?.hasPowerControl !== false && (
            <NumberInput
              label={`${t("settings.timeline.modePower", { defaultValue: "Power" })} (${t(`app.units.${powerUnit}`, { defaultValue: powerUnit })})`}
              placeholder="50"
              value={power}
              onChange={(value) => setPower(typeof value === "number" ? value : undefined)}
              min={0}
              max={maxPower}
              step={1}
              leftSection={<IconBolt size={16} stroke={1.5} />}
            />
          )}
          {hruCapabilities?.hasTemperatureControl !== false && (
            <NumberInput
              label={`${t("settings.timeline.modeTemperature", { defaultValue: "Temperature" })} (${getTemperatureLabel(temperatureUnit)})`}
              placeholder="21"
              value={temperature}
              onChange={(value) => setTemperature(typeof value === "number" ? value : undefined)}
              min={-50}
              max={100}
              step={0.5}
              leftSection={<IconThermometer size={16} stroke={1.5} />}
            />
          )}
        </Group>

        {valves.length > 0 && (
          <Fieldset
            legend={
              <Group gap="xs">
                <IconDroplet size={16} color="var(--mantine-primary-color-5)" stroke={1.5} />
                <Text size="sm" fw={600}>
                  {t("settings.timeline.modeValves", { defaultValue: "Valve openings" })}
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
          label={t("settings.timeline.modeColor", { defaultValue: "Color (optional)" })}
          placeholder={t("settings.timeline.modeColorPlaceholder", {
            defaultValue: "#228be6 or blue",
          })}
          value={color}
          onChange={setColor}
          leftSection={<IconPalette size={16} stroke={1.5} />}
        />

        <Switch
          label={t("settings.timeline.modeIsBoost", { defaultValue: "Show as boost button" })}
          description={t("settings.timeline.modeIsBoostDescription")}
          checked={isBoost}
          onChange={(e) => setIsBoost(e.currentTarget.checked)}
        />

        <Group justify="flex-end" gap="sm" mt="xs">
          <Button variant="light" onClick={onClose} radius="md">
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button onClick={handleSave} loading={saving} radius="md">
            {t(mode ? "settings.timeline.modeUpdateAction" : "settings.timeline.modeCreateAction", {
              defaultValue: mode ? "Update" : "Create",
            })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
