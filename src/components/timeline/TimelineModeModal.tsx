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
} from "@mantine/core";
import {
  IconFileText,
  IconBolt,
  IconThermometer,
  IconDroplet,
  IconPlus,
  IconEdit,
  IconPalette,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "../../types/timeline";
import type { Valve } from "../../types/valve";

interface TimelineModeModalProps {
  opened: boolean;
  mode: Mode | null; // if null, creating new
  valves: Valve[];
  saving: boolean;
  onClose: () => void;
  onSave: (mode: Partial<Mode>) => void;
  t: TFunction;
  hruCapabilities?: {
    supportsPowerWrite?: boolean;
    supportsTemperatureWrite?: boolean;
  };
  powerUnit?: string;
  temperatureUnit?: string;
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
  // TODO: get from config or device info (definice HRU)
  powerUnit = "%",
  temperatureUnit = "°C",
}: TimelineModeModalProps) {
  const [name, setName] = useState("");
  const [power, setPower] = useState<number | undefined>(undefined);
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [color, setColor] = useState("");
  const [isBoost, setIsBoost] = useState(false);
  const [valveOpenings, setValveOpenings] = useState<Record<string, number | undefined>>({});

  useEffect(() => {
    if (opened) {
      if (mode) {
        setName(mode.name);
        setPower(mode.power);
        setTemperature(mode.temperature);
        setColor(mode.color ?? "");
        setIsBoost(mode.isBoost ?? false);
        setValveOpenings(mode.luftatorConfig ?? {});
      } else {
        setName("");
        setPower(undefined);
        setTemperature(undefined);
        setColor("");
        setIsBoost(false);
        setValveOpenings({});
      }
    }
  }, [opened, mode]);

  function handleSave() {
    // Filter undefined/invalid
    const cleanedValveOpenings = Object.fromEntries(
      Object.entries(valveOpenings).filter(
        ([, value]) =>
          typeof value === "number" && !Number.isNaN(value) && value >= 0 && value <= 100,
      ),
    ) as Record<string, number>;

    onSave({
      id: mode?.id,
      name,
      power,
      temperature,
      color: color || undefined,
      isBoost,
      luftatorConfig: Object.keys(cleanedValveOpenings).length ? cleanedValveOpenings : undefined,
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
          onChange={(e) => setName(e.target.value)}
          leftSection={<IconFileText size={16} stroke={1.5} />}
          required
        />
        <Group grow>
          {hruCapabilities?.supportsPowerWrite !== false && (
            <NumberInput
              label={`${t("settings.timeline.modePower", { defaultValue: "Power" })} (${powerUnit})`}
              placeholder="50"
              value={power}
              onChange={(value) => setPower(typeof value === "number" ? value : undefined)}
              min={0}
              max={100}
              step={1}
              leftSection={<IconBolt size={16} stroke={1.5} />}
            />
          )}
          {hruCapabilities?.supportsTemperatureWrite !== false && (
            <NumberInput
              label={`${t("settings.timeline.modeTemperature", { defaultValue: "Temperature" })} (${temperatureUnit})`}
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
            <Stack gap="xs">
              {valves.map((v, idx) => {
                const key = v.entityId || v.name || `valve-${idx}`;
                const name = v.name || `Valve ${idx + 1}`;
                const entityId = v.entityId || "";

                // Use a consistent key for storage (state/config)
                const storageKey = v.entityId || key;

                const backendValue = valveOpenings[storageKey] ?? 90;

                // Backend 0 (Open) -> UI 90 (Max). Backend 90 (Closed) -> UI 0.
                const uiValue = 90 - backendValue;

                const statusColor =
                  backendValue >= 90 ? "red" : backendValue <= 0 ? "green" : "orange";

                let badgeText = `${Math.round(90 - backendValue)}°`;
                if (backendValue === 0) badgeText = "OPEN";
                if (backendValue >= 90) badgeText = "CLOSED";

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
