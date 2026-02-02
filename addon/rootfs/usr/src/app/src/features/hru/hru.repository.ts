import type { Logger } from "pino";
import { withTempModbusClient } from "../../shared/modbus/client";
import { applyWriteDefinition } from "../../utils/hruWrite";
import type { HruRegister, HruWriteDefinition } from "./hru.definitions";

export class HruRepository {
  constructor(private readonly logger: Logger) {}

  async readRegisters(
    config: { host: string; port: number; unitId: number },
    registers: { power: HruRegister; temperature: HruRegister; mode: HruRegister },
  ): Promise<{ power: number; temperature: number; mode: number }> {
    return withTempModbusClient(config, this.logger, async (mb) => {
      // Parallel reads would be better if client supports it, but simple wait for now
      const [power] = await mb.readHolding(registers.power.address, 1);
      const [temperature] = await mb.readHolding(registers.temperature.address, 1);
      const [mode] = await mb.readHolding(registers.mode.address, 1);

      return {
        power: power ?? 0,
        temperature: temperature ?? 0,
        mode: mode ?? 0,
      };
    });
  }

  async writeRegisters(
    config: { host: string; port: number; unitId: number },
    writeDefs: {
      power?: HruWriteDefinition;
      temperature?: HruWriteDefinition;
      mode?: HruWriteDefinition;
    },
    values: { power?: number; temperature?: number; mode?: number },
  ): Promise<void> {
    return withTempModbusClient(config, this.logger, async (mb) => {
      if (values.power !== undefined && writeDefs.power) {
        await applyWriteDefinition(mb, writeDefs.power, values.power);
      }
      if (values.temperature !== undefined && writeDefs.temperature) {
        await applyWriteDefinition(mb, writeDefs.temperature, values.temperature);
      }
      if (values.mode !== undefined && writeDefs.mode) {
        await applyWriteDefinition(mb, writeDefs.mode, values.mode);
      }
    });
  }
}
