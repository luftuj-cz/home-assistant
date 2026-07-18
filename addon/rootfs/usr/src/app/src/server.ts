// noinspection HttpUrlsUsage

import "dotenv/config";

import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";

import { createLogger } from "./logger.js";
import { getConfig, loadConfig } from "./config/options.js";
import { HomeAssistantClient } from "./services/homeAssistantClient.js";
import type { ValveController } from "./core/valveManager.js";
import { ValveManager } from "./core/valveManager.js";
import { OfflineValveManager } from "./core/offlineValveManager.js";
import { TimelineScheduler } from "./services/timelineScheduler.js";
import { setupDatabase } from "./services/database.js";
import { MqttService } from "./services/mqttService.js";
import { HruMonitor } from "./services/hruMonitor.js";

import { createRequestLogger } from "./middleware/requestLogger.js";
import { createUserContextLogger } from "./middleware/userContext.js";
import { createIngressPathMiddleware } from "./middleware/ingressPath.js";
import { createErrorHandler } from "./middleware/errorHandler.js";

import { createHruRouter } from "./features/hru/hru.routes.js";
import { HruRepository } from "./features/hru/hru.repository.js";
import { SettingsRepository } from "./features/settings/settings.repository.js";
import { HruService } from "./features/hru/hru.service.js";
import { HruController } from "./features/hru/hru.controller.js";

import { createTimelineRouter } from "./routes/timeline.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createDatabaseRouter } from "./routes/database.js";
import { createValvesRouter } from "./routes/valves.js";
import { createValveGroupsRouter } from "./routes/valveGroups.js";
import { createStatusRouter } from "./routes/status.js";
import { createCommissioningRouter } from "./routes/commissioning.js";
import { CommissioningRunner } from "./services/commissioningRunner.js";
import {
  closeAllSharedClients,
  type ModbusConnectionStatus,
  onAnyModbusStatusChange,
} from "./shared/modbus/client.js";

loadConfig();
const config = getConfig();
const logger = createLogger(config.logLevel);
logger.info("LUFTaTOR configuration loaded");

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());
app.use(
  express.raw({
    type: ["application/octet-stream", "application/x-sqlite3", "binary/octet-stream"],
    limit: "200mb",
  }),
);

// Middleware
// IMPORTANT: Strip ingress path BEFORE any other middleware or routing
app.use(createIngressPathMiddleware(logger));
app.use(createRequestLogger(logger));
app.use(createUserContextLogger(logger));

// Services Setup
const clients = new Set<WebSocket>();

async function broadcast(message: unknown): Promise<void> {
  const data = JSON.stringify(message);
  for (const client of Array.from(clients)) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    } else {
      clients.delete(client);
    }
  }
}

let valveManager: ValveController;
let haClient: HomeAssistantClient | null = null;

if (config.token) {
  haClient = new HomeAssistantClient(config.baseUrl, config.token, logger);
  valveManager = new ValveManager(haClient, logger, broadcast);
  haClient.addStatusListener(() => {
    broadcastSystemStatus();
  });
} else {
  valveManager = new OfflineValveManager(logger, broadcast);
}

// Core Dependencies
const settingsRepo = new SettingsRepository(logger);
const hruRepo = new HruRepository(logger);
const hruService = new HruService(hruRepo, settingsRepo, logger);
const appStartedAt = new Date();

const timelineScheduler = new TimelineScheduler(valveManager, hruService, settingsRepo, logger);

const mqttService = new MqttService(config.mqtt, settingsRepo, timelineScheduler, logger);
const hruMonitor = new HruMonitor(hruService, mqttService, timelineScheduler, logger);
const commissioningRunner = new CommissioningRunner(settingsRepo, timelineScheduler, logger);

let lastModbusStatus: ModbusConnectionStatus | null = null;

onAnyModbusStatusChange((_key, status) => {
  lastModbusStatus = status;
  broadcastSystemStatus();
});

function broadcastSystemStatus() {
  const haStatus = haClient ? haClient.getConnectionState() : "offline";
  const mqttStatus = mqttService.isConnected() ? "connected" : "disconnected";
  void broadcast({
    type: "status",
    payload: {
      ha: { connection: haStatus },
      mqtt: { connection: mqttStatus },
      modbus: lastModbusStatus,
    },
  });
}

