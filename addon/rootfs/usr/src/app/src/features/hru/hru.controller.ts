import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import type { HruService } from "./hru.service.js";
import type { HruWriteInput } from "../../schemas/hru.js";
import { HruNotConfiguredError } from "../../shared/errors/apiErrors.js";

export class HruController {
  constructor(
    private readonly service: HruService,
    private readonly logger: Logger,
  ) {}

  getUnits = (_req: Request, res: Response): void => {
    const units = this.service.getAllUnits();
    res.json(units);
    this.logger.info({ count: units.length }, "HRU units retrieved successfully");
  };

  getModes = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const unitId = req.query.unitId as string | undefined;
      const modes = this.service.getModes(unitId);
      res.json({ modes });
      this.logger.info({ unitId, count: modes.length }, "HRU modes retrieved successfully");
    } catch (error) {
      this.logger.error({ error }, "Failed to get HRU modes");
      next(error);
    }
  };

  read = (_req: Request, res: Response): void => {
    if (!this.service.getResolvedConfiguration()) {
      throw new HruNotConfiguredError();
    }
    const cached = this.service.getCachedRead();
    const emptyResult = { values: null, displayValues: null, variables: null };
    res.json({
      ...(cached?.result ?? emptyResult),
      fetchedAt: cached?.fetchedAt ?? null,
      isRefreshing: this.service.isRefreshing(),
    });
    this.logger.info({ hasCache: cached !== null }, "HRU cached values served");
  };

  test = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = req.body;
      const result = await this.service.readValues(settings);
      res.json(result);
      this.logger.info("HRU connection test successful");
    } catch (error) {
      this.logger.error({ error }, "Failed to test HRU connection");
      next(error);
    }
  };

  write = async (
    req: Request<Record<string, unknown>, Record<string, unknown>, HruWriteInput>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await this.service.writeValues(req.body);
      res.status(204).end();
      this.logger.info(req.body, "HRU values written successfully");
    } catch (error) {
      this.logger.error({ error, body: req.body }, "Failed to write HRU values");
      next(error);
    }
  };
}
