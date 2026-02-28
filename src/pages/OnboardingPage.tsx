import { useMemo, useState, useEffect } from "react";
import {
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
  SimpleGrid,
  Progress,
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
} from "@tabler/icons-react";
import { z } from "zod";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { useMantineColorScheme } from "@mantine/core";
import { logger } from "../utils/logger";
import { isSupportedLanguage, setLanguage } from "../i18n";
import { resolveApiUrl } from "../utils/api";

function createModbusSchema(t: (key: string) => string) {
  return z.object({
    host: z.string().trim().min(1, t("onboarding.modbus.hostRequired")),
    port: z.number().min(1, t("onboarding.modbus.portRequired")).max(65535),
    unitId: z.number().min(0, t("onboarding.modbus.unitIdRequired")).max(255),
  });
}

function createMqttSchema(t: (key: string) => string) {
  return z
    .object({
      enabled: z.boolean(),
      host: z.string().trim().optional(),
      port: z.number().min(1).max(65535).optional(),
      user: z.string().trim().optional(),
      password: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.enabled && !data.host?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: t("onboarding.mqtt.hostRequired"),
          path: ["host"],
        });
      }
      if (data.enabled && (data.port === undefined || Number.isNaN(data.port))) {
        ctx.addIssue({
          code: "custom",
          message: t("settings.mqtt.portInvalid"),
          path: ["port"],
        });
      }
    });
}

