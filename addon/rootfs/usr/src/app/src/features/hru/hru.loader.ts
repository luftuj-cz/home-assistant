import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import {
  ALLOWED_FUNCTIONS,
  type CommandExpression,
  type CommandScript,
  type CommandValue,
  type HeatRecoveryUnit,
} from "./hru.definitions.js";

export class HruLoader {
  private readonly unitsPath: string;

  constructor(private readonly logger: Logger) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    this.unitsPath = join(__dirname, "definitions/units");
  }

  loadUnits(): HeatRecoveryUnit[] {
    if (!existsSync(this.unitsPath)) {
      this.logger.warn(`Units directory not found: ${this.unitsPath}`);
      return [];
    }

    const files = readdirSync(this.unitsPath).filter((file) => file.endsWith(".json"));
    const units: HeatRecoveryUnit[] = [];

    for (const file of files) {
      try {
        const filePath = join(this.unitsPath, file);
        const content = readFileSync(filePath, "utf-8");
        const unit = JSON.parse(content) as HeatRecoveryUnit;
        this.validateUnit(unit, file);
        units.push(unit);
      } catch (error) {
        this.logger.error({ error, file }, "Failed to load unit from file");
      }
    }

    this.logger.info({ count: units.length }, "Loaded heat recovery units");
    return units;
  }

  private validateUnit(unit: HeatRecoveryUnit, file: string): void {
    const editableNames = new Set<string>();

    for (const variable of unit.variables) {
      if (!variable.editable) continue;

      if (editableNames.has(variable.name)) {
        throw new Error(`Duplicate editable variable "${variable.name}" in ${file}`);
      }
      editableNames.add(variable.name);

      if (variable.type === "select" && (!variable.options || variable.options.length === 0)) {
        throw new Error(`Editable select variable "${variable.name}" has no options in ${file}`);
      }
    }

    if (unit["interface-type"] === "demo") {
      return;
    }

    this.validateScript(unit.integration.read, file, "read");
    this.validateScript(unit.integration.write, file, "write");

    if (unit.integration.keepAlive) {
      this.validateScript(unit.integration.keepAlive.commands, file, "keepAlive");
    }
  }

  private validateScript(script: CommandScript, file: string, section: string): void {
    for (const step of script) {
      if (step.type === "assignment") {
        this.validateCommandValue(step.value, file, section);
      } else {
        this.validateExpression(step.expression, file, section);
      }
    }
  }

  private validateCommandValue(value: CommandValue, file: string, section: string): void {
    if (typeof value === "number" || typeof value === "string") {
      return;
    }

    this.validateExpression(value, file, section);
  }

  private validateExpression(expression: CommandExpression, file: string, section: string): void {
    if (!ALLOWED_FUNCTIONS.includes(expression.function)) {
      throw new Error(
        `Unsupported HRU function "${expression.function}" in ${file} (${section})`,
      );
    }

    for (const arg of expression.args) {
      this.validateCommandValue(arg, file, section);
    }
  }
}
