import "dotenv/config";

import cors from "cors";
import express from "express";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import WebSocket, { WebSocketServer } from "ws";

import { createLogger } from "./logger";
import { loadConfig, getConfig } from "./config/options";
import { HomeAssistantClient } from "./services/homeAssistantClient";
import type { ValveController } from "./core/valveManager";
import { ValveManager } from "./core/valveManager";
import { OfflineValveManager } from "./core/offlineValveManager";
import { TimelineRunner } from "./services/timelineRunner";
import { setupDatabase } from "./services/database";
import { MqttService } from "./services/mqttService";
import { HruMonitor } from "./services/hruMonitor";

import { createRequestLogger } from "./middleware/requestLogger";
import { createErrorHandler } from "./middleware/errorHandler";

import { createHruRouter } from "./routes/hru";
import { createTimelineRouter } from "./routes/timeline";
import { createSettingsRouter } from "./routes/settings";
import { createDatabaseRouter } from "./routes/database";
import { createValvesRouter } from "./routes/valves";
import { createStatusRouter } from "./routes/status";

loadConfig();
const config = getConfig();
const logger = createLogger(config.logLevel);

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
app.use(express.raw({ type: "application/octet-stream", limit: "200mb" }));

// Middleware
app.use(createRequestLogger(logger));

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

const timelineRunner = new TimelineRunner(valveManager, logger);

const mqttService = new MqttService(config.mqtt, logger);
const hruMonitor = new HruMonitor(mqttService, logger);

// Routes
app.use("/api/hru", createHruRouter(logger));
app.use("/api/timeline", createTimelineRouter(logger));
app.use("/api/settings", createSettingsRouter(mqttService, logger));
app.use("/api/database", createDatabaseRouter(valveManager, logger));
app.use("/api/valves", createValvesRouter(valveManager, logger));
app.use("/api", createStatusRouter(haClient, mqttService, logger));

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
  server: httpServer,
  path: "/ws/valves",
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
    socket.send(
      JSON.stringify({
        type: "status",
        payload: { ha: { connection: status } },
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
  } catch (err) {
    logger.fatal({ err }, "Failed to initialize database");
    throw err;
  }

  try {
    logger.info("Starting Valve Manager...");
    await valveManager.start();
  } catch (err) {
    logger.fatal({ err }, "Failed to start Valve Manager");
    throw err;
  }

  try {
    logger.info("Starting MQTT Service...");
    await mqttService.connect();
    hruMonitor.start();
  } catch (err) {
    logger.error({ err }, "Failed to start MQTT Service or HRU Monitor");
    // Continue even if MQTT fails
  }

  try {
    logger.info("Starting Timeline Runner...");
    timelineRunner.start();
  } catch (err) {
    logger.fatal({ err }, "Failed to start Timeline Runner");
    throw err;
  }

  httpServer.on("error", (error) => {
    logger.fatal({ error }, "Failed to start HTTP server");
    process.exit(1);
  });

  httpServer.listen(port, host, () => {
    logger.info({ port }, "Luftujha backend listening");
  });
}

let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Shutting down Luftujha backend");

  hruMonitor.stop();
  timelineRunner.stop();
  wss.close();

  await mqttService.disconnect();
  await valveManager.stop();

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
