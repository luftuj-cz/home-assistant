import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type RefObject,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "@mantine/form";
import { useMantineColorScheme } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { z } from "zod";
import { fetchHruUnits, type HruUnit, type HruVariable } from "@luftuj/shared/api/hru";
import { createLogger } from "@luftuj/shared/utils/logger";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError, translateApiError } from "@luftuj/shared/utils/apiError";

export type { HruUnit, HruVariable } from "@luftuj/shared/api/hru";
export {
  IconRocket,
  IconAdjustments,
  IconWind,
  IconPlugConnected,
  IconServer,
  IconLanguage,
  IconPalette,
  IconArrowRight,
} from "@tabler/icons-react";

const logger = createLogger("OnboardingWizard");

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
        ctx.addIssue({ code: "custom", message: t("settings.mqtt.portInvalid"), path: ["port"] });
      }
    });
}

type ModbusForm = z.infer<ReturnType<typeof createModbusSchema>>;
type MqttForm = z.infer<ReturnType<typeof createMqttSchema>>;

interface StepsContextValue {
  currentStep: number;
  totalSteps: number;
  nextStep: () => void;
  prevStep: () => void;
  setStep: (step: number) => void;
  selectedUnit: string | null;
  setSelectedUnit: (unit: string | null) => void;
  maxPower: number | undefined;
  setMaxPower: (power: number | undefined) => void;
  fullUnits: HruUnit[];
  selectedUnitDef: HruUnit | undefined;
  requiresMaxPower: boolean;
  defaultMaxPower: number | undefined;
  powerVariable: HruVariable | undefined;
  isDemoUnit: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modbusForm: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mqttForm: any;
  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;
  selectedTheme: "light" | "dark";
  setSelectedTheme: (theme: "light" | "dark") => void;
  modbusSchema: ReturnType<typeof createModbusSchema>;
  mqttSchema: ReturnType<typeof createMqttSchema>;
  modbusMutation: ReturnType<typeof useMutation<unknown, Error, ModbusForm>>;
  mqttMutation: ReturnType<typeof useMutation<unknown, Error, MqttForm>>;
  testMqttMutation: ReturnType<typeof useMutation<unknown, Error, MqttForm>>;
  testModbusMutation: ReturnType<typeof useMutation<unknown, Error, ModbusForm>>;
  saveHruMutation: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      { host: string; port: number; unitId: number; unit: string; maxPower?: number }
    >
  >;
  saveLanguageMutation: ReturnType<typeof useMutation<unknown, Error, string>>;
  saveThemeMutation: ReturnType<typeof useMutation<unknown, Error, string>>;
  finishMutation: ReturnType<typeof useMutation<unknown, Error, void>>;
  importDbMutation: ReturnType<typeof useMutation<unknown, Error, File>>;
  unitsQuery: ReturnType<typeof useQuery<{ id: string; name: string }[], Error>>;
  systemInfoQuery: ReturnType<typeof useQuery<{ hassHost: string }, Error>>;
  statusQuery: ReturnType<
    typeof useQuery<
      {
        onboardingDone: boolean;
        hruConfigured: boolean;
        mqttConfigured: boolean;
        luftatorAvailable: boolean;
      },
      Error
    >
  >;
  importInputRef: RefObject<HTMLInputElement | null>;
}

const StepsContext = createContext<StepsContextValue | null>(null);

export function useStepsContext() {
  const ctx = useContext(StepsContext);
  if (!ctx) throw new Error("useStepsContext must be used inside StepsContext.Provider");
  return ctx;
}

interface OnboardingWizardProps {
  children: ReactNode;
}

