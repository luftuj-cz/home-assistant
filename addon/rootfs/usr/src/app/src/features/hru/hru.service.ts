import type { HruSettings } from "../../types/index.js";
import type { HruRepository } from "./hru.repository.js";
import type { SettingsRepository } from "../settings/settings.repository.js";
import type { Logger } from "pino";
import { HruLoader } from "./hru.loader.js";
import { type HeatRecoveryUnit, type HruVariable } from "./hru.definitions.js";
import { HruNotConfiguredError, HruConnectionError } from "../../shared/errors/apiErrors.js";
import { resolveModeValue } from "../../utils/hruWrite.js";
import { getDemoState, setDemoState } from "../../services/demoState.js";

export interface HruUnitDefinition {
  id: string;
  code: string;
  name: string;
  variables: HruVariable[];
}

export interface HruReadResult {
  values: Record<string, number>;
  displayValues: Record<string, string | number | boolean>;
  variables: HruVariable[];
}

export class HruService {
  private units: HeatRecoveryUnit[];
  private readValuesInFlight: Promise<HruReadResult> | null = null;

  constructor(
    private readonly repository: HruRepository,
    private readonly settingsRepo: SettingsRepository,
    private readonly logger: Logger,
  ) {
    const loader = new HruLoader(this.logger);
    this.units = loader.loadUnits();
  }

