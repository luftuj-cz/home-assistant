import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";

export function createUserContextLogger(logger: Logger) {
  return function userContextLogger(req: Request, res: Response, next: NextFunction) {
    const userId = req.headers["x-remote-user-id"] as string | undefined;
    const userName = req.headers["x-remote-user-name"] as string | undefined;
    const userDisplayName = req.headers["x-remote-user-display-name"] as string | undefined;

    if (userId || userName) {
      logger.info(
        {
          userId,
          userName,
          userDisplayName,
          path: req.path,
          method: req.method,
        },
        "Ingress request authenticated user",
      );
    }

    next();
  };
}
