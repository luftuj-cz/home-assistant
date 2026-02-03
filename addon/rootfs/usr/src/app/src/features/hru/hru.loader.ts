import * as fs from "fs";
import * as path from "path";
import type { HeatRecoveryUnit, RegulationStrategy } from "./hru.definitions";

export class HruLoader {
  private readonly strategiesPath: string;
  private readonly unitsPath: string;

  constructor() {
    this.strategiesPath = path.join(__dirname, "definitions/strategies");
    this.unitsPath = path.join(__dirname, "definitions/units");
  }

  loadStrategies(): RegulationStrategy[] {
    if (!fs.existsSync(this.strategiesPath)) {
      console.warn(`Strategies directory not found: ${this.strategiesPath}`);
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
        console.error(`Failed to load strategy from ${file}:`, error);
      }
    }

    return strategies;
  }

  loadUnits(): HeatRecoveryUnit[] {
    if (!fs.existsSync(this.unitsPath)) {
      console.warn(`Units directory not found: ${this.unitsPath}`);
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
        console.error(`Failed to load unit from ${file}:`, error);
      }
    }

    return units;
  }
}
