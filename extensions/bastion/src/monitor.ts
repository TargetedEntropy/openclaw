import { resolveLoggerBackedRuntime } from "openclaw/plugin-sdk/extension-shared";
import { resolveBastionAccount } from "./accounts.js";
import {
  connectBastionWs,
  bastionApiGetSelf,
  bastionApiSendMessage,
  type BastionClient,
  type BastionMessageEvent,
} from "./client.js";
import { handleBastionInbound } from "./inbound.js";
import type { RuntimeEnv } from "./runtime-api.js";
import { getBastionRuntime } from "./runtime.js";
import type { BastionInboundMessage, CoreConfig } from "./types.js";

export type BastionMonitorOptions = {
  accountId?: string;
  config?: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  onMessage?: (message: BastionInboundMessage) => void | Promise<void>;
};

/**
 * Determine if a message is a DM by checking if it has no serverId.
 * Bastion DMs are channelId-based but lack a serverId.
 */
function isDmMessage(event: BastionMessageEvent): boolean {
  return !event.serverId;
}

export async function monitorBastionProvider(
  opts: BastionMonitorOptions,
): Promise<{ stop: () => void }> {
  const core = getBastionRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveBastionAccount({
    cfg,
    accountId: opts.accountId,
  });

  const runtime: RuntimeEnv = resolveLoggerBackedRuntime(
    opts.runtime,
    core.logging.getChildLogger(),
  );

  if (!account.configured) {
    throw new Error(
      `Bastion is not configured for account "${account.accountId}" (need baseUrl and token in channels.bastion).`,
    );
  }

  const logger = core.logging.getChildLogger({
    channel: "bastion",
    accountId: account.accountId,
  });

  // Resolve the bot's own user ID so we can ignore self-messages.
  // This is mandatory — without it the bot will respond to its own output
  // and loop indefinitely.
  const self = await bastionApiGetSelf({
    baseUrl: account.baseUrl,
    token: account.token,
  });
  const botUserId = self.id;
  const botUsername = self.username;
  logger.info(`[${account.accountId}] authenticated as ${botUsername} (${botUserId})`);

  let client: BastionClient | null = null;

  client = connectBastionWs({
    baseUrl: account.baseUrl,
    token: account.token,
    abortSignal: opts.abortSignal,
    onOpen: () => {
      logger.info(`[${account.accountId}] WebSocket connected to ${account.baseUrl}`);
    },
    onError: (error) => {
      logger.error(`[${account.accountId}] Bastion WS error: ${error.message}`);
    },
    onClose: () => {
      logger.info(`[${account.accountId}] WebSocket closed, will reconnect`);
    },
    onMessage: async (event) => {
      // Ignore messages from the bot itself (by ID or username fallback).
      if (event.author.id === botUserId) {
        return;
      }
      if (botUsername && event.author.username === botUsername) {
        return;
      }
      // Ignore messages from other bots.
      if (event.author.bot) {
        return;
      }

      const isGroup = !isDmMessage(event);
      const message: BastionInboundMessage = {
        messageId: event.id,
        target: isGroup ? event.channelId : event.author.id,
        channelId: event.channelId,
        senderId: event.author.id,
        senderName: event.author.username,
        text: event.content,
        timestamp: event.timestamp ? new Date(event.timestamp).getTime() : Date.now(),
        isGroup,
        attachments: event.attachments,
      };

      core.channel.activity.record({
        channel: "bastion",
        accountId: account.accountId,
        direction: "inbound",
        at: message.timestamp,
      });

      if (opts.onMessage) {
        await opts.onMessage(message);
        return;
      }

      await handleBastionInbound({
        message,
        account,
        config: cfg,
        runtime,
        botUserId,
        sendReply: async (target, text) => {
          await bastionApiSendMessage({
            baseUrl: account.baseUrl,
            token: account.token,
            channelId: target,
            content: text,
          });
          opts.statusSink?.({ lastOutboundAt: Date.now() });
          core.channel.activity.record({
            channel: "bastion",
            accountId: account.accountId,
            direction: "outbound",
          });
        },
        statusSink: opts.statusSink,
      });
    },
  });

  return {
    stop: () => {
      client?.close();
      client = null;
    },
  };
}
