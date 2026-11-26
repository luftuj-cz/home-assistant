import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { fetchHruUnits, type HruUnit, type HruVariable } from "@luftuj/shared/api/hru";
import { notify } from "@luftuj/shared/ui/notify";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError } from "@luftuj/shared/utils/apiError";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("OnboardingWizard");

function createModbusSchema(t: (key: string) => string) {
  return z.object({
    host: z.string().trim().min(1, t("onboarding.modbus.hostRequired")),
    port: z
      .number(t("onboarding.modbus.portRequired"))
      .min(1, t("onboarding.modbus.portRequired"))
      .max(65535),
    unitId: z
      .number(t("onboarding.modbus.unitIdRequired"))
      .min(0, t("onboarding.modbus.unitIdRequired"))
      .max(255),
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

export type ModbusForm = z.infer<ReturnType<typeof createModbusSchema>>;
export type MqttForm = z.infer<ReturnType<typeof createMqttSchema>>;

export interface OnboardingStatus {
  onboardingDone: boolean;
  hruConfigured: boolean;
  mqttConfigured: boolean;
  luftatorAvailable: boolean;
  /** LUFTaTOR entities Home Assistant knows; null when it could not be asked. */
  luftatorEntityCount: number | null;
}

interface HruSaveInput {
  host: string;
  port: number;
  unitId: number;
  unit: string;
  minPower?: number;
  maxPower?: number;
}

/** The seven steps, in order. */
export const ONBOARDING_STEPS = [
  "welcome",
  "preferences",
  "control",
  "unit",
  "mqtt",
  "modbus",
  "status",
] as const;

/** How LUFTaTOR is to drive the ventilation: the weekly plan or automatic control by CO₂. */
export type ControlMode = "schedule" | "automatic";

async function postJson(path: string, body: unknown, failure: string) {
  const res = await fetch(resolveApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    logger.error(failure, { status: res.status, statusText: res.statusText });
    throw new Error(failure);
  }
}

function useWizardState() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState(0);
  // False until the user moves between steps, so the first step does not grab focus on page load.
  const [navigated, setNavigated] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);
  // Saved as `control.mode` when the step is left; nothing acts on it until LUFTaTOR Algo CO2 is wired in.
  const [controlMode, setControlMode] = useState<ControlMode>("schedule");
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [minPower, setMinPower] = useState<number | undefined>(undefined);
  const [maxPower, setMaxPower] = useState<number | undefined>(undefined);
  const mqttHostPrefilled = useRef(false);

  const totalSteps = ONBOARDING_STEPS.length;

  const modbusSchema = useMemo(() => createModbusSchema(t), [t]);
  const mqttSchema = useMemo(() => createMqttSchema(t), [t]);

  const modbusForm = useForm<ModbusForm>({
    defaultValues: { host: "0.0.0.0", port: 502, unitId: 1 },
    resolver: zodResolver(modbusSchema),
  });

  const mqttForm = useForm<MqttForm>({
    defaultValues: { enabled: true, host: "", port: 1883, user: "", password: "" },
    resolver: zodResolver(mqttSchema),
  });

  const unitsQuery = useQuery({
    queryKey: ["hru-units"],
    queryFn: async (): Promise<HruUnit[]> => {
      const units = await fetchHruUnits();
      logger.info("Fetched units successfully", { count: units.length });
      return units;
    },
    enabled: currentStep >= ONBOARDING_STEPS.indexOf("unit"),
  });
  const units = useMemo(() => unitsQuery.data ?? [], [unitsQuery.data]);

  const selectedUnitDef = useMemo(
    () => units.find((unit) => unit.id === selectedUnit),
    [units, selectedUnit],
  );
  const isDemoUnit =
    selectedUnitDef !== undefined &&
    (selectedUnitDef.interfaceType === "demo" || selectedUnitDef.code === "demo");
  const powerVariable: HruVariable | undefined = selectedUnitDef?.variables.find(
    (variable) => variable.class === "power",
  );

  const requiresMaxPower = powerVariable?.maxConfigurable ?? false;
  const defaultMaxPower = powerVariable?.maxDefault ?? powerVariable?.max;
  const requiresMinPower = powerVariable?.minConfigurable ?? false;
  const defaultMinPower = powerVariable?.minDefault ?? powerVariable?.min;

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

  useEffect(() => {
    if (
      selectedUnit &&
      requiresMinPower &&
      minPower === undefined &&
      defaultMinPower !== undefined
    ) {
      setMinPower(defaultMinPower);
    }
  }, [selectedUnit, requiresMinPower, defaultMinPower, minPower]);

  const selectUnit = useCallback(
    (unit: string | null) => {
      // minPower and maxPower were entered for the previous unit; clearing them
      // lets the effects above start the new unit from its own defaults.
      if (unit !== selectedUnit) {
        setMinPower(undefined);
        setMaxPower(undefined);
      }
      setSelectedUnit(unit);
    },
    [selectedUnit],
  );

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
    const hassHost = systemInfoQuery.data?.hassHost;
    if (hassHost && !mqttHostPrefilled.current) {
      mqttHostPrefilled.current = true;
      if (!mqttForm.getFieldState("host").isDirty) mqttForm.setValue("host", hassHost);
    }
  }, [systemInfoQuery.data, mqttForm]);

  const saveHruMutation = useMutation({
    mutationFn: (data: HruSaveInput) =>
      postJson("/api/settings/hru", data, "Failed to save HRU settings"),
  });

  const saveMqttMutation = useMutation({
    mutationFn: (data: MqttForm) =>
      postJson("/api/settings/mqtt", data, "Failed to save MQTT settings"),
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
      if (!res.ok) throw await parseApiError(res);
      const json = await res.json();
      const success = json?.success ?? json?.data?.success;
      if (!success) throw new Error(json?.detail || "Connection failed");
      return json;
    },
    onSuccess: () => logger.info("MQTT connection test successful"),
    onError: (error) => logger.error("MQTT connection test failed", { error }),
  });

  const saveLanguageMutation = useMutation({
    mutationFn: (lang: string) =>
      postJson("/api/settings/language", { language: lang }, "Failed to save language"),
  });

  const saveThemeMutation = useMutation({
    mutationFn: (theme: string) =>
      postJson("/api/settings/theme", { theme }, "Failed to save theme"),
  });

  const saveControlModeMutation = useMutation({
    mutationFn: (mode: ControlMode) =>
      postJson("/api/settings/control-mode", { mode }, "Failed to save control mode"),
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      // Where to go next follows the Řízení choice: set up rooms for automatic control, or build the plan.
      await navigate({ to: controlMode === "automatic" ? "/automatic" : "/timeline" });
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
      // The page goes to Přehled at once, so a toast is the only place left to say it worked.
      notify({
        title: t("settings.database.notifications.importSuccessTitle"),
        message: t("onboarding.welcome.importSuccess"),
        variant: "success",
      });
      await queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      await navigate({ to: "/" });
    },
    onError: (error) => logger.error("Failed to import database", { error }),
  });

  const statusQuery = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/settings/onboarding-status"));
      if (!res.ok) {
        logger.error("Failed to check status", { status: res.status, statusText: res.statusText });
        throw new Error("Failed to check status");
      }
      return (await res.json()) as OnboardingStatus;
    },
    enabled: currentStep === totalSteps - 1,
    refetchInterval: currentStep === totalSteps - 1 ? 2000 : false,
  });

  const nextStep = useCallback(() => {
    const next = Math.min(currentStep + 1, totalSteps - 1);
    logger.info("Navigating to next step", { from: currentStep, to: next });
    setNavigated(true);
    setCurrentStep(next);
  }, [currentStep, totalSteps]);

  const prevStep = useCallback(() => {
    const prev = Math.max(currentStep - 1, 0);
    logger.info("Navigating to previous step", { from: currentStep, to: prev });
    setNavigated(true);
    setCurrentStep(prev);
  }, [currentStep]);

  return {
    currentStep,
    totalSteps,
    navigated,
    nextStep,
    prevStep,
    controlMode,
    setControlMode,
    selectedUnit,
    setSelectedUnit: selectUnit,
    minPower,
    setMinPower,
    maxPower,
    setMaxPower,
    units,
    selectedUnitDef,
    requiresMinPower,
    defaultMinPower,
    requiresMaxPower,
    defaultMaxPower,
    powerVariable,
    isDemoUnit,
    modbusForm: modbusForm as UseFormReturn<ModbusForm>,
    mqttForm: mqttForm as UseFormReturn<MqttForm>,
    selectedLanguage,
    setSelectedLanguage,
    saveHruMutation,
    saveMqttMutation,
    testMqttMutation,
    saveLanguageMutation,
    saveThemeMutation,
    saveControlModeMutation,
    finishMutation,
    importDbMutation,
    unitsQuery,
    statusQuery,
  };
}

type WizardValue = ReturnType<typeof useWizardState>;

const WizardContext = createContext<WizardValue | null>(null);

/** Holds the wizard's state, both forms and every request, so steps keep their values when you go back. */
export function OnboardingWizard({ children }: Readonly<{ children: ReactNode }>) {
  const value = useWizardState();
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useOnboardingWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useOnboardingWizard must be used inside OnboardingWizard");
  return ctx;
}
