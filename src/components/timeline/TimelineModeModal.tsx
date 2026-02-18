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
  IconTestPipe,
} from "@tabler/icons-react";
import { useEffect, useState, useRef } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "../../types/timeline";
import type { Valve } from "../../types/valve";
import { formatTemperature, parseTemperature, getTemperatureLabel } from "../../utils/temperature";
import { resolveApiUrl } from "../../utils/api";
import type { TemperatureUnit } from "../../hooks/useDashboardStatus";

// Quick fetch fallback if service not imported
async function fetchNativeModes(unitId?: string) {
  const query = unitId ? `?unitId=${unitId}` : "";
  const res = await fetch(resolveApiUrl(`/api/hru/modes${query}`));
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
  const [submitted, setSubmitted] = useState(false);
  const [testRemainingSeconds, setTestRemainingSeconds] = useState<number | null>(null);
  const testTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setSubmitted(false);
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
    } else {
      // Clear test state on close
      setTestRemainingSeconds(null);
      if (testTimerRef.current) {
        clearInterval(testTimerRef.current);
        testTimerRef.current = null;
      }
    }
  }, [opened, mode, temperatureUnit]);

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

        if (typeof value === "number" && !Number.isNaN(value) && value >= 0 && value <= 100) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      // id is ignored by create but used by update, handled by wrapper
      name: trimmedName,
      power,
      temperature:
        temperature !== undefined ? parseTemperature(temperature, temperatureUnit) : undefined,
      color: color || undefined,
      isBoost,
      luftatorConfig: Object.keys(cleanedValveOpenings).length ? cleanedValveOpenings : undefined,
      nativeMode: nativeMode ? parseInt(nativeMode, 10) : undefined,
    };
  }

  function validateForm(): boolean {
    const trimmedName = name.trim();
    if (!trimmedName) {
      import("@mantine/notifications").then(({ notifications }) => {
        notifications.show({
          title: t("settings.timeline.notifications.validationFailedTitle"),
          message: t("validation.requiredField"),
          color: "red",
        });
      });
      return false;
    }

    // Capability Validation
    if (hruCapabilities?.hasModeControl && !nativeMode) {
      import("@mantine/notifications").then(({ notifications }) => {
        notifications.show({
          title: t("settings.timeline.notifications.validationFailedTitle"),
          message: t("validation.nativeModeRequired"),
          color: "red",
        });
      });
      return false;
    }

    if (hruCapabilities?.hasPowerControl !== false && power === undefined) {
      import("@mantine/notifications").then(({ notifications }) => {
        notifications.show({
          title: t("settings.timeline.notifications.validationFailedTitle"),
          message: t("validation.powerRequired"),
          color: "red",
        });
      });
      return false;
    }

    if (hruCapabilities?.hasTemperatureControl !== false && temperature === undefined) {
      import("@mantine/notifications").then(({ notifications }) => {
        notifications.show({
          title: t("settings.timeline.notifications.validationFailedTitle"),
          message: t("validation.temperatureRequired"),
          color: "red",
        });
      });
      return false;
    }

    return true;
  }

  function handleTest() {
    if (testRemainingSeconds !== null) {
      // STOP Test
      import("../../api/timeline").then(({ cancelBoost }) => {
        cancelBoost().then(() => {
          setTestRemainingSeconds(null);
          if (testTimerRef.current) {
            clearInterval(testTimerRef.current);
            testTimerRef.current = null;
          }
          import("@mantine/notifications").then(({ notifications }) => {
            notifications.show({
              title: t("settings.timeline.notifications.testStoppedTitle"),
              message: t("settings.timeline.notifications.testStoppedMessage"),
            });
          });
        });
      });
      return;
    }

    setSubmitted(true);
    if (!validateForm()) return;

    const payload = getModePayload();

    // Dynamic import to avoid circular dependencies if any, although unlikely here
    import("../../api/timeline").then(({ testTimelineMode }) => {
      testTimelineMode(payload, 1)
        .then(() => {
          setTestRemainingSeconds(60);
          import("@mantine/notifications").then(({ notifications }) => {
            notifications.show({
              title: t("settings.timeline.notifications.testStartedTitle"),
              message: t("settings.timeline.notifications.testStartedMessage"),
              color: "blue",
            });
          });
        })
        .catch((err) => {
          import("@mantine/notifications").then(({ notifications }) => {
            notifications.show({
              title: "Error",
              message: err.message || "Failed to start test mode",
              color: "red",
            });
          });
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
      import("@mantine/notifications").then(({ notifications }) => {
        notifications.show({
          title: t("settings.timeline.notifications.validationFailedTitle"),
          message: t("validation.duplicateModeName"),
          color: "red",
        });
      });
      return;
    }

    onSave({ ...payload, id: mode?.id });
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
            {t(mode ? "settings.timeline.modeEditTitle" : "settings.timeline.modeDialogTitle")}
          </Text>
        </Group>
      }
      size="md"
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
          error={
            nameError ||
            (!name.trim() && submitted
              ? t("validation.required")
              : null)
          }
          required
          styles={{ error: { position: "absolute", bottom: -20 } }}
        />

        {hruCapabilities?.hasModeControl && (
          <Select
            label={t("settings.timeline.nativeMode")}
            placeholder={t("settings.timeline.nativeModePlaceholder")}
            data={availableNativeModes}
            value={nativeMode}
            onChange={setNativeMode}
            leftSection={<IconSettings size={16} stroke={1.5} />}
            clearable
            required
            error={
              nativeMode === null && submitted
                ? t("validation.required")
                : null
            }
            styles={{ error: { position: "absolute", bottom: -20 } }}
          />
        )}

        <Group grow>
          {hruCapabilities?.hasPowerControl !== false && (
            <NumberInput
              label={`${t("settings.timeline.modePower")} (${t(`app.units.${powerUnit}`)})`}
              placeholder="50"
              value={power}
              onChange={(value) => setPower(typeof value === "number" ? value : undefined)}
              min={0}
              max={maxPower}
              step={1}
              leftSection={<IconBolt size={16} stroke={1.5} />}
              required
              error={
                power === undefined && submitted
                  ? t("validation.required")
                  : null
              }
              styles={{ error: { position: "absolute", bottom: -20 } }}
            />
          )}
          {hruCapabilities?.hasTemperatureControl !== false && (
            <NumberInput
              label={`${t("settings.timeline.modeTemperature")} (${getTemperatureLabel(temperatureUnit)})`}
              placeholder="21"
              value={temperature}
              onChange={(value) => setTemperature(typeof value === "number" ? value : undefined)}
              min={-50}
              max={100}
              step={0.5}
              leftSection={<IconThermometer size={16} stroke={1.5} />}
              required
              error={
                temperature === undefined && submitted
                  ? t("validation.required")
                  : null
              }
              styles={{ error: { position: "absolute", bottom: -20 } }}
            />
          )}
        </Group>

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
