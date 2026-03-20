import type { ResolvedBastionAccount } from "./accounts.js";
import { normalizeBastionAllowlist, resolveBastionAllowlistMatch } from "./normalize.js";
import {
  GROUP_POLICY_BLOCKED_LABEL,
  createChannelPairingController,
  deliverFormattedTextWithAttachments,
  dispatchInboundReplyWithBase,
  logInboundDrop,
  readStoreAllowFromForDmPolicy,
  resolveControlCommandGate,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  resolveEffectiveAllowFromLists,
  warnMissingProviderGroupPolicyFallbackOnce,
  type OutboundReplyPayload,
  type OpenClawConfig,
  type RuntimeEnv,
} from "./runtime-api.js";
import { getBastionRuntime } from "./runtime.js";
import { sendMessageBastion } from "./send.js";
import type { BastionInboundMessage, CoreConfig } from "./types.js";

const CHANNEL_ID = "bastion" as const;

function resolveGroupMatch(params: {
  groups?: Record<string, { enabled?: boolean; allowFrom?: Array<string | number> }>;
  target: string;
}): {
  groupConfig:
    | { allowFrom?: Array<string | number>; systemPrompt?: string; skills?: string[] }
    | undefined;
  wildcardConfig:
    | { allowFrom?: Array<string | number>; systemPrompt?: string; skills?: string[] }
    | undefined;
} {
  const groups = params.groups;
  if (!groups) {
    return { groupConfig: undefined, wildcardConfig: undefined };
  }
  const direct = groups[params.target] as
    | {
        allowFrom?: Array<string | number>;
        systemPrompt?: string;
        skills?: string[];
        enabled?: boolean;
      }
    | undefined;
  const wildcard = groups["*"] as
    | {
        allowFrom?: Array<string | number>;
        systemPrompt?: string;
        skills?: string[];
        enabled?: boolean;
      }
    | undefined;
  return {
    groupConfig: direct?.enabled !== false ? direct : undefined,
    wildcardConfig: wildcard?.enabled !== false ? wildcard : undefined,
  };
}

async function deliverBastionReply(params: {
  payload: OutboundReplyPayload;
  target: string;
  accountId: string;
  sendReply?: (target: string, text: string) => Promise<void>;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}) {
  await deliverFormattedTextWithAttachments({
    payload: params.payload,
    send: async ({ text }) => {
      if (params.sendReply) {
        await params.sendReply(params.target, text);
      } else {
        await sendMessageBastion(params.target, text, {
          accountId: params.accountId,
        });
      }
      params.statusSink?.({ lastOutboundAt: Date.now() });
    },
  });
}

