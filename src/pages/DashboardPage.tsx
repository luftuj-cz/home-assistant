import { Container, Stack, Title, Group, Text } from "@mantine/core";
import { IconLayoutDashboard } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useDashboardStatus } from "../hooks/useDashboardStatus";
import { useTimelineModes } from "../hooks/useTimelineModes";
import { StatusCard } from "../components/dashboard/StatusCard";
import { HruStatusCard } from "../components/dashboard/HruStatusCard";
import { BoostButtons } from "../components/dashboard/BoostButtons";
import { resolveApiUrl } from "../utils/api";
import * as hruApi from "../api/hru";

export function DashboardPage() {
  const { t } = useTranslation();
  const {
    haStatus,
    haLoading,
    modbusStatus,
    hruStatus,
    hruName,
    mqttStatus,
    mqttLastDiscovery,
    tempUnit,
    activeMode,
  } = useDashboardStatus();
  const { modes, loadModes } = useTimelineModes(t);
  const [activeUnitId, setActiveUnitId] = useState<string | undefined>(undefined);

  useEffect(() => {
    async function init() {
      try {
        const [settingsRes, units] = await Promise.all([
          fetch(resolveApiUrl("/api/settings/hru")).then(
            (r) => r.json() as Promise<{ unit?: string }>,
          ),
          hruApi.fetchHruUnits().catch(() => []),
        ]);

        const activeUnit = units.find((u) => u.id === settingsRes.unit) || units[0];
        const unitId = activeUnit?.id;
        setActiveUnitId(unitId);

        loadModes(unitId);
      } catch (err) {
        console.error("Failed to load dashboard context:", err);
      }
    }
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getHaStatusType() {
    if (haLoading) return "neutral";
    if (haStatus === "connected") return "success";
    if (haStatus === "connecting") return "warning";
    return "error";
  }

  function getModbusStatusType() {
    if (modbusStatus === "loading") return "neutral";
    if (modbusStatus === "reachable") return "success";
    return "error";
  }

  function getMqttStatusType() {
    if (mqttStatus === "loading") return "neutral";
    if (mqttStatus === "connected") return "success";
    return "error";
  }

  function formatDiscoveryTime(timeStr: string | null) {
    if (!timeStr) return t("dashboard.haStatus.loading");
    try {
      const date = new Date(timeStr);
      return date.toLocaleString();
    } catch {
      return timeStr;
    }
  }

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap={0}>
          <Group gap="sm">
            <IconLayoutDashboard size={32} color="var(--mantine-primary-color-5)" />
            <Title order={1}>{t("dashboard.title")}</Title>
          </Group>
          <Text size="lg" c="dimmed" mt="xs">
            {t("dashboard.description", { defaultValue: "System status overview" })}
          </Text>
        </Stack>

        <BoostButtons modes={modes} t={t} activeUnitId={activeUnitId} />

        <HruStatusCard
          status={hruStatus}
          hruName={hruName}
          t={t}
          tempUnit={tempUnit}
          activeMode={activeMode}
        />

        <StatusCard
          title={t("dashboard.haStatusTitle", { defaultValue: "Home Assistant" })}
          description={t("dashboard.haStatusDescription", {
            defaultValue: "Backend connection to Home Assistant WebSocket",
          })}
          status={getHaStatusType()}
          statusLabel={
            haLoading ? t("dashboard.haStatus.loading") : t(`dashboard.haStatus.${haStatus}`)
          }
        />

        <StatusCard
          title={t("dashboard.modbusStatusTitle", { defaultValue: "Modbus TCP" })}
          description={t("dashboard.modbusStatusDescription", {
            defaultValue: "Reachability of the configured Modbus TCP server",
          })}
          status={getModbusStatusType()}
          statusLabel={
            modbusStatus === "loading"
              ? t("dashboard.haStatus.loading")
              : modbusStatus === "reachable"
                ? t("dashboard.modbusStatus.reachable")
                : t("dashboard.modbusStatus.unreachable")
          }
        />

        <StatusCard
          title={t("dashboard.mqttStatusTitle", { defaultValue: "MQTT Discovery" })}
          description={
            mqttLastDiscovery
              ? t("dashboard.mqttStatus.lastDiscovery", {
                  time: formatDiscoveryTime(mqttLastDiscovery),
                })
              : t("dashboard.mqttStatusDescription", {
                  defaultValue: "MQTT connection status and sensor publishing",
                })
          }
          status={getMqttStatusType()}
          statusLabel={
            mqttStatus === "loading"
              ? t("dashboard.haStatus.loading")
              : t(`dashboard.mqttStatus.${mqttStatus}`)
          }
        />
      </Stack>
    </Container>
  );
}
