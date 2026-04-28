import { useHruConfig } from "./useHruConfig";
import { useModbusProbe } from "./useModbusProbe";
import { useHruPoll } from "./useHruPoll";
import { useSystemStatus } from "./useSystemStatus";

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
  };
}
