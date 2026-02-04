import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

/**
 * Middleware factory to validate request body against a Zod schema
 */
export function validateRequest<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
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
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
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
      const validated = schema.parse(req.query);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req.query = validated as any;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
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
