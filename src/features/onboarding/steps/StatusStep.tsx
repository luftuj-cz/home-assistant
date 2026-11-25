import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  SetupChecklist,
  type ChecklistItem,
  type ChecklistState,
} from "@luftuj/features/onboarding/components/SetupChecklist";
import { StepFrame } from "@luftuj/features/onboarding/components/StepFrame";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { Alert } from "@luftuj/shared/ui/alert";
import { resolveApiUrl } from "@luftuj/shared/utils/api";

/** Home Assistant usually picks the device up within a minute of MQTT connecting. */
const USUAL_WAIT = 60;

interface LiveStatus {
  mqtt?: { connection?: "connected" | "disconnected" };
  modbus?: { connected?: boolean; reconnecting?: boolean; lastErrorMessage?: string | null };
}

/** The connections as the backend sees them now (no WebSocket: this page only needs a glance every 2 s). */
function useLiveStatus() {
  return useQuery({
    queryKey: ["status", "onboarding"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/status"));
      if (!res.ok) throw new Error("Failed to load status");
      return (await res.json()) as LiveStatus;
    },
    refetchInterval: 2000,
  });
}

/** Counts down the usual wait once, from the moment the step opens; null when it is over. */
function useCountdown(from: number) {
  const [seconds, setSeconds] = useState<number | null>(from);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((left) => (left !== null && left > 1 ? left - 1 : null));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * Status: a live checklist of what has to work (unit answers, MQTT broker connected, Home Assistant registers the
 * device) and Přejít na Přehled. You can go on before Home Assistant is done; the entities appear by themselves.
 */
export function StatusStep() {
  const { t } = useTranslation();
  const { statusQuery, finishMutation, modbusForm, mqttForm, selectedUnitDef, isDemoUnit } =
    useOnboardingWizard();
  const live = useLiveStatus();
  const seconds = useCountdown(USUAL_WAIT);
  const [finishFailed, setFinishFailed] = useState(false);

  const modbus = modbusForm.getValues();
  const mqtt = mqttForm.getValues();
  const status = statusQuery.data;
  const mqttOn = status ? status.mqttConfigured : mqtt.enabled;

  let unitState: ChecklistState = "waiting";
  if (isDemoUnit || live.data?.modbus?.connected) unitState = "done";
  else if (live.data?.modbus?.lastErrorMessage && !live.data.modbus.reconnecting)
    unitState = "error";

  const items: ChecklistItem[] = [
    {
      label: t("onboarding.status.checks.unit"),
      detail: isDemoUnit
        ? selectedUnitDef?.name
        : [selectedUnitDef?.name, `${modbus.host}:${modbus.port}`].filter(Boolean).join(" · "),
      state: unitState,
    },
  ];
  if (mqttOn) {
    items.push(
      {
        label: t("onboarding.status.checks.mqtt"),
        detail: `${mqtt.host}:${mqtt.port}`,
        state: live.data?.mqtt?.connection === "connected" ? "done" : "waiting",
      },
      {
        label: t("onboarding.status.checks.ha"),
        detail: status?.luftatorAvailable
          ? t("onboarding.status.checks.entities", { count: status.luftatorEntityCount ?? 0 })
          : t("onboarding.status.checks.haWaiting"),
        state: status?.luftatorAvailable ? "done" : "waiting",
      },
    );
  } else {
    items.push({
      label: t("onboarding.status.checks.mqtt"),
      detail: t("onboarding.status.checks.mqttOff"),
      state: "error",
    });
  }

  const unitDone = unitState === "done";
  const done = mqttOn ? items.every((item) => item.state === "done") : unitDone;
  let title = t("onboarding.status.waitingTitle");
  let description = t("onboarding.status.waitingHA");
  if (done && mqttOn) {
    title = t("onboarding.status.doneTitle");
    description = t("onboarding.status.ready");
  } else if (done) {
    title = t("onboarding.status.unitReadyTitle");
    description = t("onboarding.status.unitReady");
  } else if (!unitDone) {
    title = t("onboarding.status.waitingUnitTitle");
    description = t("onboarding.status.waitingUnit");
  }

  async function handleFinish() {
    setFinishFailed(false);
    try {
      await finishMutation.mutateAsync();
    } catch {
      setFinishFailed(true);
    }
  }

  return (
    <StepFrame
      title={t("onboarding.status.title")}
      nextLabel={t("onboarding.status.dashboard")}
      onNext={() => void handleFinish()}
      busy={finishMutation.isPending}
    >
      <SetupChecklist
        items={items}
        done={done}
        title={title}
        description={description}
        seconds={seconds}
        total={USUAL_WAIT}
      />
      {finishFailed && <Alert variant="destructive">{t("onboarding.errors.finishFailed")}</Alert>}
    </StepFrame>
  );
}