export function OnboardingWizard({ children }: OnboardingWizardProps) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useMantineColorScheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);
  const [selectedTheme, setSelectedTheme] = useState<"light" | "dark">(
    colorScheme === "auto" ? "dark" : (colorScheme as "light" | "dark"),
  );
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [maxPower, setMaxPower] = useState<number | undefined>(undefined);
  const [fullUnits, setFullUnits] = useState<HruUnit[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const mqttHostPrefilled = useRef(false);

  const totalSteps = 6;

  const modbusSchema = useMemo(() => createModbusSchema(t), [t]);
  const mqttSchema = useMemo(() => createMqttSchema(t), [t]);

  const modbusForm = useForm<ModbusForm>({
    initialValues: { host: "0.0.0.0", port: 502, unitId: 1 },
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
    initialValues: { enabled: true, host: "", port: 1883, user: "", password: "" },
    validate: (values) => {
      if (!values.enabled) return {};
      const result = mqttSchema.safeParse(values);
      const errors: Record<string, string> = {};
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          if (issue.path[0]) errors[issue.path[0].toString()] = issue.message;
        });
      }
      if (!values.host?.trim()) {
        errors.host = t("onboarding.mqtt.hostRequired");
      }
      return errors;
    },
  });

  const unitsQuery = useQuery({
    queryKey: ["hru-units"],
    queryFn: async () => {
      const units = await fetchHruUnits();
      logger.info("Fetched units successfully", { count: units.length });
      setFullUnits(units);
      return units.map((u) => ({ id: u.id, name: u.name }));
    },
    enabled: currentStep === 2,
  });

  const selectedUnitDef = useMemo(() => {
    return fullUnits.find((u) => u.id === selectedUnit);
  }, [fullUnits, selectedUnit]);

  const isDemoUnit = useMemo(() => {
    if (!selectedUnitDef) return false;
    return selectedUnitDef.interfaceType === "demo" || selectedUnitDef.code === "demo";
  }, [selectedUnitDef]);

  const powerVariable = useMemo(() => {
    return selectedUnitDef?.variables.find((v) => v.class === "power");
  }, [selectedUnitDef]);

  const requiresMaxPower = powerVariable?.maxConfigurable ?? false;
  const defaultMaxPower = powerVariable?.maxDefault ?? powerVariable?.max;

  useEffect(() => {
    if (
      selectedUnit &&
      requiresMaxPower &&
      maxPower === undefined &&
      defaultMaxPower !== undefined
    ) {
      setMaxPower(defaultMaxPower);
    }
  }, [selectedUnit, requiresMaxPower, defaultMaxPower, maxPower]);

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
    if (systemInfoQuery.data?.hassHost && !mqttHostPrefilled.current) {
      mqttForm.setFieldValue("host", systemInfoQuery.data.hassHost);
      mqttHostPrefilled.current = true;
    }
  }, [systemInfoQuery.data, mqttForm]);

  const saveHruMutation = useMutation({
    mutationFn: async (data: {
      host: string;
      port: number;
      unitId: number;
      unit: string;
      maxPower?: number;
    }) => {
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
      if (!res.ok) {
        const detail = await res.text();
        let errorMessage = detail;
        try {
          const json = JSON.parse(detail);
          errorMessage = json.detail || detail;
        } catch {
          logger.warn("Failed to parse MQTT test error response", { detail });
        }
        throw new Error(errorMessage || "Connection failed");
      }
      const json = await res.json();
      const success = json?.success ?? json?.data?.success;
      if (!success) throw new Error(json?.detail || "Connection failed");
      return json;
    },
    onSuccess: () => logger.info("MQTT connection test successful"),
    onError: (error) => logger.error("MQTT connection test failed", { error }),
  });

  const testModbusMutation = useMutation({
    mutationFn: async (data: ModbusForm) => {
      const params = new URLSearchParams({ host: data.host, port: data.port.toString() });
      const res = await fetch(resolveApiUrl(`/api/modbus/status?${params.toString()}`));
      if (!res.ok) throw new Error("Failed to probe Modbus");
      const json = await res.json();
      if (!json.reachable) throw new Error(json.error || "Modbus unreachable");
      return json;
    },
    onSuccess: () => logger.info("Modbus connection test successful"),
    onError: (error) => logger.error("Modbus connection test failed", { error }),
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

  const finishMutation = useMutation({
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

  const importDbMutation = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const res = await fetch(resolveApiUrl("/api/database/import"), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buffer,
      });
      if (!res.ok) throw await parseApiError(res);
      const finish = await fetch(resolveApiUrl("/api/settings/onboarding-finish"), {
        method: "POST",
      });
      if (!finish.ok) throw new Error("Failed to finish onboarding");
    },
    onSuccess: async () => {
      notifications.show({
        title: t("settings.database.notifications.importSuccessTitle"),
        message: t("onboarding.welcome.importSuccess"),
        color: "green",
      });
      await queryClient.invalidateQueries({ queryKey: ["onboarding-layout-check"] });
      await navigate({ to: "/" });
    },
    onError: (error) => {
      notifications.show({
        title: t("onboarding.welcome.importError"),
        message: translateApiError(error, t),
        color: "red",
      });
      logger.error("Failed to import database", { error });
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
    enabled: currentStep === 5,
    refetchInterval: currentStep === 5 ? 2000 : false,
  });

  const nextStep = useCallback(() => {
    const next = currentStep + 1;
    logger.info("Navigating to next step", { from: currentStep, to: next });
    setCurrentStep(next);
  }, [currentStep]);

  const prevStep = useCallback(() => {
    const prev = currentStep > 0 ? currentStep - 1 : currentStep;
    logger.info("Navigating to previous step", { from: currentStep, to: prev });
    setCurrentStep(prev);
  }, [currentStep]);

  const ctx: StepsContextValue = {
    currentStep,
    totalSteps,
    nextStep,
    prevStep,
    setStep: setCurrentStep,
    selectedUnit,
    setSelectedUnit,
    maxPower,
    setMaxPower,
    fullUnits,
    selectedUnitDef,
    requiresMaxPower,
    defaultMaxPower,
    powerVariable,
    isDemoUnit,
    modbusForm,
    mqttForm,
    selectedLanguage,
    setSelectedLanguage,
    selectedTheme,
    setSelectedTheme,
    modbusSchema,
    mqttSchema,
    modbusMutation: saveHruMutation as ReturnType<typeof useMutation<unknown, Error, ModbusForm>>,
    mqttMutation: saveMqttMutation as ReturnType<typeof useMutation<unknown, Error, MqttForm>>,
    testMqttMutation: testMqttMutation as ReturnType<typeof useMutation<unknown, Error, MqttForm>>,
    testModbusMutation: testModbusMutation as ReturnType<
      typeof useMutation<unknown, Error, ModbusForm>
    >,
    saveHruMutation,
    saveLanguageMutation,
    saveThemeMutation,
    finishMutation,
    importDbMutation,
    unitsQuery,
    systemInfoQuery,
    statusQuery,
    importInputRef,
  };

  return <StepsContext.Provider value={ctx}>{children}</StepsContext.Provider>;
}

export function useOnboardingWizard() {
  return useStepsContext();
}
