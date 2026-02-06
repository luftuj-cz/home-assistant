import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import type { HruService } from "./hru.service";
import { ApiError } from "../../shared/errors/apiErrors";

export class HruController {
  constructor(
    private readonly service: HruService,
    private readonly logger: Logger,
  ) {}

  getUnits = (_req: Request, res: Response): void => {
    const units = this.service.getAllUnits();
    res.json(units);
  };

  getModes = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const unitId = req.query.unitId as string | undefined;
      const modes = this.service.getModes(unitId);
      res.json({ modes });
    } catch (error) {
      this.logger.error({ error }, "Failed to get HRU modes");
      next(error);
    }
  };

  read = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.readValues();
      res.json(result);
    } catch (error) {
      this.logger.error({ error }, "Failed to read HRU values");
      next(error);
    }
  };

  write = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { power, temperature, mode } = req.body as {
      power?: number;
      temperature?: number;
      mode?: number | string;
    };

    if (power === undefined && temperature === undefined && mode === undefined) {
      this.logger.warn("HRU write attempt with no fields");
      throw new ApiError(400, "No fields to write");
    }

    try {
      await this.service.writeValues({ power, temperature, mode });
      res.status(204).end();
    } catch (error) {
      this.logger.error({ error, body: req.body }, "Failed to write HRU values");
      next(error);
    }
  };
}
