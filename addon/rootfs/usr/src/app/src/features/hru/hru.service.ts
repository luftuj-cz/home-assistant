import type { HruRepository } from "./hru.repository";
import type { SettingsRepository } from "../settings/settings.repository";
import { HruNotConfiguredError } from "../../shared/errors/apiErrors";
import { HRU_UNITS, getUnitById } from "./hru.definitions";

export interface HruReadResult {
  raw: { power: number; temperature: number; mode: number };
  value: { power: number; temperature: number; mode: string };
  registers: {
    power: { unit?: string; scale?: number; precision?: number };
    temperature: { unit?: string; scale?: number; precision?: number };
  };
}

export class HruService {
  constructor(
    private readonly repository: HruRepository,
    private readonly settingsRepo: SettingsRepository,
  ) {}

  getAllUnits() {
    return HRU_UNITS.map((u) => ({
      id: u.id,
      name: u.name,
      description: u.description,
      capabilities: u.capabilities ?? null,
      registers: {
        read: {
          power: u.registers.read.power,
          temperature: u.registers.read.temperature,
          mode: {
            address: u.registers.read.mode.address,
            kind: u.registers.read.mode.kind,
            values: u.registers.read.mode.values,
          },
        },
        write: u.registers.write ?? null,
      },
    }));
  }

  getModes(): { id: number; name: string }[] {
    const { def } = this.getResolvedSettings();
    return Object.entries(def.registers.read.mode.values).map(([id, name]) => ({
      id: Number(id),
      name,
    }));
  }

  async readValues(): Promise<HruReadResult> {
    const { settings, def } = this.getResolvedSettings();

    const { power, temperature, mode } = await this.repository.readRegisters(
      settings,
      def.registers.read,
    );

    const scale = def.registers.read.temperature.scale ?? 1;
    return {
      raw: { power, temperature, mode },
      value: {
        power,
        temperature: temperature * scale,
        mode: def.registers.read.mode.values[mode] ?? String(mode),
      },
      registers: {
        power: {
          unit: def.registers.read.power.unit,
          scale: def.registers.read.power.scale,
          precision: def.registers.read.power.precision,
        },
        temperature: {
          unit: def.registers.read.temperature.unit,
          scale: def.registers.read.temperature.scale,
          precision: def.registers.read.temperature.precision,
        },
      },
    };
  }

  async writeValues(data: {
    power?: number;
    temperature?: number;
    mode?: number | string;
  }): Promise<void> {
    const { settings, def } = this.getResolvedSettings();

    const modeValue =
      data.mode !== undefined
        ? this.resolveMode(def.registers.read.mode.values, data.mode)
        : undefined;

    await this.repository.writeRegisters(settings, def.registers.write ?? {}, {
      power: data.power,
      temperature: data.temperature,
      mode: modeValue,
    });
  }

  private resolveMode(values: Record<number, string>, mode: number | string): number {
    if (typeof mode === "number") return mode;
    const entry = Object.entries(values).find(([, name]) => name === mode);
    return entry ? Number(entry[0]) : Number(mode);
  }

  private getResolvedSettings() {
    const raw = this.settingsRepo.getHruSettings();
    if (!raw?.unit) throw new HruNotConfiguredError("HRU unit not configured");
    const def = getUnitById(raw.unit);
    if (!def) throw new HruNotConfiguredError("Unknown HRU unit");
    return { settings: raw, def };
  }
}
