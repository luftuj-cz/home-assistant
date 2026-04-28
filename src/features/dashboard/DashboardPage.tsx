import { Container, Stack, Title, Group, Text } from "@mantine/core";
import { IconLayoutDashboard } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useDashboardStatus } from "@luftuj/features/dashboard/hooks/useDashboardStatus";
import { useActiveUnitQuery } from "@luftuj/features/dashboard/hooks/useActiveUnitQuery";
import { useTimelineModesQuery } from "@luftuj/features/timeline/hooks/useTimelineModesQuery";
import { StatusCard } from "@luftuj/features/dashboard/components/StatusCard";
import { HruStatusCard } from "@luftuj/features/dashboard/components/HruStatusCard";
import { BoostButtons } from "@luftuj/features/dashboard/components/BoostButtons";

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
    activeMode,
    configuredMaxPower,
  } = useDashboardStatus();

  const { data: activeUnitData } = useActiveUnitQuery();
  const activeUnitId = activeUnitData?.unitId;
  const { modes } = useTimelineModesQuery(activeUnitId);

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
            {t("dashboard.systemStatus", { defaultValue: "System status overview" })}
          </Text>
        </Stack>

        <BoostButtons modes={modes} t={t} activeUnitId={activeUnitId} />

        <HruStatusCard
          status={hruStatus}
          hruName={hruName}
          t={t}
          activeMode={activeMode}
          configuredMaxPower={configuredMaxPower}
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
