import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Logger } from "pino";
import type { HeatRecoveryUnit } from "./hru.definitions";

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
        units.push(unit);
      } catch (error) {
        this.logger.error({ error, file }, "Failed to load unit from file");
      }
    }

    this.logger.info({ count: units.length }, "Loaded heat recovery units");
    return units;
  }
}
