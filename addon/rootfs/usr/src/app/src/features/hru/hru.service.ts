import type { HruSettings } from "../../types/index.js";
import type { HruRepository } from "./hru.repository.js";
import type { SettingsRepository } from "../settings/settings.repository.js";
import type { Logger } from "pino";
import { HruLoader } from "./hru.loader.js";
import { type HeatRecoveryUnit, type HruVariable } from "./hru.definitions.js";
import { BadRequestError, HruConnectionError, HruNotConfiguredError } from "../../shared/errors/apiErrors.js";
import { resolveModeValue } from "../../utils/hruWrite.js";
import { getDemoState, setDemoState } from "../../services/demoState.js";

export type DisplayValue = string | number | boolean;
export type NullableDisplayValue = DisplayValue | null;

export interface HruUnitDefinition {
  id: string;
  code: string;
  name: string;
  variables: HruVariable[];
}

export interface HruReadResult {
  values: Record<string, number>;
  displayValues: Record<string, DisplayValue>;
  variables: HruVariable[];
}

export class HruService {
  private readonly units: HeatRecoveryUnit[];
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
    if (!modeVar?.options) return [];

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

  async writeValues(data: Record<string, DisplayValue>): Promise<void> {
    const configData = this.getResolvedConfiguration();
    if (!configData) {
      const err = new HruNotConfiguredError();
      this.logger.warn({ err }, "HRU write attempt while not configured");
      throw err;
    }
    const { settings, unit } = configData;
    const scriptVars = this.buildScriptVariables(unit, settings, data);

    // Demo: store in memory and return, ignore Modbus
    if (unit["interface-type"] === "demo") {
      const prev = getDemoState(unit.code) ?? {
        values: {},
        displayValues: {},
        variables: unit.variables,
      };

      const nextValues = { ...prev.values } as Record<string, NullableDisplayValue>;
      const nextDisplay = { ...prev.displayValues } as Record<string, NullableDisplayValue>;

      for (const [scriptVariable, value] of Object.entries(scriptVars)) {
        const key = scriptVariable.slice(1);
        const variable = unit.variables.find((candidate) => candidate.name === key);
        if (!variable) continue;
        nextValues[key] = value;
        nextDisplay[key] = this.toDisplayValue(variable, value);
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

    const config = {
      host: settings.host,
      port: Number(settings.port) || 502,
      unitId: Number(settings.unitId) || 1,
    };

    this.logger.info(
      { data, unitVariables: unit.variables.map((v) => v.name) },
      "HRU writeValues: input data and unit variables",
    );

    this.logger.info({ scriptVars }, "HRU writeValues: computed script variables");

    try {
      this.logPlannedWrites(unit, scriptVars);
      await this.repository.executeScript(config, unit.integration.write, scriptVars);

      this.logger.info({ data }, "HRU values written successfully");
    } catch (err) {
      this.logger.error({ err }, "Failed to write HRU values");
      throw new HruConnectionError("Failed to write HRU values", err);
    }
  }

  validateWriteValues(data: Record<string, DisplayValue>, unitIdOverride?: string): void {
    const { settings, unit } = this.getValidationContext(unitIdOverride);
    this.buildScriptVariables(unit, settings, data);
  }

  async executeKeepAlive(): Promise<number | null> {
    const configData = this.getResolvedConfiguration();
    if (!configData) return null;

    const { settings, unit } = configData;

    if (unit["interface-type"] === "demo") return null;

    if (!unit.integration.keepAlive) return null;

    const keepAlive = unit.integration.keepAlive;

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

  private getValidationContext(unitIdOverride?: string): {
    settings: HruSettings;
    unit: HeatRecoveryUnit;
  } {
    const storedSettings = this.settingsRepo.getHruSettings();
    let unit: HeatRecoveryUnit | null;
    if (unitIdOverride) {
      unit = this.getUnitById(unitIdOverride);
    } else {
      unit = this.getResolvedConfiguration()?.unit ?? null;
      if (!unit && storedSettings?.unit) {
        unit = this.getUnitById(storedSettings.unit);
      }
    }

    if (!unit) {
      throw new HruNotConfiguredError();
    }

    const settings = storedSettings?.unit === unit.code
      ? storedSettings
      : {
        unit: unit.code,
        host: "",
        port: 502,
        unitId: 1,
      };

    return { settings, unit };
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
          displayValues: cached.displayValues as Record<string, DisplayValue>,
          variables: cached.variables,
        };
      }

      const values: Record<string, number> = {};
      const displayValues: Record<string, DisplayValue> = {};
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
      const displayValues: Record<string, DisplayValue> = {};

      for (const variable of unit.variables) {
        const key = `$${variable.name}`;
        const val = rawValues[key] ?? 0;
        values[variable.name] = val;

        displayValues[variable.name] = this.toDisplayValue(variable, val);
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

  private normaliseWriteValue(
    variable: HruVariable,
    value: DisplayValue,
    settings: HruSettings,
  ): number {
    if (variable.type === "boolean") {
      return this.normaliseBooleanValue(variable.name, value);
    }

    if (variable.type === "select") {
      if (typeof value !== "number" && typeof value !== "string") {
        throw new BadRequestError(
          `HRU variable "${variable.name}" expects a string or numeric option`,
          "HRU_INVALID_VARIABLE_VALUE",
        );
      }

      const resolved = this.normaliseSelectValue(variable, value);
      if (resolved === undefined) {
        throw new BadRequestError(
          `HRU variable "${variable.name}" received an unsupported option`,
          "HRU_INVALID_VARIABLE_VALUE",
        );
      }
      return resolved;
    }

    const numericValue = this.normaliseNumberValue(variable.name, value);

    if (variable.min !== undefined && numericValue < variable.min) {
      throw new BadRequestError(
        `HRU variable "${variable.name}" must be at least ${variable.min}`,
        "HRU_INVALID_VARIABLE_VALUE",
      );
    }

    const maxValue = this.getEffectiveMax(variable, settings);
    if (maxValue !== undefined && numericValue > maxValue) {
      throw new BadRequestError(
        `HRU variable "${variable.name}" must be at most ${maxValue}`,
        "HRU_INVALID_VARIABLE_VALUE",
      );
    }

    return numericValue;
  }

  private buildScriptVariables(
    unit: HeatRecoveryUnit,
    settings: HruSettings,
    data: Record<string, DisplayValue>,
  ): Record<string, number> {
    const editableVariables = new Map(
      unit.variables.filter((variable) => variable.editable).map((variable) => [variable.name, variable]),
    );
    const payloadKeys = Object.keys(data);

    if (payloadKeys.length === 0) {
      throw new BadRequestError("No HRU values provided", "HRU_EMPTY_WRITE");
    }

    const invalidKeys = payloadKeys.filter((key) => !editableVariables.has(key));
    if (invalidKeys.length > 0) {
      throw new BadRequestError(
        `Unknown or non-editable HRU variables: ${invalidKeys.join(", ")}`,
        "HRU_INVALID_VARIABLES",
      );
    }

    const scriptVars: Record<string, number> = {};
    for (const [key, value] of Object.entries(data)) {
      const variable = editableVariables.get(key);
      if (!variable) continue;
      scriptVars[`$${key}`] = this.normaliseWriteValue(variable, value, settings);
    }

    return scriptVars;
  }

  private normaliseBooleanValue(variableName: string, value: number | string | boolean): number {
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }

    if (typeof value === "number") {
      if (value === 0 || value === 1) {
        return value;
      }
      throw new BadRequestError(
        `HRU variable "${variableName}" expects a boolean-compatible value`,
        "HRU_INVALID_VARIABLE_VALUE",
      );
    }

    const normalised = value.trim().toLowerCase();
    if (normalised === "true" || normalised === "1") {
      return 1;
    }
    if (normalised === "false" || normalised === "0") {
      return 0;
    }

    throw new BadRequestError(
      `HRU variable "${variableName}" expects a boolean-compatible value`,
      "HRU_INVALID_VARIABLE_VALUE",
    );
  }

  private normaliseSelectValue(
    variable: HruVariable,
    value: number | string,
  ): number | undefined {
    const optionMap = Object.fromEntries(
      (variable.options ?? []).map((option) => [
        option.value,
        typeof option.label === "string" ? option.label : option.label.text,
      ]),
    );
    const resolved = resolveModeValue(optionMap, value);
    if (resolved === undefined) {
      return undefined;
    }

    return variable.options?.some((option) => option.value === resolved) ? resolved : undefined;
  }

  private normaliseNumberValue(variableName: string, value: number | string | boolean): number {
    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        return value;
      }
      throw new BadRequestError(
        `HRU variable "${variableName}" expects a finite numeric value`,
        "HRU_INVALID_VARIABLE_VALUE",
      );
    }

    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        return parsed;
      }
    }

    throw new BadRequestError(
      `HRU variable "${variableName}" expects a numeric value`,
      "HRU_INVALID_VARIABLE_VALUE",
    );
  }

  private getEffectiveMax(variable: HruVariable, settings: HruSettings): number | undefined {
    if (variable.maxConfigurable) {
      return settings.maxPower ?? variable.maxDefault ?? variable.max;
    }

    return variable.max;
  }

  private toDisplayValue(variable: HruVariable, value: number): DisplayValue {
    if (variable.type === "boolean") {
      return value !== 0;
    }

    if (variable.type === "select" && variable.options) {
      const option = variable.options.find((candidate) => candidate.value === value);
      if (!option) {
        return String(value);
      }
      return typeof option.label === "string" ? option.label : option.label.text;
    }

    return value;
  }

  private logPlannedWrites(unit: HeatRecoveryUnit, scriptVars: Record<string, number>): void {
    function resolveVal(v: unknown) {
      if (typeof v === "string" && v.startsWith("$")) {
        return scriptVars[v];
      }
      return v;
    }

    const writeTargets = unit.integration.write
      .filter((step) => step.type === "action")
      .map((step) => step as { type: "action"; expression: { function: string; args: unknown[] } })
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
  }
}
