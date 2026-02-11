import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createLogger } from "../logger";
import { getConfig } from "../config/options";

const config = getConfig();
const logger = createLogger(config.logLevel);

/**
 * Middleware factory to validate request body against a Zod schema
 */
export function validateRequest<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      logger.debug("Request body validated");
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.debug({ issues: error.issues }, "Request body validation failed");
        const errors = error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));

        res.status(400).json({
          detail: "Validation failed",
          errors,
        });
      } else {
        res.status(400).json({
          detail: "Invalid request data",
        });
      }
    }
  };
}

/**
 * Middleware to validate URL parameters against a Zod schema
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.params);
      req.params = validated as Record<string, string>;
      logger.debug("URL params validated");
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.debug({ issues: error.issues }, "URL params validation failed");
        const errors = error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));

        res.status(400).json({
          detail: "Invalid URL parameters",
          errors,
        });
      } else {
        res.status(400).json({
          detail: "Invalid URL parameters",
        });
      }
    }
  };
}

/**
 * Middleware to validate URL query parameters against a Zod schema
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.query);
      logger.debug("Query params validated");
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.debug({ issues: error.issues }, "Query params validation failed");

        const errors = error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));

        res.status(400).json({
          detail: "Invalid query parameters",
          errors,
        });
      } else {
        res.status(400).json({
          detail: "Invalid query parameters",
        });
      }
    }
  };
}