const hruController = new HruController(hruService, logger);

// Routes
app.use("/api/hru", createHruRouter(hruController));
app.use("/api/commissioning", createCommissioningRouter(commissioningRunner, hruService, logger));
app.use("/api/timeline", createTimelineRouter(logger, timelineScheduler, hruService, mqttService));
app.use("/api/settings", createSettingsRouter(hruService, mqttService, haClient, logger));
app.use(
  "/api/database",
  createDatabaseRouter(valveManager, mqttService, timelineScheduler, hruMonitor, logger),
);
app.use("/api/valves", createValvesRouter(valveManager, logger));
app.use("/api/valve-groups", createValveGroupsRouter(valveManager, logger));
app.use(
  "/api",
  createStatusRouter(
    valveManager,
    haClient,
    mqttService,
    logger,
    timelineScheduler,
    config.baseUrl,
    appStartedAt,
  ),
);

const staticRoot = config.staticRoot;
const assetsPath = path.join(staticRoot, "assets");
const indexPath = path.join(staticRoot, "index.html");

if (fs.existsSync(staticRoot)) {
  if (fs.existsSync(assetsPath)) {
    app.use("/assets", express.static(assetsPath, { fallthrough: true }));
  }

  // Serve root-level static files (favicons, apple-touch-icon, etc.) directly.
  // index:false so "/" is handled by the explicit index.html route below.
  app.use(express.static(staticRoot, { index: false, fallthrough: true }));

  // The frontend uses hash-based routing, so it only ever loads the app at the
  // mount root ("/", after ingress-path stripping). Any other pathname is not a
  // real entry point: serving index.html there would boot the SPA at the wrong
  // base URL (breaking every API call). Serve index.html for "/" only; all other
  // unmatched pathnames fall through to a 404. This keeps Home Assistant Ingress
  // working (its stripped path is always "/") while rejecting junk pathnames.
  app.get("/", (_request, response, next) => {
    if (!fs.existsSync(indexPath)) {
      next();
      return;
    }
    response.sendFile(indexPath);
  });
}

app.use(createErrorHandler(logger));

const httpServer = createServer(app);

const wss = new WebSocketServer({
  noServer: true,
});

