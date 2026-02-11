import type { Logger } from "pino";
import WebSocket from "ws";

export interface HassState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
  context?: Record<string, unknown>;
}

export interface HassStateChangedEvent {
  entity_id: string;
  new_state: HassState | null;
  old_state: HassState | null;
}

export type HassEventHandler = (event: HassStateChangedEvent) => Promise<void> | void;

interface HassStateChangeData {
  entity_id?: string;
  new_state?: HassState | null;
  old_state?: HassState | null;
}

interface HassEventEnvelope {
  data?: HassStateChangeData;
}

type HassWebSocketAuthRequiredMessage = { type: "auth_required" };
type HassWebSocketAuthOkMessage = { type: "auth_ok" };
type HassWebSocketAuthInvalidMessage = { type: "auth_invalid" };
type HassWebSocketEventMessage = { type: "event"; event: HassEventEnvelope };
type KnownHassMessageType =
  | HassWebSocketAuthRequiredMessage["type"]
  | HassWebSocketAuthOkMessage["type"]
  | HassWebSocketAuthInvalidMessage["type"]
  | HassWebSocketEventMessage["type"];
type HassWebSocketUnknownMessage = {
  type: Exclude<string, KnownHassMessageType>;
  [key: string]: unknown;
};

type HassWebSocketMessage =
  | HassWebSocketAuthRequiredMessage
  | HassWebSocketAuthOkMessage
  | HassWebSocketAuthInvalidMessage
  | HassWebSocketEventMessage
  | HassWebSocketUnknownMessage;

