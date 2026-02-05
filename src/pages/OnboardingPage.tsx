import { useState } from "react";
import {
  Stepper,
  Button,
  Group,
  TextInput,
  NumberInput,
  PasswordInput,
  Title,
  Text,
  Container,
  Paper,
  Select,
  Stack,
  Loader,
  Alert,
  Switch,
  ThemeIcon,
  Center,
  useMantineTheme,
  Flex,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  IconCheck,
  IconArrowRight,
  IconX,
  IconRocket,
  IconPlugConnected,
  IconServer,
  IconWind,
  IconAdjustments,
  IconLanguage,
  IconPalette,
  IconTemperature,
} from "@tabler/icons-react";
import { z } from "zod";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { useMantineColorScheme } from "@mantine/core";
import { logger } from "../utils/logger";
import { isSupportedLanguage, setLanguage } from "../i18n";
import { type TemperatureUnit } from "../utils/temperature";

const modbusSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().min(1).max(65535),
  unitId: z.number().min(0).max(255),
});

const mqttSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string().optional(),
    port: z.number().min(1).max(65535).optional(),
    user: z.string().optional(),
    password: z.string().optional(),
  })
  .refine((data) => !data.enabled || (data.host && data.host.length > 0), {
    message: "Host is required when MQTT is enabled",
    path: ["host"],
  });

type ModbusForm = z.infer<typeof modbusSchema>;
type MqttForm = z.infer<typeof mqttSchema>;

