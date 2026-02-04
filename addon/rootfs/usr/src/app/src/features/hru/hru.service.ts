import type { HruRepository } from "./hru.repository";
import type { SettingsRepository } from "../settings/settings.repository";
import type { Logger } from "pino";
import { HruLoader } from "./hru.loader";
import { type RegulationStrategy, type HeatRecoveryUnit } from "./hru.definitions";

export interface HruReadResult {
  raw: { power: number; temperature: number; mode: number };
  value: { power: number; temperature: number; mode: string };
  registers: {
    power: { unit?: string; scale?: number; precision?: number; maxValue?: number };
    temperature: { unit?: string; scale?: number; precision?: number };
  };
}

export class HruService {
  private units: HeatRecoveryUnit[] = [];
  private strategies: RegulationStrategy[] = [];

  constructor(
    private readonly repository: HruRepository,
    private readonly settingsRepo: SettingsRepository,
    private readonly logger: Logger,
  ) {
    const loader = new HruLoader(this.logger);
    this.units = loader.loadUnits();
    this.strategies = loader.loadStrategies();
  }

  getAllUnits() {
    return this.units.map((u) => ({
      id: u.code || u.name,
      name: u.name,
      isConfigurable: u.isConfigurable,
      maxValue: u.maxValue,
      controlUnit: u.controlUnit,
      capabilities: this.getStrategyForUnit(u)?.capabilities ?? null,
      registers: null,
    }));
  }

  getModes(): { id: number; name: string }[] {
    const config = this.getResolvedConfiguration();
    if (!config) return [];
    const modes = config.strategy.modeCommands?.availableModes ?? {};
    return Object.entries(modes).map(([id, name]) => ({
      id: Number(id),
      name: name as string,
    }));
  }

  async readValues(): Promise<HruReadResult> {
    const configData = this.getResolvedConfiguration();
    if (!configData) throw new Error("HRU not configured");
    const { settings, strategy, unit } = configData;
    const config = { host: settings.host, port: settings.port, unitId: settings.unitId };

    let variables: Record<string, number> = {};

    if (strategy.powerCommands?.read) {
      const vars = await this.repository.executeScript(config, strategy.powerCommands.read);
      variables = { ...variables, ...vars };
    }
    if (strategy.temperatureCommands?.read) {
      const vars = await this.repository.executeScript(config, strategy.temperatureCommands.read);
      variables = { ...variables, ...vars };
    }
    if (strategy.modeCommands?.read) {
      const vars = await this.repository.executeScript(config, strategy.modeCommands.read);
      variables = { ...variables, ...vars };
    }

    const power = variables["$power"] ?? 0;
    const temperature = variables["$temperature"] ?? 0;
    const mode = variables["$mode"] ?? 0;

    return {
      raw: { power, temperature, mode },
      value: {
        power,
        temperature,
        mode: strategy.modeCommands?.availableModes[mode] ?? String(mode),
      },
      registers: {
        power: {
          unit: strategy.capabilities.powerUnit || unit.controlUnit || "%",
          scale: strategy.capabilities.powerStep ?? 1,
          precision: 0,
          maxValue: (unit.isConfigurable && settings.maxPower) || unit.maxValue,
        },
        temperature: {
          unit: strategy.capabilities.temperatureUnit || "°C",
          scale: strategy.capabilities.temperatureStep ?? 1,
          precision: 1,
        },
      },
    };
  }

  async writeValues(data: {
    power?: number;
    temperature?: number;
    mode?: number | string;
  }): Promise<void> {
    const configData = this.getResolvedConfiguration();
    if (!configData) throw new Error("HRU not configured");
    const { settings, strategy } = configData;
    const config = { host: settings.host, port: settings.port, unitId: settings.unitId };

    if (data.power !== undefined && strategy.powerCommands?.write) {
      await this.repository.executeScript(config, strategy.powerCommands.write, {
        $power: data.power,
      });
    }

    if (data.temperature !== undefined && strategy.temperatureCommands?.write) {
      await this.repository.executeScript(config, strategy.temperatureCommands.write, {
        $temperature: data.temperature,
      });
    }

    if (data.mode !== undefined && strategy.modeCommands?.write) {
      let modeVal: number;
      if (typeof data.mode === "string") {
        const entry = Object.entries(strategy.modeCommands.availableModes ?? {}).find(
          ([, name]) => name === data.mode,
        );
        modeVal = entry ? Number(entry[0]) : 0;
      } else {
        modeVal = data.mode;
      }

      await this.repository.executeScript(config, strategy.modeCommands.write, {
        $mode: modeVal,
      });
    }
  }

  private getStrategyForUnit(unit: HeatRecoveryUnit): RegulationStrategy | undefined {
    return this.strategies.find((s) => s.id === unit.regulationTypeId);
  }

  private getUnitById(id: string): HeatRecoveryUnit | undefined {
    return this.units.find((u) => u.name === id || u.code === id);
  }

  public getResolvedConfiguration() {
    const raw = this.settingsRepo.getHruSettings();
    if (!raw?.unit) return null;
    const unit = this.getUnitById(raw.unit);
    if (!unit) return null;
    const strategy = this.getStrategyForUnit(unit);
    if (!strategy) return null;

    return { settings: raw, unit, strategy };
  }
}
