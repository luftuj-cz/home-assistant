import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";

/**
 * Middleware to strip the Ingress path prefix from incoming requests.
 *
 * When running under Home Assistant Ingress, requests come in with a path like:
 * /api/hassio_ingress/TOKEN/api/settings/theme
 *
 * But our routes are registered at /api/settings/theme
 *
 * Home Assistant provides the full ingress path via X-Ingress-Path header.
 * We use this to strip the prefix from req.url so Express routing works correctly.
 */
export function createIngressPathMiddleware(logger: Logger) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ingressPath = req.headers["x-ingress-path"] as string | undefined;

    if (ingressPath && req.url.startsWith(ingressPath)) {
      const originalUrl = req.url;
      req.url = req.url.slice(ingressPath.length) || "/";
      logger.debug({ originalUrl, newUrl: req.url, ingressPath }, "Stripped ingress path prefix");
    }

    next();
  };
}
