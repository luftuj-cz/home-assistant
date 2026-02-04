import * as fs from "fs";
import * as path from "path";
import type { Logger } from "pino";
import type { HeatRecoveryUnit, RegulationStrategy } from "./hru.definitions";

export class HruLoader {
  private readonly strategiesPath: string;
  private readonly unitsPath: string;

  constructor(private readonly logger: Logger) {
    this.strategiesPath = path.join(__dirname, "definitions/strategies");
    this.unitsPath = path.join(__dirname, "definitions/units");
  }

  loadStrategies(): RegulationStrategy[] {
    if (!fs.existsSync(this.strategiesPath)) {
      this.logger.warn(`Strategies directory not found: ${this.strategiesPath}`);
      return [];
    }

    const files = fs.readdirSync(this.strategiesPath).filter((file) => file.endsWith(".json"));
    const strategies: RegulationStrategy[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(this.strategiesPath, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const strategy = JSON.parse(content) as RegulationStrategy;
        strategies.push(strategy);
      } catch (error) {
        this.logger.error({ error, file }, "Failed to load strategy from file");
      }
    }

    return strategies;
  }

  loadUnits(): HeatRecoveryUnit[] {
    if (!fs.existsSync(this.unitsPath)) {
      this.logger.warn(`Units directory not found: ${this.unitsPath}`);
      return [];
    }

    const files = fs.readdirSync(this.unitsPath).filter((file) => file.endsWith(".json"));
    const units: HeatRecoveryUnit[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(this.unitsPath, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const unit = JSON.parse(content) as HeatRecoveryUnit;
        units.push(unit);
      } catch (error) {
        this.logger.error({ error, file }, "Failed to load unit from file");
      }
    }

    return units;
  }
}