function hasTypeProperty(value: unknown): value is { type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

function isHassWebSocketMessage(value: unknown): value is HassWebSocketMessage {
  return hasTypeProperty(value);
}

function isEventMessage(message: HassWebSocketMessage): message is HassWebSocketEventMessage {
  return message.type === "event" && typeof message === "object" && "event" in message;
}

const LUFTATOR_ENTITY_PREFIX = "number.luftator_";
const STATE_CHANGED_EVENT = "state_changed";
const RECONNECT_DELAY_MS = 5_000;

export class HomeAssistantClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private connectionState: "disconnected" | "connecting" | "connected" = "disconnected";
  private statusListeners: Array<(state: "disconnected" | "connecting" | "connected") => void> = [];

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly logger: Logger,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async fetchLuftatorEntities(): Promise<HassState[]> {
    const response = await fetch(`${this.baseUrl}/api/states`, {
      headers: this.headers,
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error({ status: response.status, body }, "Failed to fetch Home Assistant states");
      throw new Error(`Failed to fetch Home Assistant states: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as HassState[];
    const entities = payload.filter((entity) =>
      entity.entity_id.startsWith(LUFTATOR_ENTITY_PREFIX),
    );
    this.logger.info(
      { count: entities.length },
      "Successfully fetched Luftator entities from Home Assistant",
    );
    return entities;
  }

  async setValveValue(entityId: string, value: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/services/number/set_value`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ entity_id: entityId, value }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        { entityId, value, body, status: response.status },
        "Failed to set valve value",
      );
      throw new Error(`Failed to set valve value for ${entityId}: ${response.status}`);
    }

    this.logger.info({ entityId, value }, "Successfully set valve value in Home Assistant");
  }

  subscribeLuftatorEvents(handler: HassEventHandler): () => void {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const websocketUrl = this.toWebSocketUrl("/api/websocket");
    const { logger, headers } = this;
    const boundHandleMessage = this.handleWebSocketMessage.bind(this);
    const setState = (state: "disconnected" | "connecting" | "connected") => {
      this.connectionState = state;
      for (const listener of this.statusListeners) {
        try {
          listener(state);
        } catch {
          // ignore listener errors
        }
      }
    };

    function clearReconnectTimer(): void {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect(reason: string): void {
      logger.warn({ reason }, "Home Assistant WebSocket disconnected; scheduling reconnect");
      clearReconnectTimer();
      if (!active) {
        return;
      }
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    }

    function cleanupSocket(): void {
      if (socket) {
        socket.removeAllListeners();
        socket.terminate();
        socket = null;
      }
      setState("disconnected");
    }

    function connect(): void {
      if (!active) {
        return;
      }

      cleanupSocket();
      clearReconnectTimer();
      logger.info({ url: websocketUrl }, "Connecting to Home Assistant WebSocket");
      setState("connecting");

      socket = new WebSocket(websocketUrl, {
        headers: {
          Authorization: headers.Authorization,
        },
      });

      socket.on("open", () => {
        logger.info("Home Assistant WebSocket connection established");
        setState("connected");
      });

      socket.on("message", (data) => {
        try {
          const payload = JSON.parse(data.toString()) as unknown;
          if (isHassWebSocketMessage(payload)) {
            boundHandleMessage(payload, socket!, handler);
          } else {
            logger.warn({ payload }, "Ignoring unexpected Home Assistant WebSocket payload");
          }
        } catch (error) {
          logger.error({ error }, "Failed to process Home Assistant WebSocket message");
        }
      });

      socket.on("error", (error) => {
        logger.error({ error }, "Home Assistant WebSocket error");
        setState("disconnected");
      });

      socket.on("close", (code, reason) => {
        const message = reason.toString() || "socket closed";
        setState("disconnected");
        scheduleReconnect(`${code}: ${message}`);
      });
    }

    connect();

    return () => {
      active = false;
      clearReconnectTimer();
      cleanupSocket();
    };
  }

  getConnectionState(): "disconnected" | "connecting" | "connected" {
    return this.connectionState;
  }

  addStatusListener(
    listener: (state: "disconnected" | "connecting" | "connected") => void,
  ): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private handleWebSocketMessage(
    message: HassWebSocketMessage,
    socket: WebSocket,
    handler: HassEventHandler,
  ): void {
    switch (message.type) {
      case "auth_required":
        socket.send(JSON.stringify({ type: "auth", access_token: this.token }));
        break;
      case "auth_ok":
        this.logger.info("Home Assistant WebSocket authenticated");
        socket.send(
          JSON.stringify({
            id: Date.now(),
            type: "subscribe_events",
            event_type: STATE_CHANGED_EVENT,
          }),
        );
        break;
      case "auth_invalid":
        this.logger.error({ message }, "Home Assistant authentication failed");
        socket.close(1011, "auth_failed");
        break;
      case "event":
        if (isEventMessage(message)) {
          this.processEvent(message.event, handler);
        } else {
          this.logger.warn({ message }, "Ignored event message without payload");
        }
        break;
      default:
        break;
    }
  }

  private processEvent(
    eventPayload: HassEventEnvelope | undefined,
    handler: HassEventHandler,
  ): void {
    if (!eventPayload) {
      return;
    }

    const { data } = eventPayload;
    const entityId = data?.entity_id as string | undefined;
    const newState = data?.new_state as HassState | undefined | null;
    const oldState = data?.old_state as HassState | undefined | null;

    if (!entityId || !newState || !entityId.startsWith(LUFTATOR_ENTITY_PREFIX)) {
      return;
    }

    const event: HassStateChangedEvent = {
      entity_id: entityId,
      new_state: newState ?? null,
      old_state: oldState ?? null,
    };

    this.logger.debug(
      { entityId, state: newState?.state },
      "Processing Home Assistant state changed event",
    );

    void Promise.resolve(handler(event)).catch((error) => {
      this.logger.error({ error }, "Unhandled error in event handler");
    });
  }

  private toWebSocketUrl(pathname: string): string {
    const baseUrl = new URL(this.baseUrl);
    const basePath = baseUrl.pathname.replace(/\/$/, "");
    const targetPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    baseUrl.pathname = `${basePath}${targetPath}`;
    baseUrl.protocol = baseUrl.protocol.replace("http", "ws");
    return baseUrl.toString();
  }
}