export function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);
  const [selectedTheme, setSelectedTheme] = useState<"light" | "dark">(
    colorScheme === "auto" ? "dark" : (colorScheme as "light" | "dark"),
  );
  const [selectedTempUnit, setSelectedTempUnit] = useState<TemperatureUnit>("c");

  const modbusForm = useForm<ModbusForm>({
    initialValues: {
      host: "0.0.0.0",
      port: 502,
      unitId: 1,
    },
    validate: (values) => {
      const result = modbusSchema.safeParse(values);
      if (result.success) return {};
      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) errors[issue.path[0].toString()] = issue.message;
      });
      return errors;
    },
  });

  const mqttForm = useForm<MqttForm>({
    initialValues: {
      enabled: true,
      host: "",
      port: 1883,
      user: "",
      password: "",
    },
    validate: (values) => {
      const result = mqttSchema.safeParse(values);
      const errors: Record<string, string> = {};

      if (!result.success) {
        result.error.issues.forEach((issue) => {
          if (issue.path[0]) errors[issue.path[0].toString()] = issue.message;
        });
      }

      if (values.enabled && !values.host) {
        errors.host = "Host is required when MQTT is enabled";
      }

      return errors;
    },
  });

  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);

  const unitsQuery = useQuery({
    queryKey: ["hru-units"],
    queryFn: async () => {
      const res = await fetch("/api/settings/units");
      if (!res.ok) {
        logger.error("Failed to fetch units", { status: res.status, statusText: res.statusText });
        throw new Error("Failed to fetch units");
      }
      const data = (await res.json()) as Array<{ id: string; name: string }>;
      logger.info("Fetched units successfully", { count: data.length });
      return data;
    },
    enabled: active === 4,
  });

  const saveHruMutation = useMutation({
    mutationFn: async (data: { host: string; port: number; unitId: number; unit: string }) => {
      const res = await fetch("/api/settings/hru", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        logger.error("Failed to save HRU settings", {
          status: res.status,
          statusText: res.statusText,
        });
        throw new Error("Failed to save HRU settings");
      }
    },
  });

  const saveMqttMutation = useMutation({
    mutationFn: async (data: MqttForm) => {
      const res = await fetch("/api/settings/mqtt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        logger.error("Failed to save MQTT settings", {
          status: res.status,
          statusText: res.statusText,
        });
        throw new Error("Failed to save MQTT settings");
      }
    },
  });

  const testMqttMutation = useMutation({
    mutationFn: async (data: MqttForm) => {
      const res = await fetch("/api/settings/mqtt/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: data.host,
          port: data.port,
          user: data.user,
          password: data.password,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.detail || "Connection failed");
      return json;
    },
    onSuccess: () => {
      logger.info("MQTT connection test successful");
    },
    onError: (error) => {
      logger.error("MQTT connection test failed", { error });
    },
  });

  const testModbusMutation = useMutation({
    mutationFn: async (data: ModbusForm) => {
      const params = new URLSearchParams({
        host: data.host,
        port: data.port.toString(),
      });
      const res = await fetch(`/api/modbus/status?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to probe Modbus");
      const json = await res.json();
      if (!json.reachable) throw new Error(json.error || "Modbus unreachable");
      return json;
    },
    onSuccess: () => {
      logger.info("Modbus connection test successful");
    },
    onError: (error) => {
      logger.error("Modbus connection test failed", { error });
    },
  });

  const saveLanguageMutation = useMutation({
    mutationFn: async (lang: string) => {
      const res = await fetch("/api/settings/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: lang }),
      });
      if (!res.ok) {
        logger.error("Failed to save language", { status: res.status, statusText: res.statusText });
        throw new Error("Failed to save language");
      }
    },
  });

  const saveThemeMutation = useMutation({
    mutationFn: async (theme: string) => {
      const res = await fetch("/api/settings/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      if (!res.ok) {
        logger.error("Failed to save theme", { status: res.status, statusText: res.statusText });
        throw new Error("Failed to save theme");
      }
    },
  });

  const saveTempUnitMutation = useMutation({
    mutationFn: async (unit: TemperatureUnit) => {
      const res = await fetch("/api/settings/temperature-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temperatureUnit: unit }),
      });
      if (!res.ok) {
        logger.error("Failed to save temperature unit", {
          status: res.status,
          statusText: res.statusText,
        });
        throw new Error("Failed to save temperature unit");
      }
    },
  });

  const finishOnboardingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/onboarding-finish", { method: "POST" });
      if (!res.ok) {
        logger.error("Failed to finish onboarding", {
          status: res.status,
          statusText: res.statusText,
        });
        throw new Error("Failed to finish onboarding");
      }
    },
  });

  const statusQuery = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: async () => {
      const res = await fetch("/api/settings/onboarding-status");
      if (!res.ok) {
        logger.error("Failed to check status", { status: res.status, statusText: res.statusText });
        throw new Error("Failed to check status");
      }
      return (await res.json()) as {
        onboardingDone: boolean;
        hruConfigured: boolean;
        mqttConfigured: boolean;
        luftatorAvailable: boolean;
      };
    },
    enabled: active === 5,
    refetchInterval: active === 5 ? 2000 : false, // Poll every 2s on final step
  });

  function nextStep() {
    const next = active + 1;
    logger.info("Navigating to next step", { from: active, to: next });
    setActive(next);
  }

  function prevStep() {
    const prev = active > 0 ? active - 1 : active;
    logger.info("Navigating to previous step", { from: active, to: prev });
    setActive(prev);
  }

  async function handlePreferencesSubmit() {
    try {
      await Promise.all([
        saveLanguageMutation.mutateAsync(selectedLanguage),
        saveThemeMutation.mutateAsync(selectedTheme),
        saveTempUnitMutation.mutateAsync(selectedTempUnit),
      ]);
      logger.info("Preferences saved successfully", {
        language: selectedLanguage,
        theme: selectedTheme,
        tempUnit: selectedTempUnit,
      });
      nextStep();
    } catch (err) {
      notifications.show({
        title: t("onboarding.mqtt.failed"),
        message: t("onboarding.errors.prefSaveFailed"),
        color: "red",
      });
      logger.error("Failed to save preferences", { error: err });
    }
  }

  function handleModbusSubmit() {
    const result = modbusForm.validate();
    if (!result.hasErrors) {
      logger.info("Modbus configuration validated", modbusForm.values);
      nextStep();
    } else {
      logger.warn("Modbus configuration validation failed", result.errors);
    }
  }

  async function handleMqttSubmit() {
    const result = mqttForm.validate();
    if (result.hasErrors) {
      logger.warn("MQTT configuration validation failed", result.errors);
      return;
    }

    try {
      await saveMqttMutation.mutateAsync(mqttForm.values);
      logger.info("MQTT settings saved successfully");
      nextStep();
    } catch (err) {
      notifications.show({
        title: t("onboarding.mqtt.failed"),
        message: t("onboarding.errors.mqttSaveFailed"),
        color: "red",
      });
      logger.error("Failed to save MQTT settings", { error: err });
    }
  }

  async function handleUnitSubmit() {
    if (!selectedUnit) {
      notifications.show({ title: "Error", message: "Please select a unit", color: "red" });
      return;
    }

    try {
      await saveHruMutation.mutateAsync({
        ...modbusForm.values,
        unit: selectedUnit,
      });
      logger.info("HRU settings saved successfully", { unit: selectedUnit });
      nextStep();
    } catch (err) {
      notifications.show({
        title: t("onboarding.mqtt.failed"),
        message: t("onboarding.unit.saveFailed"),
        color: "red",
      });
      logger.error("Failed to save Unit settings", { error: err });
    }
  }

  const queryClient = useQueryClient();

  async function handleFinish() {
    try {
      await finishOnboardingMutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["onboarding-layout-check"] });
      logger.info("Onboarding finished successfully");
      navigate({ to: "/" });
    } catch (err) {
      notifications.show({
        title: "Error",
        message: "Failed to finalise onboarding. Please try again.",
        color: "red",
      });
      logger.error("Failed to finalise onboarding", { error: err });
    }
  }

  return (
    <Container size="sm" py="xl">
      <Paper p={{ base: "md", sm: "xl" }} radius="md" withBorder shadow="sm">
        <Title order={2} ta="center" mb="lg">
          {t("onboarding.title")}
        </Title>
        <Stepper
          active={active}
          onStepClick={setActive}
          allowNextStepsSelect={false}
          orientation={isMobile ? "vertical" : "horizontal"}
          size={isMobile ? "sm" : "md"}
        >
          {/* STEP 0: Welcome */}
          <Stepper.Step
            label={t("onboarding.welcome.label")}
            description={t("onboarding.welcome.description")}
            icon={<IconRocket size={18} />}
          >
            <Stack align="center" py="xl">
              <ThemeIcon size={80} radius="xl" variant="light" color="blue">
                <IconRocket size={48} />
              </ThemeIcon>
              <Title order={3}>{t("onboarding.welcome.title")}</Title>
              <Text c="dimmed" ta="center" maw={400}>
                {t("onboarding.welcome.text")}
              </Text>
              <Button
                size="lg"
                mt="md"
                rightSection={<IconArrowRight size={18} />}
                onClick={nextStep}
              >
                {t("onboarding.welcome.button")}
              </Button>
            </Stack>
          </Stepper.Step>

          <Stepper.Step
            label={t("onboarding.preferences.label")}
            description={t("onboarding.preferences.description")}
            icon={<IconAdjustments size={18} />}
          >
            <Stack gap="md" py="lg">
              <Select
                label={t("onboarding.preferences.languageLabel")}
                placeholder={t("onboarding.preferences.languagePlaceholder")}
                leftSection={<IconLanguage size={16} />}
                data={[
                  { value: "en", label: "English" },
                  { value: "cs", label: "Čeština" },
                ]}
                value={selectedLanguage}
                onChange={(val) => {
                  if (val && isSupportedLanguage(val)) {
                    setSelectedLanguage(val);
                    void setLanguage(val);
                  }
                }}
              />

              <Select
                label={t("onboarding.preferences.themeLabel")}
                placeholder={t("onboarding.preferences.themePlaceholder")}
                leftSection={<IconPalette size={16} />}
                data={[
                  { value: "light", label: t("onboarding.preferences.themes.light") },
                  { value: "dark", label: t("onboarding.preferences.themes.dark") },
                ]}
                value={selectedTheme}
                onChange={(val) => {
                  if (val) {
                    const theme = val as "light" | "dark";
                    setSelectedTheme(theme);
                    setColorScheme(theme);
                    sessionStorage.setItem("luftujha-theme-synced", "true");
                  }
                }}
              />

              <Select
                label={t("onboarding.preferences.tempUnitLabel")}
                placeholder={t("onboarding.preferences.tempUnitPlaceholder")}
                leftSection={<IconTemperature size={16} />}
                data={[
                  { value: "c", label: t("onboarding.preferences.tempUnits.c") },
                  { value: "f", label: t("onboarding.preferences.tempUnits.f") },
                ]}
                value={selectedTempUnit}
                onChange={(val) => {
                  if (val) {
                    setSelectedTempUnit(val as TemperatureUnit);
                  }
                }}
              />
            </Stack>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={prevStep}>
                {t("onboarding.back")}
              </Button>
              <Button
                onClick={handlePreferencesSubmit}
                loading={saveLanguageMutation.isPending || saveThemeMutation.isPending}
              >
                {t("onboarding.next")}
              </Button>
            </Group>
          </Stepper.Step>

          {/* STEP 2: Modbus */}
          <Stepper.Step
            label={t("onboarding.modbus.label")}
            description={t("onboarding.modbus.description")}
            icon={<IconServer size={18} />}
          >
            <Stack gap="md" py="lg">
              <Text fw={500}>{t("onboarding.modbus.title")}</Text>
              <TextInput
                label={t("onboarding.modbus.hostLabel")}
                placeholder="192.168.1.10"
                required
                {...modbusForm.getInputProps("host")}
              />
              <Flex direction={isMobile ? "column" : "row"} gap="md">
                <NumberInput
                  label={t("onboarding.modbus.portLabel")}
                  required
                  min={1}
                  max={65535}
                  {...modbusForm.getInputProps("port")}
                  style={{ flex: 1 }}
                />
                <NumberInput
                  label={t("onboarding.modbus.unitIdLabel")}
                  required
                  min={0}
                  max={255}
                  {...modbusForm.getInputProps("unitId")}
                  style={{ flex: 1 }}
                />
              </Flex>

              <Group>
                <Button
                  variant="light"
                  size="xs"
                  loading={testModbusMutation.isPending}
                  onClick={() => testModbusMutation.mutate(modbusForm.values)}
                >
                  {t("onboarding.modbus.test")}
                </Button>
                {testModbusMutation.isSuccess && (
                  <Text c="green" size="sm" fw={500}>
                    {t("onboarding.modbus.connected")}
                  </Text>
                )}
                {testModbusMutation.isError && (
                  <Text c="red" size="sm" fw={500}>
                    {t("onboarding.modbus.failed")}
                  </Text>
                )}
              </Group>
            </Stack>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={prevStep}>
                {t("onboarding.back")}
              </Button>
              <Button onClick={handleModbusSubmit}>{t("onboarding.next")}</Button>
            </Group>
          </Stepper.Step>

          <Stepper.Step
            label={t("onboarding.mqtt.label")}
            description={t("onboarding.mqtt.description")}
            icon={<IconPlugConnected size={18} />}
          >
            <Stack gap="md" py="lg">
              <Group justify="space-between">
                <Text fw={500}>{t("onboarding.mqtt.title")}</Text>
                <Switch
                  label={t("onboarding.mqtt.enable")}
                  {...mqttForm.getInputProps("enabled", { type: "checkbox" })}
                />
              </Group>

              {mqttForm.values.enabled && (
                <>
                  <Flex direction={isMobile ? "column" : "row"} gap="md">
                    <TextInput
                      label={t("onboarding.mqtt.hostLabel")}
                      placeholder="homeassistant" // Common for addons
                      required
                      {...mqttForm.getInputProps("host")}
                      style={{ flex: 1 }}
                    />
                    <NumberInput
                      label={t("onboarding.mqtt.portLabel")}
                      required
                      min={1}
                      max={65535}
                      {...mqttForm.getInputProps("port")}
                      style={{ flex: 1 }}
                    />
                  </Flex>
                  <Flex direction={isMobile ? "column" : "row"} gap="md">
                    <TextInput
                      label={t("onboarding.mqtt.userLabel")}
                      placeholder="Optional"
                      {...mqttForm.getInputProps("user")}
                      style={{ flex: 1 }}
                    />
                    <PasswordInput
                      label={t("onboarding.mqtt.passLabel")}
                      placeholder="Optional"
                      {...mqttForm.getInputProps("password")}
                      style={{ flex: 1 }}
                    />
                  </Flex>

                  <Group>
                    <Button
                      variant="light"
                      size="xs"
                      loading={testMqttMutation.isPending}
                      onClick={() => testMqttMutation.mutate(mqttForm.values)}
                    >
                      {t("onboarding.mqtt.test")}
                    </Button>
                    {testMqttMutation.isSuccess && (
                      <Text c="green" size="sm" fw={500}>
                        {t("onboarding.mqtt.connected")}
                      </Text>
                    )}
                    {testMqttMutation.isError && (
                      <Text c="red" size="sm" fw={500}>
                        {t("onboarding.mqtt.failed")}
                      </Text>
                    )}
                  </Group>
                </>
              )}
              {!mqttForm.values.enabled && (
                <Alert color="yellow" title="Warning">
                  {t("onboarding.mqtt.warning")}
                </Alert>
              )}
            </Stack>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={prevStep}>
                {t("onboarding.back")}
              </Button>
              <Button onClick={handleMqttSubmit} loading={saveMqttMutation.isPending}>
                {t("onboarding.next")}
              </Button>
            </Group>
          </Stepper.Step>

          <Stepper.Step
            label={t("onboarding.unit.label")}
            description={t("onboarding.unit.description")}
            icon={<IconWind size={18} />}
          >
            <Stack gap="md" py="lg">
              <Text fw={500}>{t("onboarding.unit.title")}</Text>
              {unitsQuery.isLoading ? (
                <Center p="xl">
                  <Loader />
                </Center>
              ) : unitsQuery.isError ? (
                <Alert color="red">{t("onboarding.unit.loadFailed")}</Alert>
              ) : (
                <Select
                  label={t("onboarding.unit.modelLabel")}
                  placeholder={t("onboarding.unit.modelPlaceholder")}
                  data={unitsQuery.data?.map((u) => ({ value: u.id, label: u.name })) || []}
                  value={selectedUnit}
                  onChange={setSelectedUnit}
                  searchable
                />
              )}
              <Text size="sm" c="dimmed">
                {t("onboarding.unit.hint")}
              </Text>
            </Stack>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={prevStep}>
                {t("onboarding.back")}
              </Button>
              <Button
                onClick={handleUnitSubmit}
                loading={saveHruMutation.isPending}
                disabled={!selectedUnit}
              >
                {t("onboarding.next")}
              </Button>
            </Group>
          </Stepper.Step>

          <Stepper.Step
            label={t("onboarding.status.label")}
            description={t("onboarding.status.description")}
            icon={<IconAdjustments size={18} />}
          >
            <Stack gap="lg" py="xl" align="center">
              {statusQuery.isLoading ? (
                <Loader size="lg" />
              ) : (
                <>
                  <Group>
                    <ThemeIcon
                      size={42}
                      radius="xl"
                      color={statusQuery.data?.luftatorAvailable ? "green" : "orange"}
                      variant="light"
                    >
                      {statusQuery.data?.luftatorAvailable ? <IconCheck /> : <IconX />}
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text fw={700} size="lg">
                        {statusQuery.data?.luftatorAvailable
                          ? t("onboarding.status.found")
                          : t("onboarding.status.notFound")}
                      </Text>
                      <Text c="dimmed" size="sm">
                        {t("onboarding.status.integrationStatus")}
                      </Text>
                    </Stack>
                  </Group>

                  {!statusQuery.data?.luftatorAvailable && (
                    <Alert color="orange" title={t("onboarding.status.waitingTitle")} maw={500}>
                      {t("onboarding.status.waitingHA")}
                    </Alert>
                  )}
                  {statusQuery.data?.luftatorAvailable && (
                    <Alert color="green" title={t("onboarding.status.readyTitle")} maw={500}>
                      {t("onboarding.status.ready")}
                    </Alert>
                  )}
                </>
              )}
            </Stack>
            <Group justify="center" mt="xl">
              <Button size="lg" onClick={handleFinish}>
                {t("onboarding.status.dashboard")}
              </Button>
            </Group>
          </Stepper.Step>
        </Stepper>
      </Paper>
    </Container>
  );
}