type ModbusForm = z.infer<ReturnType<typeof createModbusSchema>>;
type MqttForm = z.infer<ReturnType<typeof createMqttSchema>>;

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

  const modbusSchema = useMemo(() => createModbusSchema(t), [t]);

  const mqttSchema = useMemo(() => createMqttSchema(t), [t]);

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

      if (values.enabled && !values.host?.trim()) {
        errors.host = t("onboarding.mqtt.hostRequired");
      }

      return errors;
    },
  });

  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);

  const unitsQuery = useQuery({
    queryKey: ["hru-units"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/settings/units"));
      if (!res.ok) {
        logger.error("Failed to fetch units", { status: res.status, statusText: res.statusText });
        throw new Error("Failed to fetch units");
      }
      const data = (await res.json()) as Array<{ id: string; name: string }>;
      logger.info("Fetched units successfully", { count: data.length });
      return data;
    },
    enabled: active === 2,
  });

  const systemInfoQuery = useQuery({
    queryKey: ["system-info"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/system-info"));
      if (!res.ok) throw new Error("Failed to fetch system info");
      return (await res.json()) as { hassHost: string };
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    if (systemInfoQuery.data?.hassHost && !mqttForm.values.host) {
      mqttForm.setFieldValue("host", systemInfoQuery.data.hassHost);
    }
  }, [systemInfoQuery.data, mqttForm]);

  const saveHruMutation = useMutation({
    mutationFn: async (data: { host: string; port: number; unitId: number; unit: string }) => {
      const res = await fetch(resolveApiUrl("/api/settings/hru"), {
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
      const res = await fetch(resolveApiUrl("/api/settings/mqtt"), {
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
      const res = await fetch(resolveApiUrl("/api/settings/mqtt/test"), {
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
      const res = await fetch(resolveApiUrl(`/api/modbus/status?${params.toString()}`));
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
      const res = await fetch(resolveApiUrl("/api/settings/language"), {
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
      const res = await fetch(resolveApiUrl("/api/settings/theme"), {
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

  const finishOnboardingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(resolveApiUrl("/api/settings/onboarding-finish"), { method: "POST" });
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
      const res = await fetch(resolveApiUrl("/api/settings/onboarding-status"));
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
      ]);
      logger.info("Preferences saved successfully", {
        language: selectedLanguage,
        theme: selectedTheme,
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

  async function handleModbusSubmit() {
    const result = modbusForm.validate();
    if (!result.hasErrors) {
      logger.info("Modbus configuration validated", modbusForm.values);
      try {
        await handleHruAndModbusSave();
      } catch (err) {
        logger.error("Failed during HRU & Modbus save from Modbus submit", { error: err });
      }
    } else {
      logger.warn("Modbus configuration validation failed", result.errors);
    }
  }

  async function handleHruAndModbusSave() {
    if (!selectedUnit) {
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.unit.error"),
        color: "red",
      });
      setActive(2);
      return;
    }

    try {
      await saveHruMutation.mutateAsync({
        ...modbusForm.values,
        unit: selectedUnit,
      });
      logger.info("HRU & Modbus settings saved successfully", { unit: selectedUnit });
      nextStep();
    } catch (err) {
      notifications.show({
        title: t("onboarding.mqtt.failed"),
        message: t("onboarding.unit.saveFailed"),
        color: "red",
      });
      logger.error("Failed to save HRU/Modbus settings", { error: err });
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
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.unit.error"),
        color: "red",
      });
      return;
    }
    nextStep();
  }

  const queryClient = useQueryClient();

  async function handleFinish() {
    try {
      await finishOnboardingMutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["onboarding-layout-check"] });
      logger.info("Onboarding finished successfully");
      await navigate({ to: "/" });
    } catch (err) {
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.errors.finishFailed"),
        color: "red",
      });
      logger.error("Failed to finalise onboarding", { error: err });
    }
  }

  return (
    <Container size="sm" py="xl">
      <Paper p={{ base: "md", sm: "xl" }} radius="md" withBorder shadow="sm">
        <Title order={2} ta="center" mb="xl">
          {t("onboarding.title")}
        </Title>

        {/* Mobile Header */}
        <Stack gap="xs" mb="xl" hiddenFrom="sm">
          <Group justify="space-between" align="center">
            <Text c="dimmed" size="xs" fw={700} tt="uppercase">
              {t("onboarding.step", { current: active + 1, total: 6 })}
            </Text>
            <Text c="dimmed" size="xs" fw={700}>
              {Math.round(((active + 1) / 6) * 100)}%
            </Text>
          </Group>
          <Progress value={((active + 1) / 6) * 100} size="sm" radius="xl" />
          <Group mt="xs">
            {(() => {
              const steps = [
                {
                  label: t("onboarding.welcome.label"),
                  description: t("onboarding.welcome.description"),
                  icon: IconRocket,
                },
                {
                  label: t("onboarding.preferences.label"),
                  description: t("onboarding.preferences.description"),
                  icon: IconAdjustments,
                },
                {
                  label: t("onboarding.unit.label"),
                  description: t("onboarding.unit.description"),
                  icon: IconWind,
                },
                {
                  label: t("onboarding.mqtt.label"),
                  description: t("onboarding.mqtt.description"),
                  icon: IconPlugConnected,
                },
                {
                  label: t("onboarding.modbus.label"),
                  description: t("onboarding.modbus.description"),
                  icon: IconServer,
                },
                {
                  label: t("onboarding.status.label"),
                  description: t("onboarding.status.description"),
                  icon: IconAdjustments,
                },
              ];
              const currentStep = steps[active];
              const Icon = currentStep.icon;
              return (
                <>
                  <ThemeIcon size={32} radius="xl" variant="light" color="blue">
                    <Icon size={16} />
                  </ThemeIcon>
                  <div>
                    <Text size="sm" fw={700} lh={1.2}>
                      {currentStep.label}
                    </Text>
                    <Text size="xs" c="dimmed" lh={1.2}>
                      {currentStep.description}
                    </Text>
                  </div>
                </>
              );
            })()}
          </Group>
        </Stack>

        {/* Desktop Grid */}
        <SimpleGrid cols={3} spacing="lg" mb={50} visibleFrom="sm">
          {[
            {
              step: 0,
              label: t("onboarding.welcome.label"),
              description: t("onboarding.welcome.description"),
              icon: IconRocket,
            },
            {
              step: 1,
              label: t("onboarding.preferences.label"),
              description: t("onboarding.preferences.description"),
              icon: IconAdjustments,
            },
            {
              step: 2,
              label: t("onboarding.unit.label"),
              description: t("onboarding.unit.description"),
              icon: IconWind,
            },
            {
              step: 3,
              label: t("onboarding.mqtt.label"),
              description: t("onboarding.mqtt.description"),
              icon: IconPlugConnected,
            },
            {
              step: 4,
              label: t("onboarding.modbus.label"),
              description: t("onboarding.modbus.description"),
              icon: IconServer,
            },
            {
              step: 5,
              label: t("onboarding.status.label"),
              description: t("onboarding.status.description"),
              icon: IconAdjustments,
            },
          ].map((item) => {
            const isActive = active === item.step;
            const isCompleted = active > item.step;
            const Icon = item.icon;

            return (
              <Group key={item.step} gap="sm">
                <ThemeIcon
                  size={42}
                  radius="xl"
                  variant={isActive ? "filled" : "light"}
                  color={isActive || isCompleted ? "blue" : "gray"}
                >
                  <Icon size={20} />
                </ThemeIcon>
                <div style={{ flex: 1 }}>
                  <Text size="sm" fw={isActive ? 700 : 500} c={isActive ? undefined : "dimmed"}>
                    {item.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {item.description}
                  </Text>
                </div>
              </Group>
            );
          })}
        </SimpleGrid>

        <Stack align="center" py="xl" display={active === 0 ? "flex" : "none"}>
          <ThemeIcon size={80} radius="xl" variant="light" color="blue">
            <IconRocket size={48} />
          </ThemeIcon>
          <Title order={3}>{t("onboarding.welcome.title")}</Title>
          <Text c="dimmed" ta="center" maw={400}>
            {t("onboarding.welcome.text")}
          </Text>
          <Button size="lg" mt="md" rightSection={<IconArrowRight size={18} />} onClick={nextStep}>
            {t("onboarding.welcome.button")}
          </Button>
        </Stack>

        <Stack gap="md" py="lg" display={active === 1 ? "flex" : "none"}>
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
        </Stack>

        <Stack gap="md" py="lg" display={active === 2 ? "flex" : "none"}>
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
        </Stack>

        <Stack gap="md" py="lg" display={active === 3 ? "flex" : "none"}>
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
                  placeholder={t("onboarding.mqtt.hostPlaceholder")} // Common for addons
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
                  placeholder={t("app.nav.optional")}
                  {...mqttForm.getInputProps("user")}
                  style={{ flex: 1 }}
                />
                <PasswordInput
                  label={t("onboarding.mqtt.passLabel")}
                  placeholder={t("app.nav.optional")}
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
            <Alert color="yellow" title={t("valves.warningTitle")}>
              {t("onboarding.mqtt.warning")}
            </Alert>
          )}
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={prevStep}>
              {t("onboarding.back")}
            </Button>
            <Button onClick={handleMqttSubmit} loading={saveMqttMutation.isPending}>
              {t("onboarding.next")}
            </Button>
          </Group>
        </Stack>

        <Stack gap="md" py="lg" display={active === 4 ? "flex" : "none"}>
          <Text fw={500}>{t("onboarding.modbus.title")}</Text>
          <TextInput
            label={t("onboarding.modbus.hostLabel")}
            placeholder={t("onboarding.modbus.hostPlaceholder")}
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
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={prevStep}>
              {t("onboarding.back")}
            </Button>
            <Button onClick={handleModbusSubmit} loading={saveHruMutation.isPending}>
              {t("onboarding.next")}
            </Button>
          </Group>
        </Stack>

        <Stack gap="lg" py="xl" align="center" display={active === 5 ? "flex" : "none"}>
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
          <Group justify="center" mt="xl">
            <Button size="lg" onClick={handleFinish}>
              {t("onboarding.status.dashboard")}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
