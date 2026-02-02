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

  getModes = (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const modes = this.service.getModes();
      res.json({ modes });
    } catch (error) {
      next(error);
    }
  };

  read = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.readValues();
      res.json(result);
    } catch (error) {
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
      throw new ApiError(400, "No fields to write");
    }

    try {
      await this.service.writeValues({ power, temperature, mode });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  };
}
