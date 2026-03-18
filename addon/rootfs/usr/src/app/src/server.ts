// noinspection HttpUrlsUsage

import "dotenv/config";

import cors from "cors";
import express from "express";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import WebSocket, { WebSocketServer } from "ws";

import { createLogger } from "./logger.js";
import { loadConfig, getConfig } from "./config/options.js";
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
import { createStatusRouter } from "./routes/status.js";
import { closeAllSharedClients } from "./shared/modbus/client.js";

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
  haClient.addStatusListener((state) => {
    void broadcast({ type: "status", payload: { ha: { connection: state } } });
  });
} else {
  valveManager = new OfflineValveManager(logger, broadcast);
}

// Core Dependencies
const settingsRepo = new SettingsRepository(logger);
const hruRepo = new HruRepository(logger);
const hruService = new HruService(hruRepo, settingsRepo, logger);

const timelineScheduler = new TimelineScheduler(valveManager, hruService, settingsRepo, logger);

const mqttService = new MqttService(config.mqtt, settingsRepo, timelineScheduler, logger);
const hruMonitor = new HruMonitor(hruService, mqttService, timelineScheduler, logger);

const hruController = new HruController(hruService, logger);

// Routes
app.use("/api/hru", createHruRouter(hruController));
app.use("/api/timeline", createTimelineRouter(logger, timelineScheduler, hruService, mqttService));
app.use("/api/settings", createSettingsRouter(hruService, mqttService, haClient, logger));
app.use(
  "/api/database",
  createDatabaseRouter(valveManager, mqttService, timelineScheduler, logger),
);
app.use("/api/valves", createValvesRouter(valveManager, logger));
app.use(
  "/api",
  createStatusRouter(valveManager, haClient, mqttService, logger, timelineScheduler, config.baseUrl),
);

const staticRoot = config.staticRoot;
const assetsPath = path.join(staticRoot, "assets");
const indexPath = path.join(staticRoot, "index.html");

if (fs.existsSync(staticRoot)) {
  if (fs.existsSync(assetsPath)) {
    app.use("/assets", express.static(assetsPath, { fallthrough: true }));
  }

  app.get("/", (_request, response, next) => {
    if (!fs.existsSync(indexPath)) {
      next();
      return;
    }
    response.sendFile(indexPath);
  });

  app.get(/^(?!\/api\/|\/ws\/|\/assets\/).*/, (_request, response, next) => {
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
  const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;
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
    const status = haClient ? haClient.getConnectionState() : "offline";
    const mqttStatus = mqttService.isConnected() ? "connected" : "disconnected";
    socket.send(
      JSON.stringify({
        type: "status",
        payload: {
          ha: { connection: status },
          mqtt: { connection: mqttStatus },
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

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Shutting down LUFTaTOR backend");

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, 5000).unref(); // unref prevents this timer from keeping the loop process alive

  hruMonitor.stop();
  timelineScheduler.stop();
  wss.close();

  await mqttService.disconnect();
  await valveManager.stop();
  await closeAllSharedClients();
  logger.info("All services stopped successfully");

  // Broadcast status helper
  function broadcastStatus() {
    const haState = haClient ? haClient.getConnectionState() : "offline";
    const mqttState = mqttService.isConnected() ? "connected" : "disconnected";
    const msg = JSON.stringify({
      type: "status",
      payload: {
        ha: { connection: haState },
        mqtt: { connection: mqttState },
      },
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // Subscribe to status changes
  mqttService.on("connect", () => {
    logger.info("MQTT Service connected, broadcasting status");
    broadcastStatus();
  });

  mqttService.on("disconnect", () => {
    logger.info("MQTT Service disconnected, broadcasting status");
    broadcastStatus();
  });

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });

  process.exit(0);
}

process.on("SIGINT", (signal) => {
  void shutdown(signal.toString());
});

process.on("SIGTERM", (signal) => {
  void shutdown(signal.toString());
});

void start().catch((error) => {
  logger.fatal({ error }, "Failed to start backend");
  process.exit(1);
});
