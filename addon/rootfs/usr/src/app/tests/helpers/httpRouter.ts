import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Router } from "express";
import { vi } from "vitest";

export interface HttpResult {
  status: number;
  body: Record<string, unknown> | null;
}

export interface ServedRouter {
  call(method: string, url: string, body?: unknown): Promise<HttpResult>;
  close(): Promise<void>;
}

export function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
}

/**
 * Serves routers on an ephemeral local port with the app's own error handler,
 * so a test sees exactly the status and body a client would. Imported lazily:
 * after `setupTempDatabase` has reset the module registry, the routers and the
 * error handler must come from the same module graph as the database.
 */
export async function serveRouters(
  routers: Record<string, Router>,
  logger = silentLogger(),
): Promise<ServedRouter> {
  const { default: express } = await import("express");
  const { createErrorHandler } = await import("../../src/middleware/errorHandler.js");

  const app = express();
  app.use(express.json());
  for (const [path, router] of Object.entries(routers)) {
    app.use(path, router);
  }
  app.use(createErrorHandler(logger as never));

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return {
    async call(method, url, body) {
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const response = await fetch(`http://127.0.0.1:${port}${url}`, init);
      const text = await response.text();
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      };
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