httpServer.on("upgrade", (request, socket, head) => {
  let pathname: string;
  try {
    pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;
  } catch (error) {
    // Malformed Host header makes new URL() throw; reject instead of crashing.
    logger.warn(
      { error, host: request.headers.host },
      "Rejected WebSocket upgrade with invalid URL",
    );
    socket.destroy();
    return;
  }
  const ingressPath = request.headers["x-ingress-path"] as string | undefined;

  let normalizedPath = pathname;
  if (ingressPath && normalizedPath.startsWith(ingressPath)) {
    normalizedPath = normalizedPath.slice(ingressPath.length) || "/";
  }

  if (normalizedPath === "/ws/valves") {
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", async (socket) => {
  clients.add(socket);
  logger.info({ clientCount: clients.size }, "WebSocket client connected");

  socket.on("close", () => {
    clients.delete(socket);
    logger.info({ clientCount: clients.size }, "WebSocket client disconnected");
  });

  socket.on("error", (error) => {
    logger.warn({ error }, "WebSocket client error");
  });

  try {
    const snapshot = await valveManager.getSnapshot();
    socket.send(
      JSON.stringify({
        type: "snapshot",
        payload: snapshot,
      }),
    );
  } catch (error) {
    logger.error({ error }, "Failed to send initial snapshot to websocket client");
  }

  // Send initial status
  try {
    const haStatus = haClient ? haClient.getConnectionState() : "offline";
    const mqttStatus = mqttService.isConnected() ? "connected" : "disconnected";
    socket.send(
      JSON.stringify({
        type: "status",
        payload: {
          ha: { connection: haStatus },
          mqtt: { connection: mqttStatus },
          modbus: lastModbusStatus,
        },
      }),
    );
  } catch (error) {
    logger.error({ error }, "Failed to send initial status to websocket client");
  }
});

const port = config.webPort;
const host = "0.0.0.0";

async function start() {
  try {
    logger.info("Initializing database...");
    setupDatabase(logger);
    logger.info("Database initialized successfully");
  } catch (err) {
    logger.fatal({ err }, "Failed to initialize database");
    throw err;
  }

  try {
    logger.info("Starting Valve Manager...");
    await valveManager.start();
    logger.info("Valve Manager started successfully");
  } catch (err) {
    logger.fatal({ err }, "Failed to start Valve Manager");
    throw err;
  }

  try {
    logger.info("Starting MQTT Service...");
    await mqttService.connect();
    hruMonitor.start();
    logger.info("MQTT Service and HRU Monitor started successfully");

    mqttService.on("connect", () => {
      logger.debug("MQTT Service connected, broadcasting status");
      broadcastSystemStatus();
    });

    mqttService.on("disconnect", () => {
      logger.debug("MQTT Service disconnected, broadcasting status");
      broadcastSystemStatus();
    });
  } catch (err) {
    logger.error({ err }, "Failed to start MQTT Service or HRU Monitor");
    // Continue even if MQTT fails
  }

  try {
    logger.info("Starting Timeline Scheduler...");
    timelineScheduler.start();
    logger.info("Timeline Scheduler started successfully");
  } catch (err) {
    logger.fatal({ err }, "Failed to start Timeline Scheduler");
    throw err;
  }

  httpServer.on("error", (error) => {
    logger.fatal({ error }, "Failed to start HTTP server");
    process.exit(1);
  });

  httpServer.listen(port, host, () => {
    logger.info({ port }, "LUFTaTOR backend listening");
  });
}

let isShuttingDown = false;

async function shutdown(signal: string, exitCodeOverride?: number) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Shutting down LUFTaTOR backend");

  function resolveExitCode() {
    if (exitCodeOverride !== undefined) return exitCodeOverride;
    return (globalThis as any).isRestarting ? 1 : 0;
  }

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error({ signal }, "Shutdown timed out, forcing exit");
    process.exit(resolveExitCode());
  }, 3000);
  // Do NOT unref this timeout - it must fire to force exit if shutdown hangs

  hruMonitor.stop();
  timelineScheduler.stop();

  // Terminate all WebSocket connections
  logger.debug({ clientCount: clients.size }, "Terminating all WebSocket clients");
  for (const client of clients) {
    try {
      client.terminate();
    } catch {
      // Ignore
    }
  }
  clients.clear();

  // Close WebSocket server with timeout
  try {
    await Promise.race([
      new Promise<void>((resolve) => wss.close(() => resolve())),
      new Promise((_, reject) => setTimeout(() => reject(new Error("wss.close timeout")), 1000)),
    ]);
  } catch (err) {
    logger.warn({ err }, "WebSocket server close timed out or failed");
  }

  try {
    await mqttService.disconnect();
    await valveManager.stop();
    await closeAllSharedClients();
    logger.info("All services stopped successfully");
  } catch (err) {
    logger.warn({ err }, "Error while stopping services during shutdown");
  }

  // Close all HTTP/WebSocket connections to ensure the server can stop promptly
  if (typeof httpServer.closeAllConnections === "function") {
    httpServer.closeAllConnections();
  }

  // Attempt to close HTTP server gracefully but don't hang on it
  httpServer.close();

  // Final definitive exit after a short delay for logs to flush
  setTimeout(() => {
    const code = resolveExitCode();
    logger.info({ signal, code }, "Exiting process now");
    // Non-zero exit ensures Supervisor/Docker restarts the container
    process.exit(code);
  }, 500);
}

// Process state is undefined after an uncaught exception, so exit and let the
// Supervisor restart the container clean rather than resume.
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception, shutting down");
  void shutdown("uncaughtException", 1);
});

// Log only; a stray rejection isn't proof the process is corrupted.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("SIGINT", (signal) => {
  void shutdown(signal.toString());
});

process.on("SIGTERM", (signal) => {
  void shutdown(signal.toString());
});

try {
  await start();
} catch (error) {
  logger.fatal({ error }, "Failed to start backend");
  process.exit(1);
}