  getAllUnits(): HruUnitDefinition[] {
    return this.units
      .map((u) => ({
        id: u.code,
        code: u.code,
        name: u.name,
        variables: u.variables,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getUnitById(id: string): HeatRecoveryUnit | null {
    return this.units.find((u) => u.code === id || u.name === id) ?? null;
  }

  getModes(unitIdOverride?: string): { id: number; name: string }[] {
    let unit: HeatRecoveryUnit | null;

    if (unitIdOverride) {
      unit = this.getUnitById(unitIdOverride) ?? null;
    } else {
      unit = this.getResolvedConfiguration()?.unit ?? null;
    }

    if (!unit) return [];

    const modeVar = unit.variables.find((v) => v.class === "mode" || v.name === "mode");
    if (!modeVar || !modeVar.options) return [];

    return modeVar.options
      .map((opt) => ({
        id: opt.value,
        name: typeof opt.label === "string" ? opt.label : opt.label.text,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async readValues(settingsOverride?: HruSettings): Promise<HruReadResult> {
    if (!settingsOverride) {
      if (this.readValuesInFlight) {
        this.logger.debug("HRU readValues: joining in-flight read");
        return this.readValuesInFlight;
      }

      this.readValuesInFlight = this.readValuesInternal().finally(() => {
        this.readValuesInFlight = null;
      });

      return this.readValuesInFlight;
    }

    return this.readValuesInternal(settingsOverride);
  }

  private async readValuesInternal(settingsOverride?: HruSettings): Promise<HruReadResult> {
    const configData = this.getResolvedConfiguration(settingsOverride);
    if (!configData) {
      const err = new HruNotConfiguredError();
      this.logger.warn({ err }, "HRU read attempt while not configured");
      throw err;
    }

    const { settings, unit } = configData;

    // Demo units: return cached state (or zeroed defaults) without Modbus
    if (unit["interface-type"] === "demo") {
      const cached = getDemoState(unit.code);
      if (cached) {
        return {
          values: cached.values as Record<string, number>,
          displayValues: cached.displayValues as Record<string, string | number | boolean>,
          variables: cached.variables,
        };
      }

      const values: Record<string, number> = {};
      const displayValues: Record<string, string | number | boolean> = {};
      for (const v of unit.variables) {
        const base = v.type === "boolean" ? false : 0;
        values[v.name] = typeof base === "number" ? base : 0;
        displayValues[v.name] = base;
      }
      const demo = { values, displayValues, variables: unit.variables };
      setDemoState(unit.code, demo);
      return demo;
    }

    if (!settings.host) {
      const err = new HruNotConfiguredError("HRU host not configured");
      this.logger.warn({ err }, "HRU read attempt while host not configured");
      throw err;
    }

    const config = {
      host: settings.host,
      port: Number(settings.port) || 502,
      unitId: Number(settings.unitId) || 1,
    };

    try {
      const rawValues = await this.repository.executeScript(config, unit.integration.read);

      this.logger.info(
        { rawValues, unitVariables: unit.variables.map((v) => v.name) },
        "HRU readValues: raw values from script",
      );

      const values: Record<string, number> = {};
      const displayValues: Record<string, string | number | boolean> = {};

      for (const variable of unit.variables) {
        const key = `$${variable.name}`;
        const val = rawValues[key] ?? 0;
        values[variable.name] = val;

        if (variable.type === "boolean") {
          displayValues[variable.name] = val !== 0;
        } else if (variable.type === "select" && variable.options) {
          const opt = variable.options.find((o) => o.value === val);
          displayValues[variable.name] = opt
            ? typeof opt.label === "string"
              ? opt.label
              : opt.label.text
            : String(val);
        } else {
          displayValues[variable.name] = val;
        }
      }

      this.logger.info({ values, displayValues }, "HRU readValues: processed values");

      const result = {
        values,
        displayValues,
        variables: unit.variables,
      };

      this.logger.debug({ result }, "HRU values read successfully");
      return result;
    } catch (err) {
      this.logger.error({ err }, "Failed to read HRU values");
      throw new HruConnectionError("Failed to read HRU values", err);
    }
  }

  async writeValues(data: Record<string, number | string | boolean>): Promise<void> {
    const configData = this.getResolvedConfiguration();
    if (!configData) {
      const err = new HruNotConfiguredError();
      this.logger.warn({ err }, "HRU write attempt while not configured");
      throw err;
    }
    const { settings, unit } = configData;

    // Demo: store in memory and return, ignore Modbus
    if (unit["interface-type"] === "demo") {
      const prev = getDemoState(unit.code) ?? {
        values: {},
        displayValues: {},
        variables: unit.variables,
      };

      const nextValues = { ...prev.values } as Record<string, number | string | boolean | null>;
      const nextDisplay = { ...prev.displayValues } as Record<
        string,
        string | number | boolean | null
      >;

      for (const [key, value] of Object.entries(data)) {
        nextValues[key] = value;
        nextDisplay[key] = value as string | number | boolean | null;
      }

      setDemoState(unit.code, {
        values: nextValues,
        displayValues: nextDisplay,
        variables: unit.variables,
      });
      return;
    }

    if (!settings.host) {
      const err = new HruNotConfiguredError("HRU host not configured");
      this.logger.warn({ err }, "HRU write attempt while host not configured");
      throw err;
    }

    try {
      const config = {
        host: settings.host,
        port: Number(settings.port) || 502,
        unitId: Number(settings.unitId) || 1,
      };

      const scriptVars: Record<string, number> = {};

      this.logger.info(
        { data, unitVariables: unit.variables.map((v) => v.name) },
        "HRU writeValues: input data and unit variables",
      );

      for (const [key, value] of Object.entries(data)) {
        const variable = unit.variables.find((v) => v.name === key);
        if (!variable) {
          this.logger.warn(
            { key, availableVariables: unit.variables.map((v) => v.name) },
            "HRU writeValues: key not found in unit variables",
          );
          continue;
        }

        if (typeof value === "boolean") {
          scriptVars[`$${key}`] = value ? 1 : 0;
        } else if (typeof value === "string") {
          if (variable.type === "select" && variable.options) {
            const optionMap = Object.fromEntries(
              variable.options.map((o) => [
                o.value,
                typeof o.label === "string" ? o.label : o.label.text,
              ]),
            );
            scriptVars[`$${key}`] = resolveModeValue(optionMap, value);
          } else {
            const num = parseFloat(value);
            if (!isNaN(num)) scriptVars[`$${key}`] = num;
          }
        } else {
          scriptVars[`$${key}`] = value;
        }
      }

      this.logger.info({ scriptVars }, "HRU writeValues: computed script variables");

      if (Object.keys(scriptVars).length > 0) {
        // Log resolved Modbus targets for easier debugging
        function resolveVal(v: unknown) {
          if (typeof v === "string" && v.startsWith("$")) {
            return scriptVars[v];
          }
          return v;
        }

        const writeTargets = unit.integration.write
          .filter((step) => step.type === "action")
          .map(
            (step) => step as { type: "action"; expression: { function: string; args: unknown[] } },
          )
          .filter(
            (step) =>
              step.expression.function === "modbus_write_holding" ||
              step.expression.function === "modbus_write_holding_multi" ||
              step.expression.function === "modbus_write_coil",
          )
          .map((step) => {
            const [addrRaw, ...rest] = step.expression.args;
            return {
              fn: step.expression.function,
              address: resolveVal(addrRaw),
              args: rest.map(resolveVal),
            };
          });

        this.logger.info({ writeTargets }, "HRU writeValues: planned Modbus writes");

        await this.repository.executeScript(config, unit.integration.write, scriptVars);
      } else {
        this.logger.warn("HRU writeValues: no script variables computed, skipping write script");
      }

      this.logger.info({ data }, "HRU values written successfully");
    } catch (err) {
      this.logger.error({ err }, "Failed to write HRU values");
      throw new HruConnectionError("Failed to write HRU values", err);
    }
  }

  async executeKeepAlive(): Promise<number | null> {
    const configData = this.getResolvedConfiguration();
    if (!configData) return null;

    const { settings, unit } = configData;

    if (unit["interface-type"] === "demo") return null;

    if (!unit.integration.keepAlive) return null;

    const keepAlive = unit.integration.keepAlive!;

    try {
      if (!settings.host) return null;

      const config = {
        host: settings.host,
        port: Number(settings.port) || 502,
        unitId: Number(settings.unitId) || 1,
      };

      await this.repository.executeScript(config, keepAlive.commands);
      this.logger.debug("HRU KeepAlive executed successfully");
      return keepAlive.period;
    } catch (err) {
      this.logger.warn({ err }, "Failed to execute HRU KeepAlive");
      return keepAlive.period;
    }
  }

  public getResolvedConfiguration(settingsOverride?: HruSettings) {
    const raw = settingsOverride || this.settingsRepo.getHruSettings();
    if (!raw?.unit) return null;
    const unit = this.getUnitById(raw.unit);
    if (!unit) return null;

    return { settings: raw, unit };
  }
}
