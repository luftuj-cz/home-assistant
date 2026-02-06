import { useCallback, useMemo, useState, useEffect } from "react";
import { type HruUnit } from "../api/hru";
import {
  Button,
  FileButton,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Title,
  TextInput,
  NumberInput,
  Select,
  Alert,
  PasswordInput,
  useMantineColorScheme,
  useComputedColorScheme,
  Accordion,
  SimpleGrid,
  Paper,
  Badge,
  Container,
} from "@mantine/core";
import {
  IconDownload,
  IconUpload,
  IconLanguage,
  IconMoon,
  IconSun,
  IconSettings,
  IconServer,
  IconDatabase,
  IconCheck,
  IconTemperature,
  IconCode,
  IconBug,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { resolveApiUrl } from "../utils/api";
import { logger } from "../utils/logger";
import { setLanguage } from "../i18n";
import { MotionSwitch } from "../components/common/MotionSwitch";
import { formatTemperature, getTemperatureLabel } from "../utils/temperature";
import { type TemperatureUnit } from "../utils/temperature";

export function SettingsPage() {
  const [uploading, setUploading] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [tempUnit, setTempUnit] = useState<TemperatureUnit>("c");
  const [savingTempUnit, setSavingTempUnit] = useState(false);
  const [savingHru, setSavingHru] = useState(false);
  const [probingHru, setProbingHru] = useState(false);
  const [fullHruUnits, setFullHruUnits] = useState<HruUnit[]>([]);
  const [hruUnits, setHruUnits] = useState<Array<{ value: string; label: string }>>([]);
  const [hruSettings, setHruSettings] = useState({
    unit: null as string | null,
    host: "localhost",
    port: 502,
    unitId: 1,
    maxPower: undefined as number | undefined,
  });
  const [probeResult, setProbeResult] = useState<{
    power: number;
    temperature: number;
    mode: string;
  } | null>(null);
  const [savingMqtt, setSavingMqtt] = useState(false);
  const [testingMqtt, setTestingMqtt] = useState(false);
  const [mqttSettings, setMqttSettings] = useState({
    enabled: false,
    host: "",
    port: 1883,
    user: "",
    password: "",
  });
  const [debugMode, setDebugMode] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("dark", { getInitialValueInEffect: false });
  const { t, i18n } = useTranslation();

  const themeOptions = useMemo(
    () => [
      { label: t("settings.theme.light"), value: "light" },
      { label: t("settings.theme.dark"), value: "dark" },
    ],
    [t],
  );

  const languageOptions = useMemo(
    () => [
      { label: t("settings.language.options.en"), value: "en" },
      { label: t("settings.language.options.cs"), value: "cs" },
    ],
    [t],
  );

  const tempUnitOptions = useMemo(
    () => [
      { label: t("settings.temperatureUnit.options.c"), value: "c" },
      { label: t("settings.temperatureUnit.options.f"), value: "f" },
    ],
    [t],
  );

  const currentLanguage = useMemo(() => {
    const lang = i18n.language ?? "en";
    const short = lang.split("-")[0];
    return languageOptions.some((option) => option.value === short) ? short : "en";
  }, [i18n.language, languageOptions]);

  const persistThemePreference = useCallback(
    async (value: "light" | "dark") => {
      setSavingTheme(true);
      try {
        const response = await fetch(resolveApiUrl("/api/settings/theme"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme: value }),
        });
        if (!response.ok) {
          const detail = await response.text();
          const message = detail || "Failed to save theme preference";
          notifications.show({
            title: t("settings.theme.notifications.failedTitle"),
            message: t("settings.theme.notifications.failedMessage", {
              message: message || t("settings.theme.notifications.unknown"),
            }),
            color: "red",
          });
          return;
        }
        notifications.show({
          title: t("settings.theme.notifications.updatedTitle"),
          message: t("settings.theme.notifications.updatedMessage", {
            theme: value === "dark" ? t("settings.theme.dark") : t("settings.theme.light"),
          }),
          color: value === "dark" ? "violet" : "blue",
        });
      } catch (persistError) {
        notifications.show({
          title: t("settings.theme.notifications.failedTitle"),
          message: t("settings.theme.notifications.failedMessage", {
            message:
              persistError instanceof Error
                ? persistError.message
                : t("settings.theme.notifications.unknown"),
          }),
          color: "red",
        });
      } finally {
        setSavingTheme(false);
      }
    },
    [t],
  );

  const handleThemeChange = useCallback(
    (value: string) => {
      const scheme = value === "dark" ? "dark" : "light";
      setColorScheme(scheme);
      void persistThemePreference(scheme);
    },
    [persistThemePreference, setColorScheme],
  );

  const persistLanguagePreference = useCallback(
    async (value: string) => {
      const previousLanguage = i18n.language;
      setSavingLanguage(true);
      try {
        await setLanguage(value);

        const response = await fetch(resolveApiUrl("/api/settings/language"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: value }),
        });

        if (!response.ok) {
          const detail = await response.text();
          const message = detail?.trim().length
            ? detail
            : t("settings.language.notifications.unknown");
          await setLanguage(previousLanguage.split("-")[0]);
          notifications.show({
            title: t("settings.language.notifications.failedTitle"),
            message: t("settings.language.notifications.failedMessage", { message }),
            color: "red",
          });
          return;
        }

        const label = languageOptions.find((option) => option.value === value)?.label ?? value;
        notifications.show({
          title: t("settings.language.notifications.updatedTitle"),
          message: t("settings.language.notifications.updatedMessage", { language: label }),
          color: "green",
        });
      } catch (persistError) {
        await setLanguage(previousLanguage);
        notifications.show({
          title: t("settings.language.notifications.failedTitle"),
          message: t("settings.language.notifications.failedMessage", {
            message:
              persistError instanceof Error
                ? persistError.message
                : t("settings.language.notifications.unknown"),
          }),
          color: "red",
        });
      } finally {
        setSavingLanguage(false);
      }
    },
    [i18n.language, languageOptions, t],
  );

  const handleLanguageChange = useCallback(
    (value: string) => {
      void persistLanguagePreference(value);
    },
    [persistLanguagePreference],
  );

  const persistTempUnitPreference = useCallback(
    async (value: string) => {
      setSavingTempUnit(true);
      try {
        const response = await fetch(resolveApiUrl("/api/settings/temperature-unit"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ temperatureUnit: value }),
        });

        if (!response.ok) {
          const detail = await response.text();
          notifications.show({
            title: t("settings.temperatureUnit.notifications.failedTitle"),
            message: t("settings.temperatureUnit.notifications.failedMessage", {
              message: detail || t("settings.temperatureUnit.notifications.unknown"),
            }),
            color: "red",
          });
          return;
        }

        notifications.show({
          title: t("settings.temperatureUnit.notifications.updatedTitle"),
          message: t("settings.temperatureUnit.notifications.updatedMessage", {
            unit: value === "c" ? "Celsius (°C)" : "Fahrenheit (°F)",
          }),
          color: "orange",
        });
      } catch (error) {
        notifications.show({
          title: t("settings.temperatureUnit.notifications.failedTitle"),
          message: t("settings.temperatureUnit.notifications.failedMessage", {
            message:
              error instanceof Error
                ? error.message
                : t("settings.temperatureUnit.notifications.unknown"),
          }),
          color: "red",
        });
      } finally {
        setSavingTempUnit(false);
      }
    },
    [t],
  );

  const handleTempUnitChange = useCallback(
    (value: string) => {
      setTempUnit(value as TemperatureUnit);
      void persistTempUnitPreference(value);
    },
    [persistTempUnitPreference],
  );

  useEffect(() => {
    async function loadData() {
      setLoadingUnits(true);
      try {
        const [unitsRes, settingsRes, mqttRes, tempUnitRes] = await Promise.all([
          fetch(resolveApiUrl("/api/hru/units")),
          fetch(resolveApiUrl("/api/settings/hru")),
          fetch(resolveApiUrl("/api/settings/mqtt")),
          fetch(resolveApiUrl("/api/settings/temperature-unit")),
        ]);

        if (unitsRes.ok) {
          const units = await unitsRes.json();
          setFullHruUnits(units);
          setHruUnits(
            units.map((u: { id: string; name: string }) => ({ value: u.id, label: u.name })),
          );
        }
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          setHruSettings(settings);
        }
        if (mqttRes.ok) {
          const mqtt = await mqttRes.json();
          setMqttSettings({
            enabled: !!mqtt.enabled,
            host: mqtt.host || "",
            port: mqtt.port || 1883,
            user: mqtt.user || "",
            password: mqtt.password || "",
          });
        }
        if (tempUnitRes.ok) {
          const { temperatureUnit } = await tempUnitRes.json();
          setTempUnit(temperatureUnit);
        }

        const debugRes = await fetch(resolveApiUrl("/api/settings/debug-mode"));
        if (debugRes.ok) {
          const { enabled } = await debugRes.json();
          setDebugMode(enabled);
        }
      } catch {
        notifications.show({
          title: t("settings.hru.notifications.loadFailedTitle"),
          message: t("settings.hru.notifications.loadFailedMessage"),
          color: "red",
        });
      } finally {
        setLoadingUnits(false);
      }
    }
    void loadData();
  }, [t]);

  const saveMqttSettings = useCallback(async () => {
    setSavingMqtt(true);
    try {
      const response = await fetch(resolveApiUrl("/api/settings/mqtt"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mqttSettings),
      });

      if (!response.ok) {
        const detail = await response.text();
        notifications.show({
          title: t("settings.mqtt.notifications.saveFailedTitle"),
          message: t("settings.mqtt.notifications.saveFailedMessage", { message: detail }),
          color: "red",
        });
        return;
      }

      notifications.show({
        title: t("settings.mqtt.notifications.saveSuccessTitle"),
        message: t("settings.mqtt.notifications.saveSuccessMessage"),
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: t("settings.mqtt.notifications.saveFailedTitle"),
        message: t("settings.mqtt.notifications.saveFailedMessage", {
          message:
            error instanceof Error ? error.message : t("settings.mqtt.notifications.unknown"),
        }),
        color: "red",
      });
    } finally {
      setSavingMqtt(false);
    }
  }, [mqttSettings, t]);

  const testMqttConnection = useCallback(async () => {
    setTestingMqtt(true);
    try {
      const response = await fetch(resolveApiUrl("/api/settings/mqtt/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mqttSettings),
      });

      if (!response.ok) {
        const detail = await response.text();
        let errorMessage = detail;
        try {
          const json = JSON.parse(detail);
          errorMessage = json.detail || detail;
        } catch {
          // ignore
        }

        notifications.show({
          title: t("settings.mqtt.notifications.testFailedTitle"),
          message: errorMessage,
          color: "red",
        });
        return;
      }

      notifications.show({
        title: t("settings.mqtt.notifications.testSuccessTitle"),
        message: t("settings.mqtt.notifications.testSuccessMessage"),
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: t("settings.mqtt.notifications.testFailedTitle"),
        message: error instanceof Error ? error.message : t("settings.mqtt.notifications.unknown"),
        color: "red",
      });
    } finally {
      setTestingMqtt(false);
    }
  }, [mqttSettings, t]);

  const selectedUnit = useMemo(() => {
    return fullHruUnits.find((u) => u.id === hruSettings.unit);
  }, [fullHruUnits, hruSettings.unit]);

  const saveHruSettings = useCallback(async () => {
    setSavingHru(true);
    try {
      const response = await fetch(resolveApiUrl("/api/settings/hru"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hruSettings),
      });
      if (!response.ok) {
        const detail = await response.text();
        notifications.show({
          title: t("settings.hru.notifications.saveFailedTitle"),
          message: t("settings.hru.notifications.saveFailedMessage", { message: detail }),
          color: "red",
        });
        return;
      }
      notifications.show({
        title: t("settings.hru.notifications.saveSuccessTitle"),
        message: t("settings.hru.notifications.saveSuccessMessage"),
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: t("settings.hru.notifications.saveFailedTitle"),
        message: t("settings.hru.notifications.saveFailedMessage", {
          message: error instanceof Error ? error.message : t("settings.hru.notifications.unknown"),
        }),
        color: "red",
      });
    } finally {
      setSavingHru(false);
    }
  }, [hruSettings, t]);

  const probeHru = useCallback(async () => {
    if (!hruSettings.unit) {
      notifications.show({
        title: t("settings.hru.notifications.probeFailedTitle"),
        message: t("settings.hru.notifications.noUnitSelected"),
        color: "red",
      });
      return;
    }
    setProbingHru(true);
    try {
      const response = await fetch(resolveApiUrl("/api/hru/read"));
      if (!response.ok) {
        const detail = await response.text();
        setProbeResult(null);
        notifications.show({
          title: t("settings.hru.notifications.probeFailedTitle"),
          message: t("settings.hru.notifications.probeFailedMessage", { message: detail }),
          color: "red",
        });
        return;
      }
      const result = await response.json();
      setProbeResult(result.value);
    } catch (error) {
      setProbeResult(null);
      notifications.show({
        title: t("settings.hru.notifications.probeFailedTitle"),
        message: t("settings.hru.notifications.probeFailedMessage", {
          message: error instanceof Error ? error.message : t("settings.hru.notifications.unknown"),
        }),
        color: "red",
      });
    } finally {
      setProbingHru(false);
    }
  }, [hruSettings.unit, t]);

  async function handleExport() {
    try {
      logger.info("Exporting database via frontend action");
      const exportUrl = resolveApiUrl("/api/database/export");
      const response = await logger.timeAsync("settings.exportDatabase", async () =>
        fetch(exportUrl),
      );
      if (!response.ok) {
        logger.error("Database export failed", {
          status: response.status,
        });
        notifications.show({
          title: t("settings.database.notifications.exportFailedTitle"),
          message: t("settings.database.notifications.exportFailedMessage", {
            message: response.statusText || t("settings.database.notifications.unknown"),
          }),
          color: "red",
        });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "luftator.db";
      link.click();
      URL.revokeObjectURL(url);
      notifications.show({
        title: t("settings.database.notifications.exportSuccessTitle"),
        message: t("settings.database.notifications.exportSuccessMessage"),
        color: "green",
      });
      logger.info("Database export completed successfully");
    } catch (exportError) {
      logger.error("Database export failed", { error: exportError });
      notifications.show({
        title: t("settings.database.notifications.exportFailedTitle"),
        message: t("settings.database.notifications.exportFailedMessage", {
          message:
            exportError instanceof Error
              ? exportError.message
              : t("settings.database.notifications.unknown"),
        }),
        color: "red",
      });
    }
  }

  async function handleImport(file: File | null) {
    if (!file) {
      logger.debug("Import aborted: no file selected");
      return;
    }
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      logger.info("Importing database via frontend action", { size: buffer.byteLength });
      const importUrl = resolveApiUrl("/api/database/import");
      const response = await logger.timeAsync("settings.importDatabase", async () =>
        fetch(importUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: buffer,
        }),
      );

      if (!response.ok) {
        const text = await response.text();
        const detail = text || "Import failed";
        logger.error("Database import failed with non-OK response", {
          status: response.status,
          statusText: response.statusText,
          detail,
        });
        notifications.show({
          title: t("settings.database.notifications.importFailedTitle"),
          message: t("settings.database.notifications.importFailedMessage", {
            message: detail || t("settings.database.notifications.unknown"),
          }),
          color: "red",
        });
        return;
      }

      notifications.show({
        title: t("settings.database.notifications.importSuccessTitle"),
        message: t("settings.database.notifications.importSuccessMessage"),
        color: "green",
      });
      logger.info("Database import completed successfully");

      setTimeout(() => window.location.reload(), 1500);
    } catch (importError) {
      logger.error("Database import failed", { error: importError });
      notifications.show({
        title: t("settings.database.notifications.importFailedTitle"),
        message: t("settings.database.notifications.importFailedMessage", {
          message:
            importError instanceof Error
              ? importError.message
              : t("settings.database.notifications.unknown"),
        }),
        color: "red",
      });
    } finally {
      setUploading(false);
      logger.debug("Database import request finished", { uploading: false });
    }
  }

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap={0}>
          <Group gap="sm">
            <IconSettings size={32} color="var(--mantine-primary-color-5)" />
            <Title order={1}>{t("settings.title")}</Title>
          </Group>
          <Text size="lg" c="dimmed" mt="xs">
            {t("settings.description")}
          </Text>
        </Stack>

        <Accordion variant="separated" defaultValue="appearance">
          <Accordion.Item value="appearance">
            <Accordion.Control icon={<IconSun size={20} />}>
              <Text fw={600}>{t("settings.appearance.title")}</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="lg">
                <Paper p="md" withBorder radius="md">
                  <Stack gap="md">
                    <Group gap="sm">
                      <IconLanguage size={20} color="var(--mantine-primary-color-5)" />
                      <Text fw={500}>{t("settings.language.title")}</Text>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {t("settings.language.description")}
                    </Text>
                    <SegmentedControl
                      fullWidth
                      value={currentLanguage}
                      data={languageOptions}
                      onChange={handleLanguageChange}
                      disabled={savingLanguage}
                      size="md"
                    />
                  </Stack>
                </Paper>

                <Paper p="md" withBorder radius="md">
                  <Stack gap="md">
                    <Group gap="sm">
                      {computedColorScheme === "dark" ? (
                        <IconMoon size={20} color="var(--mantine-primary-color-5)" />
                      ) : (
                        <IconSun size={20} color="var(--mantine-primary-color-5)" />
                      )}
                      <Text fw={500}>{t("settings.theme.title")}</Text>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {t("settings.theme.description")}
                    </Text>
                    <SegmentedControl
                      fullWidth
                      value={computedColorScheme}
                      data={themeOptions}
                      onChange={handleThemeChange}
                      disabled={savingTheme}
                      size="md"
                    />
                  </Stack>
                </Paper>

                <Paper p="md" withBorder radius="md">
                  <Stack gap="md">
                    <Group gap="sm">
                      <IconTemperature size={20} color="var(--mantine-primary-color-5)" />
                      <Text fw={500}>{t("settings.temperatureUnit.title")}</Text>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {t("settings.temperatureUnit.description")}
                    </Text>
                    <SegmentedControl
                      fullWidth
                      value={tempUnit}
                      data={tempUnitOptions}
                      onChange={handleTempUnitChange}
                      disabled={savingTempUnit}
                      size="md"
                    />
                  </Stack>
                </Paper>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="hru">
            <Accordion.Control icon={<IconServer size={20} />}>
              <Text fw={600}>{t("settings.hru.title")}</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="lg">
                <Paper p="md" withBorder radius="md">
                  <Stack gap="md">
                    <Text fw={500} size="md">
                      {t("settings.hru.description")}
                    </Text>
                    <Text size="sm" c="blue" fs="italic">
                      {t("settings.hru.saveBeforeProbeHint")}
                    </Text>

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                      <Select
                        data={hruUnits}
                        value={hruSettings.unit ?? ""}
                        onChange={(value) => {
                          setHruSettings((prev) => ({
                            ...prev,
                            unit: value === "" ? null : value,
                          }));
                          setProbeResult(null);
                        }}
                        label={t("settings.hru.unitLabel")}
                        placeholder={t("settings.hru.unitPlaceholder")}
                        disabled={loadingUnits}
                        searchable
                        clearable
                        size="md"
                      />
                      <NumberInput
                        value={hruSettings.port}
                        onChange={(value) => {
                          const numericValue =
                            typeof value === "number" ? value : Number(value ?? 502);
                          setHruSettings((prev) => ({
                            ...prev,
                            port: Number.isFinite(numericValue) ? numericValue : 502,
                          }));
                          setProbeResult(null);
                        }}
                        label={t("settings.hru.portLabel")}
                        min={1}
                        max={65535}
                        step={1}
                        size="md"
                      />
                    </SimpleGrid>

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                      <TextInput
                        value={hruSettings.host}
                        onChange={(e) => {
                          setHruSettings((prev) => ({ ...prev, host: e.target.value }));
                          setProbeResult(null);
                        }}
                        label={t("settings.hru.hostLabel")}
                        placeholder="localhost"
                        error={
                          hruSettings.host.trim() === ""
                            ? t("settings.hru.hostRequired")
                            : undefined
                        }
                        size="md"
                      />
                      <NumberInput
                        value={hruSettings.unitId}
                        onChange={(value) => {
                          const numericValue =
                            typeof value === "number" ? value : Number(value ?? 1);
                          setHruSettings((prev) => ({
                            ...prev,
                            unitId: Number.isFinite(numericValue) ? numericValue : 1,
                          }));
                          setProbeResult(null);
                        }}
                        label={t("settings.hru.unitIdLabel")}
                        min={1}
                        max={247}
                        step={1}
                        size="md"
                      />
                    </SimpleGrid>

                    {selectedUnit?.isConfigurable && (
                      <Paper p="sm" withBorder radius="md" bg="var(--mantine-color-blue-light)">
                        <Stack gap="xs">
                          <Text fw={500} size="sm">
                            {t("settings.hru.configuration.title")}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {t("settings.hru.configuration.maxPowerDescription")}
                          </Text>
                          <NumberInput
                            value={hruSettings.maxPower ?? selectedUnit.maxValue}
                            onChange={(value) => {
                              const numericValue = typeof value === "number" ? value : undefined;
                              setHruSettings((prev) => ({ ...prev, maxPower: numericValue }));
                            }}
                            label={t("settings.hru.configuration.maxPowerLabel")}
                            description={t("settings.hru.configuration.maxPowerHint", {
                              default: selectedUnit.maxValue,
                              unit: t(`app.units.${selectedUnit.controlUnit || "%"}`, {
                                defaultValue: selectedUnit.controlUnit || "%",
                              }),
                            })}
                            min={1}
                            max={10000}
                            size="md"
                          />
                        </Stack>
                      </Paper>
                    )}

                    <Group mt="sm">
                      <Button
                        onClick={saveHruSettings}
                        loading={savingHru}
                        disabled={loadingUnits || hruSettings.host.trim() === ""}
                        size="md"
                        variant="filled"
                      >
                        {t("settings.hru.save")}
                      </Button>
                      <Button
                        onClick={probeHru}
                        loading={probingHru}
                        disabled={
                          !hruSettings.unit || loadingUnits || hruSettings.host.trim() === ""
                        }
                        variant="light"
                        size="md"
                      >
                        {t("settings.hru.probe")}
                      </Button>
                    </Group>
                  </Stack>
                </Paper>

                {probeResult && (
                  <Alert
                    icon={<IconCheck size={20} />}
                    title={t("settings.hru.probeResultTitle")}
                    color="green"
                    withCloseButton
                    onClose={() => setProbeResult(null)}
                    radius="md"
                  >
                    <SimpleGrid
                      cols={{
                        base: 1,
                        sm:
                          (selectedUnit?.capabilities?.hasPowerControl !== false ? 1 : 0) +
                          (selectedUnit?.capabilities?.hasTemperatureControl !== false ? 1 : 0) +
                          (selectedUnit?.capabilities?.hasModeControl !== false ? 1 : 0),
                      }}
                      spacing="sm"
                    >
                      {selectedUnit?.capabilities?.hasPowerControl !== false && (
                        <Group gap="xs">
                          <Badge color="green" variant="light" circle>
                            P
                          </Badge>
                          <div>
                            <Text size="xs" c="dimmed">
                              {t("settings.hru.powerLabel")}
                            </Text>
                            <Text fw={600} size="lg">
                              {probeResult.power}
                              {t(`app.units.${selectedUnit?.controlUnit || "%"}`, {
                                defaultValue: selectedUnit?.controlUnit || "%",
                              })}
                            </Text>
                          </div>
                        </Group>
                      )}

                      {selectedUnit?.capabilities?.hasTemperatureControl !== false && (
                        <Group gap="xs">
                          <Badge color="orange" variant="light" circle>
                            T
                          </Badge>
                          <div>
                            <Text size="xs" c="dimmed">
                              {t("settings.hru.temperatureLabel")}
                            </Text>
                            <Text fw={600} size="lg">
                              {formatTemperature(probeResult.temperature, tempUnit)}
                              {getTemperatureLabel(tempUnit)}
                            </Text>
                          </div>
                        </Group>
                      )}

                      {selectedUnit?.capabilities?.hasModeControl !== false && (
                        <Group gap="xs">
                          <Badge color="blue" variant="light" circle>
                            M
                          </Badge>
                          <div>
                            <Text size="xs" c="dimmed">
                              {t("settings.hru.modeLabel")}
                            </Text>
                            <Text fw={600} size="lg">
                              {probeResult.mode}
                            </Text>
                          </div>
                        </Group>
                      )}
                    </SimpleGrid>
                  </Alert>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="mqtt">
            <Accordion.Control icon={<IconSettings size={20} />}>
              <Text fw={600}>{t("settings.mqtt.title")}</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Paper p="md" withBorder radius="md">
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Text fw={500} size="md">
                      {t("settings.mqtt.description")}
                    </Text>
                    <MotionSwitch
                      label={t("settings.mqtt.enabled")}
                      checked={mqttSettings.enabled}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setMqttSettings((prev) => ({ ...prev, enabled: checked }));
                      }}
                      size="md"
                    />
                  </Group>

                  {mqttSettings.enabled && (
                    <Stack gap="md" mt="xs">
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <TextInput
                          value={mqttSettings.host}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMqttSettings((prev) => ({ ...prev, host: val }));
                          }}
                          label={t("settings.mqtt.host")}
                          placeholder="core-mosquitto"
                          error={
                            mqttSettings.enabled && mqttSettings.host.trim() === ""
                              ? t("settings.mqtt.hostRequired")
                              : undefined
                          }
                          size="md"
                        />
                        <TextInput
                          value={mqttSettings.port.toString()}
                          onChange={(e) => {
                            const val = e.target.value;
                            // Allow digits only
                            if (val === "" || /^\d+$/.test(val)) {
                              const num = Number(val);
                              setMqttSettings((prev) => ({ ...prev, port: num }));
                            }
                          }}
                          label={t("settings.mqtt.port")}
                          placeholder="1883"
                          error={
                            mqttSettings.enabled &&
                            (mqttSettings.port <= 0 || mqttSettings.port > 65535)
                              ? t("settings.mqtt.portInvalid")
                              : undefined
                          }
                          size="md"
                        />
                      </SimpleGrid>

                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <TextInput
                          value={mqttSettings.user}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMqttSettings((prev) => ({ ...prev, user: val }));
                          }}
                          label={t("settings.mqtt.user")}
                          autoComplete="off"
                          size="md"
                        />
                        <PasswordInput
                          value={mqttSettings.password}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMqttSettings((prev) => ({ ...prev, password: val }));
                          }}
                          label={t("settings.mqtt.password")}
                          autoComplete="new-password"
                          size="md"
                        />
                      </SimpleGrid>
                    </Stack>
                  )}

                  <Group mt="sm">
                    <Button
                      onClick={saveMqttSettings}
                      loading={savingMqtt}
                      disabled={mqttSettings.enabled && mqttSettings.host.trim() === ""}
                      variant="filled"
                      size="md"
                    >
                      {t("settings.mqtt.save")}
                    </Button>
                    <Button
                      onClick={testMqttConnection}
                      loading={testingMqtt}
                      disabled={mqttSettings.host.trim() === ""}
                      variant="light"
                      size="md"
                    >
                      {t("settings.mqtt.test")}
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="database">
            <Accordion.Control icon={<IconDatabase size={20} />}>
              <Text fw={600}>{t("settings.database.title")}</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Paper p="md" withBorder radius="md">
                <Stack gap="md">
                  <Text fw={500} size="md">
                    {t("settings.database.description")}
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <Button
                      leftSection={<IconDownload size={20} />}
                      onClick={handleExport}
                      variant="light"
                      size="md"
                    >
                      {t("settings.database.export")}
                    </Button>
                    <FileButton onChange={handleImport} accept=".db" disabled={uploading}>
                      {(props) => (
                        <Button
                          {...props}
                          leftSection={<IconUpload size={20} />}
                          loading={uploading}
                          variant="filled"
                          size="md"
                        >
                          {uploading
                            ? t("settings.database.importing")
                            : t("settings.database.import")}
                        </Button>
                      )}
                    </FileButton>
                  </SimpleGrid>
                </Stack>
              </Paper>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="developer">
            <Accordion.Control icon={<IconCode size={20} />}>
              <Text fw={600}>{t("settings.developer.title")}</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Paper p="md" withBorder radius="md">
                <Stack gap="md">
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Stack gap={0}>
                        <Text fw={500}>{t("settings.developer.debugMode")}</Text>
                        <Text size="xs" c="dimmed">
                          {t("settings.developer.debugModeDescription")}
                        </Text>
                      </Stack>
                      <MotionSwitch
                        checked={debugMode}
                        onChange={(e) => {
                          const checked = e.currentTarget.checked;
                          setDebugMode(checked);

                          fetch(resolveApiUrl("/api/settings/debug-mode"), {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ enabled: checked }),
                          }).then(() => {
                            setTimeout(() => window.location.reload(), 800);
                          });

                          notifications.show({
                            title: t("settings.developer.debugMode"),
                            message: checked ? "Debug Mode enabled" : "Debug Mode disabled",
                            color: checked ? "blue" : "gray",
                            icon: <IconBug size={20} />,
                          });
                        }}
                        size="md"
                      />
                    </Group>
                  </Stack>
                </Stack>
              </Paper>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Container>
  );
}
