import WebSocket from "ws";

export type BastionWsEvent =
  | { type: "MESSAGE_CREATE"; data: BastionMessageEvent }
  | { type: "MESSAGE_UPDATE"; data: BastionMessageEvent }
  | { type: "TYPING_START"; data: { channelId: string; userId: string } }
  | { type: "INTERACTION_CREATE"; data: BastionInteractionEvent };

export type BastionMessageEvent = {
  id: string;
  channelId: string;
  serverId?: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
  attachments?: Array<{ url: string; filename?: string }>;
};

export type BastionInteractionEvent = {
  id: string;
  token: string;
  type: number;
  channelId: string;
  serverId?: string;
  member?: { user: { id: string; username: string } };
  user?: { id: string; username: string };
  data: { name: string; options?: Array<{ name: string; value: string }> };
};

export type BastionClientOptions = {
  baseUrl: string;
  token: string;
  abortSignal?: AbortSignal;
  onMessage?: (event: BastionMessageEvent) => void | Promise<void>;
  onInteraction?: (event: BastionInteractionEvent) => void | Promise<void>;
  onError?: (error: Error) => void;
  onClose?: () => void;
  onOpen?: () => void;
};

export type BastionClient = {
  isReady(): boolean;
  close(): void;
  ws: WebSocket | null;
};

const RECONNECT_DELAY_MS = 5000;
const PING_INTERVAL_MS = 30000;

export function connectBastionWs(opts: BastionClientOptions): BastionClient {
  // Bastion server requires token as a query parameter for WebSocket auth.
  const wsUrl = opts.baseUrl.replace(/^http/, "ws") + `/api/v1/ws?token=${opts.token}`;
  let ws: WebSocket | null = null;
  let ready = false;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  function cleanup() {
    ready = false;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  }

  function connect() {
    if (opts.abortSignal?.aborted) {
      return;
    }

    ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      ready = true;
      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, PING_INTERVAL_MS);
      opts.onOpen?.();
    });

    ws.on("message", (data) => {
      try {
        const event = JSON.parse(String(data)) as BastionWsEvent;
        if (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") {
          opts.onMessage?.(event.data);
        } else if (event.type === "INTERACTION_CREATE") {
          opts.onInteraction?.(event.data);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("error", (err) => {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    });

    ws.on("close", () => {
      cleanup();
      opts.onClose?.();
      if (!opts.abortSignal?.aborted) {
        reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });

    opts.abortSignal?.addEventListener(
      "abort",
      () => {
        cleanup();
        ws?.close();
        ws = null;
      },
      { once: true },
    );
  }

  connect();

  return {
    isReady: () => ready,
    close: () => {
      cleanup();
      ws?.close();
      ws = null;
    },
    get ws() {
      return ws;
    },
  };
}

// REST API helpers for sending messages and managing channels.

export class BastionApiError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`Bastion API error ${status}: ${body}`);
    this.status = status;
  }
}

export type BastionSendPayload = {
  content: string;
};

export type BastionSendResponse = {
  id: string;
  channelId: string;
  content: string;
  timestamp: string;
};

function buildHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bot ${token}`,
  };
}

export async function bastionApiSendMessage(params: {
  baseUrl: string;
  token: string;
  channelId: string;
  content: string;
}): Promise<BastionSendResponse> {
  const url = `${params.baseUrl}/api/v1/channels/${params.channelId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(params.token),
    body: JSON.stringify({ content: params.content } satisfies BastionSendPayload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new BastionApiError(response.status, body);
  }
  return (await response.json()) as BastionSendResponse;
}

export async function bastionApiCreateDm(params: {
  baseUrl: string;
  token: string;
  recipientId: string;
}): Promise<{ id: string }> {
  const url = `${params.baseUrl}/api/v1/dm`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(params.token),
    body: JSON.stringify({ recipientId: params.recipientId }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new BastionApiError(response.status, body);
  }
  return (await response.json()) as { id: string };
}

export async function bastionApiGetSelf(params: {
  baseUrl: string;
  token: string;
  signal?: AbortSignal;
}): Promise<{ id: string; username: string }> {
  const url = `${params.baseUrl}/api/v1/users/me`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(params.token),
    signal: params.signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new BastionApiError(response.status, body);
  }
  return (await response.json()) as { id: string; username: string };
}

/**
 * Execute a webhook (no auth header needed; token is in the URL).
 */
export async function bastionWebhookSend(params: {
  webhookUrl: string;
  content: string;
  username?: string;
}): Promise<void> {
  const response = await fetch(params.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: params.content,
      username: params.username,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Bastion webhook error ${response.status}: ${body}`);
  }
}
