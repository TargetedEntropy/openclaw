import { resolveBastionAccount } from "./accounts.js";
import { BastionApiError, bastionApiCreateDm, bastionApiSendMessage } from "./client.js";
import { normalizeBastionMessagingTarget } from "./normalize.js";
import { getBastionRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

type SendBastionOptions = {
  cfg?: CoreConfig;
  accountId?: string;
  replyToId?: string;
};

export type SendBastionResult = {
  messageId: string;
  channelId: string;
};

/**
 * Send a message to a Bastion channel or DM.
 *
 * `to` can be a channel ID (for server channels) or a user ID (for DMs).
 * When `to` is a user ID, a DM channel is created first.
 */
export async function sendMessageBastion(
  to: string,
  text: string,
  opts: SendBastionOptions = {},
): Promise<SendBastionResult> {
  const runtime = getBastionRuntime();
  const cfg = (opts.cfg ?? runtime.config.loadConfig()) as CoreConfig;
  const account = resolveBastionAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.configured) {
    throw new Error(
      `Bastion is not configured for account "${account.accountId}" (need baseUrl and token in channels.bastion).`,
    );
  }

  const target = normalizeBastionMessagingTarget(to);
  if (!target) {
    throw new Error(`Invalid Bastion target: ${to}`);
  }

  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "bastion",
    accountId: account.accountId,
  });
  const prepared = runtime.channel.text.convertMarkdownTables(text.trim(), tableMode);
  const payload = opts.replyToId ? `${prepared}\n\n[reply:${opts.replyToId}]` : prepared;

  if (!payload.trim()) {
    throw new Error("Message must be non-empty for Bastion sends");
  }

  // Try sending directly to the target as a channel ID.
  // If that fails with 404, assume it's a user ID and create a DM first.
  let channelId = target;
  try {
    const result = await bastionApiSendMessage({
      baseUrl: account.baseUrl,
      token: account.token,
      channelId,
      content: payload,
    });

    runtime.channel.activity.record({
      channel: "bastion",
      accountId: account.accountId,
      direction: "outbound",
    });

    return { messageId: result.id, channelId: result.channelId };
  } catch (err) {
    // If channel send fails, try creating a DM channel to the user
    if (err instanceof BastionApiError && err.status === 404) {
      const dm = await bastionApiCreateDm({
        baseUrl: account.baseUrl,
        token: account.token,
        recipientId: target,
      });
      channelId = dm.id;

      const result = await bastionApiSendMessage({
        baseUrl: account.baseUrl,
        token: account.token,
        channelId,
        content: payload,
      });

      runtime.channel.activity.record({
        channel: "bastion",
        accountId: account.accountId,
        direction: "outbound",
      });

      return { messageId: result.id, channelId };
    }
    throw err;
  }
}
