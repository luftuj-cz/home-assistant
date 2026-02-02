import { Container, Stack, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useDashboardStatus } from "../hooks/useDashboardStatus";
import { StatusCard } from "../components/dashboard/StatusCard";
import { HruStatusCard } from "../components/dashboard/HruStatusCard";

export function DashboardPage() {
  const { t } = useTranslation();
  const { haStatus, haLoading, modbusStatus, hruStatus, hruName, mqttStatus, mqttLastDiscovery } =
    useDashboardStatus();

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
      <Stack gap="lg">
        <Title order={2}>{t("dashboard.title")}</Title>

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
            mqttStatus === "loading" ? t("dashboard.haStatus.loading") : t(`dashboard.mqttStatus.${mqttStatus}`)
          }
        />

        <HruStatusCard status={hruStatus} hruName={hruName} t={t} />
      </Stack>
    </Container>
  );
}
