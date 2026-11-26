import { IconHome, IconSettings } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import mqttMark from "@luftuj/assets/mqtt-icon-solid.svg";
import {
  ConnectionList,
  type ConnectionItem,
} from "@luftuj/features/dashboard/components/ConnectionList";
import { useAutomaticStatus } from "@luftuj/features/automatic/hooks";
import { CustomPlanCard } from "@luftuj/features/dashboard/components/CustomPlanCard";
import { ManualModeCard } from "@luftuj/features/dashboard/components/ManualModeCard";
import { UnitPanel } from "@luftuj/features/dashboard/components/UnitPanel";
import { useCustomPlans } from "@luftuj/features/dashboard/hooks/useCustomPlans";
import { useDashboardStatus } from "@luftuj/features/dashboard/hooks/useDashboardStatus";
import { useTodayPlan } from "@luftuj/features/dashboard/hooks/useTodayPlan";
import { useTimelineModesQuery } from "@luftuj/features/timeline/hooks/useTimelineModesQuery";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { IconModbus } from "@luftuj/shared/ui/icons";
import { PageHeader } from "@luftuj/shared/ui/page-header";
import { cn } from "@luftuj/shared/utils/cn";
import { translateConnectionError } from "@luftuj/shared/utils/connectionError";

/** Ticks every second while `enabled`, for "před 8 s" ages. */
function useSecondClock(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

function age(t: TFunction, since: number | null, now: number) {
  if (since === null) return undefined;
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds < 60
    ? t("app.unit.ageSeconds", { count: seconds })
    : t("app.unit.ageMinutes", { count: Math.floor(seconds / 60) });
}

/** Planes rise in on load, staggered 45 ms apart. */
function Rise({
  index,
  className,
  children,
}: Readonly<{ index: number; className?: string; children: ReactNode }>) {
  return (
    <div
      className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] animate-rise empty:hidden", className)}
      style={{ animationDelay: `${Math.min(index, 5) * 45}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * Přehled. Desktop: UnitPanel on the left 8 columns beside a side column of CustomPlanCard (only with plans or one
 * running) and ConnectionList; both halves stretch to one height, the extra going to the unit's hero and the
 * connection rows. ManualModeCard spans the full width below. Below 1024px everything stacks in DOM order: the unit's
 * state first, then the manual modes, then the side column.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const automatic = useAutomaticStatus();
  const {
    haStatus,
    haLoading,
    modbusStatus,
    modbusLive,
    hruStatus,
    hruName,
    modbusHost,
    modbusPort,
    mqttStatus,
    mqttLastDiscovery,
    mqttError,
    activeMode,
    configuredMaxPower,
    unitId,
  } = useDashboardStatus();

  const { modes } = useTimelineModesQuery(unitId);
  const { data: customPlans } = useCustomPlans(unitId);
  const today = useTodayPlan(unitId, activeMode, customPlans?.override);
  const address = modbusHost ? `${modbusHost}${modbusPort ? `:${modbusPort}` : ""}` : undefined;

  const modbusTrouble = Boolean(modbusLive?.reconnecting) || modbusStatus === "unreachable";
  const mqttTrouble = mqttStatus === "disconnected";
  const now = useSecondClock(modbusTrouble || mqttTrouble);

  /** A fix button that opens the settings section about the failing connection. */
  function settingsAction(label: string, section: "hru" | "mqtt") {
    return (
      <Button
        variant="secondary"
        icon={IconSettings}
        onClick={() => void navigate({ to: "/settings", search: { section } })}
      >
        {label}
      </Button>
    );
  }

  let haItem: ConnectionItem;
  {
    let status: ConnectionItem["status"] = "error";
    if (haLoading) status = "neutral";
    else if (haStatus === "connected") status = "success";
    else if (haStatus === "connecting") status = "warning";
    haItem = {
      name: t("dashboard.haStatusTitle"),
      description: t("dashboard.haStatusDescription"),
      icon: IconHome,
      status,
      label: haLoading ? t("dashboard.haStatus.loading") : t(`dashboard.haStatus.${haStatus}`),
    };
  }

  let modbusItem: ConnectionItem;
  {
    const error =
      modbusLive?.lastErrorCode || modbusLive?.lastErrorMessage
        ? translateConnectionError(
            "modbusErrors",
            modbusLive.lastErrorCode,
            modbusLive.lastErrorMessage,
            t,
          )
        : undefined;
    const code = modbusLive?.lastErrorCode
      ? [modbusLive.lastErrorCode, address].filter(Boolean).join(" ")
      : undefined;
    const base = {
      name: t("dashboard.modbusStatusTitle"),
      description: t("dashboard.modbusStatusDescription"),
      icon: IconModbus,
    };
    if (modbusLive?.reconnecting) {
      modbusItem = {
        ...base,
        status: "warning",
        label: t("dashboard.connections.reconnecting"),
        attempts: modbusLive.consecutiveFailures + 1,
        error,
        errorCode: code,
        errorAge: age(t, modbusLive.lastErrorAt, now),
      };
    } else if (modbusStatus === "unreachable") {
      modbusItem = {
        ...base,
        status: "error",
        label: t("dashboard.modbusStatus.unreachable"),
        error: error ?? t("dashboard.connections.unitUnreachable"),
        errorCode: code,
        errorAge: age(t, modbusLive?.lastErrorAt ?? null, now),
        action: settingsAction(t("dashboard.connections.openUnitSettings"), "hru"),
      };
    } else {
      modbusItem = {
        ...base,
        status: modbusStatus === "loading" ? "neutral" : "success",
        label:
          modbusStatus === "loading"
            ? t("dashboard.haStatus.loading")
            : t("dashboard.modbusStatus.reachable"),
      };
    }
  }

  let mqttItem: ConnectionItem;
  {
    const description = mqttLastDiscovery
      ? t("dashboard.mqttStatus.lastDiscovery", {
          time: new Date(mqttLastDiscovery).toLocaleString(),
        })
      : t("dashboard.mqttStatusDescription");
    const base = { name: t("dashboard.mqttStatusTitle"), description, mark: mqttMark };
    if (mqttStatus === "disconnected") {
      const hasError = Boolean(mqttError?.lastErrorCode || mqttError?.lastErrorMessage);
      mqttItem = {
        ...base,
        status: "error",
        label: t("dashboard.mqttStatus.disconnected"),
        error: hasError
          ? translateConnectionError(
              "mqttErrors",
              mqttError?.lastErrorCode ?? null,
              mqttError?.lastErrorMessage ?? null,
              t,
            )
          : undefined,
        errorCode: mqttError?.lastErrorCode ?? undefined,
        errorAge: age(t, mqttError?.lastErrorAt ?? null, now),
        action: hasError
          ? settingsAction(t("dashboard.connections.openMqttSettings"), "mqtt")
          : undefined,
      };
    } else {
      mqttItem = {
        ...base,
        status: mqttStatus === "loading" ? "neutral" : "success",
        label:
          mqttStatus === "loading"
            ? t("dashboard.haStatus.loading")
            : t("dashboard.mqttStatus.connected"),
      };
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 font-sans text-sm leading-5 text-foreground max-md:gap-4">
      <PageHeader title={t("dashboard.title")} description={t("dashboard.systemStatus")} />
      {automatic.data?.active && automatic.data.reason && (
        <Alert
          variant="warning"
          title={t(`automatic.reasons.${automatic.data.reason}`)}
          action={
            <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/automatic" })}>
              {t("dashboard.automaticOpen")}
            </Button>
          }
        >
          {t("automatic.status.safeState")}
        </Alert>
      )}
      <div className="grid grid-cols-12 gap-6 max-lg:grid-cols-[minmax(0,1fr)] max-md:gap-4">
        <Rise index={0} className="col-span-8 row-start-1 max-lg:col-span-1 max-lg:row-start-auto">
          <UnitPanel
            status={hruStatus}
            name={hruName}
            address={address}
            activeMode={activeMode}
            configuredMaxPower={configuredMaxPower}
            today={today}
          />
        </Rise>
        <Rise index={3} className="col-span-12 row-start-2 max-lg:col-span-1 max-lg:row-start-auto">
          <ManualModeCard modes={modes} unitId={unitId} />
        </Rise>
        <div className="col-span-4 col-start-9 row-start-1 flex flex-col gap-6 max-lg:col-span-1 max-lg:col-start-auto max-lg:row-start-auto max-md:gap-4">
          <Rise index={1}>
            <CustomPlanCard unitId={unitId} />
          </Rise>
          <Rise index={2} className="flex-1">
            <ConnectionList items={[haItem, modbusItem, mqttItem]} />
          </Rise>
        </div>
      </div>
    </div>
  );
}
