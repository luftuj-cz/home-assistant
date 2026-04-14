import { useCallback, useMemo, useState, useEffect } from "react";
import { type HruUnit } from "../api/hru";
import {
  Alert,
  Badge,
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
  PasswordInput,
  useMantineColorScheme,
  useComputedColorScheme,
  Accordion,
  SimpleGrid,
  Paper,
  Container,
  Divider,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconDownload,
  IconUpload,
  IconLanguage,
  IconMoon,
  IconSun,
  IconSettings,
  IconServer,
  IconDatabase,
  IconCode,
  IconBug,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { resolveApiUrl } from "../utils/api";
import {
  createLogger,
  getLogLevel,
  setLogLevel,
  VALID_LOG_LEVELS,
  type LogLevel,
} from "../utils/logger";
import { setLanguage } from "../i18n";
import { MotionSwitch } from "../components/common/MotionSwitch";

const logger = createLogger("SettingsPage");

export function SettingsPage() {
  const [uploading, setUploading] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);
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
  const [probeStatus, setProbeStatus] = useState<"success" | "error" | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
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
  const [logLevel, setLogLevelState] = useState<LogLevel>(() => getLogLevel());
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

  const currentLanguage = useMemo(() => {
    const lang = i18n.language ?? "en";
    const short = lang.split("-")[0];
    return languageOptions.some((option) => option.value === short) ? short : "en";
  }, [i18n.language, languageOptions]);

  const persistThemePreference = useCallback(async (value: "light" | "dark") => {
    setSavingTheme(true);
    logger.info("Saving theme preference", { theme: value });
    try {
      const response = await fetch(resolveApiUrl("/api/settings/theme"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: value }),
      });
      if (response.ok) {
        logger.info("Theme preference saved successfully", { theme: value });
      }
    } catch (err) {
      logger.error("Failed to save theme preference", { error: err });
    } finally {
      setSavingTheme(false);
    }
  }, []);

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
      setSavingLanguage(true);
      logger.info("Saving language preference", { language: value });
      try {
        await setLanguage(value);
        const response = await fetch(resolveApiUrl("/api/settings/language"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: value }),
        });
        if (response.ok) {
          logger.info("Language preference saved successfully", { language: value });
          const label = languageOptions.find((option) => option.value === value)?.label ?? value;
          notifications.show({
            title: t("settings.language.notifications.updatedTitle"),
            message: t("settings.language.notifications.updatedMessage", { language: label }),
            color: "green",
          });
        }
      } catch (persistError) {
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
    [languageOptions, t],
  );

  const handleLanguageChange = useCallback(
    (value: string) => {
      void persistLanguagePreference(value);
    },
    [persistLanguagePreference],
  );

  useEffect(() => {
    async function loadData() {
      setLoadingUnits(true);
      try {
        const [unitsRes, settingsRes, mqttRes, logLevelRes] = await Promise.all([
          fetch(resolveApiUrl("/api/hru/units"), { cache: "no-cache" }),
          fetch(resolveApiUrl("/api/settings/hru"), { cache: "no-cache" }),
          fetch(resolveApiUrl("/api/settings/mqtt"), { cache: "no-cache" }),
          fetch(resolveApiUrl("/api/settings/log-level"), { cache: "no-cache" }),
        ]);

        if (unitsRes.ok) {
          const units = await unitsRes.json();
          setFullHruUnits(units);
          setHruUnits(
            units.map((u: { id: string; name: string }) => ({ value: u.id, label: u.name })),
          );
          logger.info("HRU units loaded", { count: units.length });
        }
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          setHruSettings(settings);
          logger.info("HRU settings loaded", { unit: settings.unit });
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
          logger.info("MQTT settings loaded", { enabled: mqtt.enabled, host: mqtt.host });
        }

        const debugRes = await fetch(resolveApiUrl("/api/settings/debug-mode"), {
          cache: "no-cache",
        });
        if (debugRes.ok) {
          const { enabled } = await debugRes.json();
          setDebugMode(enabled);
          logger.info("Debug mode loaded", { enabled });
        }

        if (logLevelRes.ok) {
          const { level } = await logLevelRes.json();
          setLogLevel(level as LogLevel);
          setLogLevelState(level as LogLevel);
          logger.info("Log level loaded from backend", { level });
        }
      } catch (err) {
        logger.error("Failed to load settings", { error: err });
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
    logger.info("Saving MQTT settings", { host: mqttSettings.host, port: mqttSettings.port });
    try {
      const response = await fetch(resolveApiUrl("/api/settings/mqtt"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mqttSettings),
      });

      if (!response.ok) {
        const detail = await response.text();
        logger.error("Failed to save MQTT settings", { status: response.status, detail });
        notifications.show({
          title: t("settings.mqtt.notifications.saveFailedTitle"),
          message: t("settings.mqtt.notifications.saveFailedMessage", { message: detail }),
          color: "red",
        });
        return;
      }
      logger.info("MQTT settings saved successfully", {
        host: mqttSettings.host,
        port: mqttSettings.port,
      });
      notifications.show({
        title: t("settings.mqtt.notifications.saveSuccessTitle"),
        message: t("settings.mqtt.notifications.saveSuccessMessage"),
        color: "green",
      });
    } catch (error) {
      logger.error("Failed to save MQTT settings", { error });
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

        logger.error("MQTT connection test failed", { status: response.status, detail });
        notifications.show({
          title: t("settings.mqtt.notifications.testFailedTitle"),
          message: errorMessage,
          color: "red",
        });
        return;
      }
      logger.info("MQTT connection test successful");
      notifications.show({
        title: t("settings.mqtt.notifications.testSuccessTitle"),
        message: t("settings.mqtt.notifications.testSuccessMessage"),
        color: "green",
      });
    } catch (error) {
      logger.error("MQTT connection test failed", { error });
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
    logger.info("Saving HRU settings", { unit: hruSettings.unit, host: hruSettings.host });
    try {
      const response = await fetch(resolveApiUrl("/api/settings/hru"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hruSettings),
      });
      if (!response.ok) {
        const detail = await response.text();
        logger.error("Failed to save HRU settings", { status: response.status, detail });
        notifications.show({
          title: t("settings.hru.notifications.saveFailedTitle"),
          message: t("settings.hru.notifications.saveFailedMessage", { message: detail }),
          color: "red",
        });
        return;
      }
      logger.info("HRU settings saved successfully", {
        unit: hruSettings.unit,
        host: hruSettings.host,
      });
      notifications.show({
        title: t("settings.hru.notifications.saveSuccessTitle"),
        message: t("settings.hru.notifications.saveSuccessMessage"),
        color: "green",
      });
    } catch (error) {
      logger.error("Failed to save HRU settings", { error });
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

  // Probe result card intentionally removed per request

  const probeHru = useCallback(async () => {
    if (!hruSettings.unit) {
      notifications.show({
        title: t("settings.hru.notifications.probeFailedTitle"),
        message: t("settings.hru.notifications.noUnitSelected"),
        color: "red",
      });
      return;
    }
    setProbeStatus(null);
    setProbeError(null);
    setProbingHru(true);
    logger.info("Testing HRU connection", { unit: hruSettings.unit, host: hruSettings.host });
    try {
      const response = await fetch(resolveApiUrl("/api/hru/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hruSettings),
      });
      if (!response.ok) {
        setProbeStatus("error");
        const message = t("settings.hru.notifications.connectionFailed");
        setProbeError(message);
        logger.error("HRU connection test failed", { status: response.status });
        notifications.show({
          title: t("settings.hru.notifications.probeFailedTitle"),
          message,
          color: "red",
        });
        return;
      }
      setProbeStatus("success");
      logger.info("HRU connection test successful", { unit: hruSettings.unit });
    } catch (error) {
      setProbeStatus("error");
      const message = t("settings.hru.notifications.connectionFailed");
      setProbeError(message);
      logger.error("HRU connection test failed", { error });
      notifications.show({
        title: t("settings.hru.notifications.probeFailedTitle"),
        message,
        color: "red",
      });
    } finally {
      setProbingHru(false);
    }
  }, [hruSettings, t]);

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

                    {(() => {
                      const unitMissing = hruSettings.unit === null || hruSettings.unit === "";
                      const hostMissing = hruSettings.host.trim() === "";
                      const portMissing =
                        !Number.isFinite(hruSettings.port) || hruSettings.port <= 0;
                      const unitIdMissing =
                        !Number.isFinite(hruSettings.unitId) || hruSettings.unitId <= 0;

                      return (
                        <>
                          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                            <Select
                              required
                              data={hruUnits}
                              value={hruSettings.unit ?? ""}
                              onChange={(value) => {
                                setHruSettings((prev) => ({
                                  ...prev,
                                  unit: value === "" ? null : value,
                                }));
                                setProbeStatus(null);
                                setProbeError(null);
                              }}
                              label={t("settings.hru.unitLabel")}
                              placeholder={t("settings.hru.unitPlaceholder")}
                              error={unitMissing ? t("settings.hru.unitRequired") : undefined}
                              disabled={loadingUnits}
                              searchable
                              clearable
                              size="md"
                            />
                            <NumberInput
                              required
                              value={hruSettings.port}
                              onChange={(value) => {
                                const numericValue =
                                  typeof value === "number" ? value : Number(value ?? 502);
                                setHruSettings((prev) => ({
                                  ...prev,
                                  port: Number.isFinite(numericValue) ? numericValue : 502,
                                }));
                                setProbeStatus(null);
                                setProbeError(null);
                              }}
                              label={t("settings.hru.portLabel")}
                              min={1}
                              max={65535}
                              step={1}
                              error={portMissing ? t("settings.hru.portRequired") : undefined}
                              size="md"
                            />
                          </SimpleGrid>

                          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                            <TextInput
                              required
                              value={hruSettings.host}
                              onChange={(e) => {
                                setHruSettings((prev) => ({ ...prev, host: e.target.value }));
                                setProbeStatus(null);
                                setProbeError(null);
                              }}
                              label={t("settings.hru.hostLabel")}
                              placeholder="localhost"
                              error={hostMissing ? t("settings.hru.hostRequired") : undefined}
                              size="md"
                            />
                            <NumberInput
                              required
                              value={hruSettings.unitId}
                              onChange={(value) => {
                                const numericValue =
                                  typeof value === "number" ? value : Number(value ?? 1);
                                setHruSettings((prev) => ({
                                  ...prev,
                                  unitId: Number.isFinite(numericValue) ? numericValue : 1,
                                }));
                                setProbeStatus(null);
                                setProbeError(null);
                              }}
                              label={t("settings.hru.unitIdLabel")}
                              min={1}
                              max={247}
                              step={1}
                              error={unitIdMissing ? t("settings.hru.unitIdRequired") : undefined}
                              size="md"
                            />
                          </SimpleGrid>
                        </>
                      );
                    })()}

                    {selectedUnit?.variables?.find(
                      (v) => v.class === "power" && v.maxConfigurable,
                    ) && (
                      <Paper p="sm" withBorder radius="md" bg="var(--mantine-color-blue-light)">
                        <Stack gap="xs">
                          <Text fw={500} size="sm">
                            {t("settings.hru.configuration.title")}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {t("settings.hru.configuration.maxPowerDescription")}
                          </Text>
                          {(() => {
                            const powerVar = selectedUnit.variables.find(
                              (v) => v.class === "power",
                            );
                            const defaultPower = powerVar?.maxDefault ?? powerVar?.max;
                            const isConfigurable = powerVar?.maxConfigurable ?? false;
                            const isMissing =
                              isConfigurable &&
                              (hruSettings.maxPower === undefined || hruSettings.maxPower === null);
                            return (
                              <NumberInput
                                required
                                value={hruSettings.maxPower ?? defaultPower}
                                onChange={(value) => {
                                  const numericValue =
                                    typeof value === "number" ? value : undefined;
                                  setHruSettings((prev) => ({ ...prev, maxPower: numericValue }));
                                }}
                                label={t("settings.hru.configuration.maxPowerLabel")}
                                description={t("settings.hru.configuration.maxPowerHint", {
                                  default: defaultPower,
                                  unit: (() => {
                                    const u = selectedUnit.variables.find(
                                      (v) => v.class === "power",
                                    )?.unit;
                                    return typeof u === "string" ? u : (u?.text ?? "%");
                                  })(),
                                })}
                                error={
                                  isMissing
                                    ? t("settings.hru.configuration.maxPowerRequired")
                                    : undefined
                                }
                                min={1}
                                max={10000}
                                size="md"
                              />
                            );
                          })()}
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
                      {probeStatus === "success" && (
                        <Badge color="green" variant="light">
                          {t("settings.hru.probeSuccess")}
                        </Badge>
                      )}
                      {probeStatus === "error" && (
                        <Alert
                          color="red"
                          variant="light"
                          withCloseButton
                          title={t("settings.hru.probe")}
                          icon={<IconAlertCircle size={16} />}
                        >
                          {probeError || t("settings.hru.notifications.unknown")}
                        </Alert>
                      )}
                    </Group>
                  </Stack>
                </Paper>
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
                        <NumberInput
                          value={mqttSettings.port}
                          onChange={(val) => {
                            setMqttSettings((prev) => ({
                              ...prev,
                              port: typeof val === "number" ? val : 0,
                            }));
                          }}
                          label={t("settings.mqtt.port")}
                          placeholder="1883"
                          min={1}
                          max={65535}
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
                            message: checked
                              ? t("settings.developer.debugEnabled")
                              : t("settings.developer.debugDisabled"),
                            color: checked ? "blue" : "gray",
                            icon: <IconBug size={20} />,
                          });
                        }}
                        size="md"
                      />
                    </Group>
                  </Stack>

                  <Divider />

                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Stack gap={0}>
                        <Text fw={500}>{t("settings.developer.logLevel")}</Text>
                        <Text size="xs" c="dimmed">
                          {t("settings.developer.logLevelDescription")}
                        </Text>
                      </Stack>
                      <Select
                        value={logLevel}
                        onChange={async (value) => {
                          if (value && VALID_LOG_LEVELS.includes(value as LogLevel)) {
                            setLogLevel(value as LogLevel);
                            setLogLevelState(value as LogLevel);

                            // Save to backend
                            try {
                              const response = await fetch(
                                resolveApiUrl("/api/settings/log-level"),
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ level: value }),
                                },
                              );
                              if (response.ok) {
                                notifications.show({
                                  title: t("settings.developer.logLevel"),
                                  message: t("settings.developer.logLevelChanged", {
                                    level: value,
                                  }),
                                  color: "blue",
                                });
                              } else {
                                logger.error("Failed to save log level to backend", {
                                  status: response.status,
                                });
                              }
                            } catch (err) {
                              logger.error("Failed to save log level to backend", { error: err });
                            }
                          }
                        }}
                        data={VALID_LOG_LEVELS.map((level) => ({
                          value: level,
                          label: level.toUpperCase(),
                        }))}
                        size="sm"
                        w={120}
                        searchable
                        allowDeselect={false}
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