export async function handleBastionInbound(params: {
  message: BastionInboundMessage;
  account: ResolvedBastionAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  botUserId?: string;
  sendReply?: (target: string, text: string) => Promise<void>;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getBastionRuntime();
  const pairing = createChannelPairingController({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const rawBody = message.text?.trim() ?? "";
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const senderDisplay = message.senderName || message.senderId;

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const defaultGroupPolicy = resolveDefaultGroupPolicy(config);
  const { groupPolicy, providerMissingFallbackApplied } =
    resolveAllowlistProviderRuntimeGroupPolicy({
      providerConfigPresent: config.channels?.bastion !== undefined,
      groupPolicy: account.config.groupPolicy,
      defaultGroupPolicy,
    });
  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: "bastion",
    accountId: account.accountId,
    blockedLabel: GROUP_POLICY_BLOCKED_LABEL.channel,
    log: (msg) => runtime.log?.(msg),
  });

  const configAllowFrom = normalizeBastionAllowlist(account.config.allowFrom);
  const configGroupAllowFrom = normalizeBastionAllowlist(account.config.groupAllowFrom);
  const storeAllowFrom = await readStoreAllowFromForDmPolicy({
    provider: CHANNEL_ID,
    accountId: account.accountId,
    dmPolicy,
    readStore: pairing.readStoreForDmPolicy,
  });
  const storeAllowList = normalizeBastionAllowlist(storeAllowFrom);

  const groupMatch = resolveGroupMatch({
    groups: account.config.groups,
    target: message.target,
  });

  if (message.isGroup) {
    if (groupPolicy === "disabled") {
      runtime.log?.(`bastion: drop channel ${message.target} (groupPolicy=disabled)`);
      return;
    }
    if (groupPolicy === "allowlist") {
      const hasGroupConfig = Boolean(groupMatch.groupConfig || groupMatch.wildcardConfig);
      if (!hasGroupConfig) {
        runtime.log?.(`bastion: drop channel ${message.target} (not in allowlist)`);
        return;
      }
    }
  }

  const { effectiveAllowFrom, effectiveGroupAllowFrom } = resolveEffectiveAllowFromLists({
    allowFrom: configAllowFrom,
    groupAllowFrom: configGroupAllowFrom,
    storeAllowFrom: storeAllowList,
    dmPolicy,
    groupAllowFromFallbackToAllowFrom: false,
  });

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config as OpenClawConfig,
    surface: CHANNEL_ID,
  });
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowed = resolveBastionAllowlistMatch({
    allowFrom: message.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom,
    senderId: message.senderId,
    senderName: message.senderName,
  }).allowed;
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config as OpenClawConfig);
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [
      {
        configured: (message.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom).length > 0,
        allowed: senderAllowed,
      },
    ],
    allowTextCommands,
    hasControlCommand,
  });
  const commandAuthorized = commandGate.commandAuthorized;

  // Enforce group sender allowlist: if allowlists are configured, reject
  // non-allowlisted senders even for ordinary (non-command) messages.
  if (message.isGroup && groupPolicy !== "open") {
    const directGroupAllowFrom = normalizeBastionAllowlist(groupMatch.groupConfig?.allowFrom);
    const wildcardGroupAllowFrom = normalizeBastionAllowlist(groupMatch.wildcardConfig?.allowFrom);
    const innerGroupAllowFrom =
      directGroupAllowFrom.length > 0 ? directGroupAllowFrom : wildcardGroupAllowFrom;
    const outerOrInner =
      innerGroupAllowFrom.length > 0 ? innerGroupAllowFrom : effectiveGroupAllowFrom;
    if (outerOrInner.length > 0) {
      const groupSenderAllowed = resolveBastionAllowlistMatch({
        allowFrom: outerOrInner,
        senderId: message.senderId,
        senderName: message.senderName,
      }).allowed;
      if (!groupSenderAllowed) {
        runtime.log?.(`bastion: drop group sender ${senderDisplay} (not in allowlist)`);
        return;
      }
    }
  }

  if (!message.isGroup) {
    if (dmPolicy === "disabled") {
      runtime.log?.(`bastion: drop DM sender=${senderDisplay} (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open") {
      const dmAllowed = resolveBastionAllowlistMatch({
        allowFrom: effectiveAllowFrom,
        senderId: message.senderId,
        senderName: message.senderName,
      }).allowed;
      if (!dmAllowed) {
        if (dmPolicy === "pairing") {
          await pairing.issueChallenge({
            senderId: message.senderId.toLowerCase(),
            senderIdLine: `Your Bastion id: ${senderDisplay}`,
            meta: { name: message.senderName || undefined },
            sendPairingReply: async (text) => {
              await deliverBastionReply({
                payload: { text },
                target: message.channelId,
                accountId: account.accountId,
                sendReply: params.sendReply,
                statusSink,
              });
            },
            onReplyError: (err) => {
              runtime.error?.(`bastion: pairing reply failed for ${senderDisplay}: ${String(err)}`);
            },
          });
        }
        runtime.log?.(`bastion: drop DM sender ${senderDisplay} (dmPolicy=${dmPolicy})`);
        return;
      }
    }
  }

  if (message.isGroup && commandGate.shouldBlock) {
    logInboundDrop({
      log: (line) => runtime.log?.(line),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderDisplay,
    });
    return;
  }

  const peerId = message.isGroup ? message.channelId : message.senderId;
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: message.isGroup ? "group" : "direct",
      id: peerId,
    },
  });

  const fromLabel = message.isGroup ? `#${message.channelId}` : senderDisplay;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config as OpenClawConfig);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Bastion",
    from: fromLabel,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const groupSystemPrompt = groupMatch.groupConfig?.systemPrompt?.trim() || undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: message.isGroup ? `bastion:channel:${message.channelId}` : `bastion:${message.senderId}`,
    To: `bastion:${peerId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: message.isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: message.senderName || undefined,
    SenderId: message.senderId,
    GroupSubject: message.isGroup ? message.channelId : undefined,
    GroupSystemPrompt: message.isGroup ? groupSystemPrompt : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `bastion:${peerId}`,
    CommandAuthorized: commandAuthorized,
  });

  await dispatchInboundReplyWithBase({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core,
    deliver: async (payload) => {
      await deliverBastionReply({
        payload,
        target: message.channelId,
        accountId: account.accountId,
        sendReply: params.sendReply,
        statusSink,
      });
    },
    onRecordError: (err) => {
      runtime.error?.(`bastion: failed updating session meta: ${String(err)}`);
    },
    onDispatchError: (err, info) => {
      runtime.error?.(`bastion ${info.kind} reply failed: ${String(err)}`);
    },
    replyOptions: {
      skillFilter: groupMatch.groupConfig?.skills,
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}
