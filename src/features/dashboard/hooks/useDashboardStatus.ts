import { useHruConfig } from "@luftuj/features/dashboard/hooks/useHruConfig";
import { useModbusProbe } from "@luftuj/features/dashboard/hooks/useModbusProbe";
import { useHruPoll } from "@luftuj/features/dashboard/hooks/useHruPoll";
import { useSystemStatus } from "@luftuj/features/dashboard/hooks/useSystemStatus";

export function useDashboardStatus() {
  const config = useHruConfig();
  const [modbusStatus, setModbusStatus] = useModbusProbe(
    config.modbusHost,
    config.modbusPort,
    config.modbusConfigLoaded,
  );
  const hruStatus = useHruPoll(setModbusStatus);
  const system = useSystemStatus();

  return {
    haStatus: system.haStatus,
    haLoading: system.haLoading,
    modbusStatus,
    hruStatus,
    hruName: config.hruName,
    mqttStatus: system.mqttStatus,
    mqttLastDiscovery: system.mqttLastDiscovery,
    activeMode: system.activeMode,
    configuredMaxPower: config.configuredMaxPower,
    unitId: config.unitId,
  };
}
