import { formatNormalizedAllowFromEntries } from "openclaw/plugin-sdk/allow-from";
import {
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import {
  composeWarningCollectors,
  createAllowlistProviderOpenWarningCollector,
} from "openclaw/plugin-sdk/channel-policy";
import {
  createAttachedChannelResultAdapter,
  createChannelDirectoryAdapter,
  createTextPairingAdapter,
  listResolvedDirectoryEntriesFromSources,
} from "openclaw/plugin-sdk/channel-runtime";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import {
  listBastionAccountIds,
  resolveDefaultBastionAccountId,
  resolveBastionAccount,
  type ResolvedBastionAccount,
} from "./accounts.js";
import { BastionConfigSchema } from "./config-schema.js";
import { monitorBastionProvider } from "./monitor.js";
import {
  normalizeBastionMessagingTarget,
  looksLikeBastionTargetId,
  normalizeBastionAllowEntry,
} from "./normalize.js";
import { probeBastion } from "./probe.js";
import {
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  createAccountStatusSink,
  DEFAULT_ACCOUNT_ID,
  getChatChannelMeta,
  PAIRING_APPROVED_MESSAGE,
  type ChannelPlugin,
} from "./runtime-api.js";
import { getBastionRuntime } from "./runtime.js";
import { sendMessageBastion } from "./send.js";
import { bastionSetupAdapter } from "./setup-core.js";
import { bastionSetupWizard } from "./setup-surface.js";
import type { BastionProbe, CoreConfig } from "./types.js";

const meta = getChatChannelMeta("bastion");

const bastionConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedBastionAccount,
  ResolvedBastionAccount,
  CoreConfig
>({
  sectionKey: "bastion",
  listAccountIds: listBastionAccountIds,
  resolveAccount: (cfg, accountId) => resolveBastionAccount({ cfg, accountId }),
  defaultAccountId: resolveDefaultBastionAccountId,
  clearBaseFields: ["name", "baseUrl", "token", "webhookUrl"],
  resolveAllowFrom: (account: ResolvedBastionAccount) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatNormalizedAllowFromEntries({
      allowFrom,
      normalizeEntry: normalizeBastionAllowEntry,
    }),
  resolveDefaultTo: (account: ResolvedBastionAccount) => account.config.defaultTo,
});

const resolveBastionDmPolicy = createScopedDmSecurityResolver<ResolvedBastionAccount>({
  channelKey: "bastion",
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  policyPathSuffix: "dmPolicy",
  normalizeEntry: (raw) => normalizeBastionAllowEntry(raw),
});

const collectBastionGroupPolicyWarnings =
  createAllowlistProviderOpenWarningCollector<ResolvedBastionAccount>({
    providerConfigPresent: (cfg) => cfg.channels?.bastion !== undefined,
    resolveGroupPolicy: (account) => account.config.groupPolicy,
    buildOpenWarning: {
      surface: "Bastion channels",
      openBehavior: "allows all channels and senders",
      remediation: 'Prefer channels.bastion.groupPolicy="allowlist" with channels.bastion.groups',
    },
  });

const collectBastionSecurityWarnings = composeWarningCollectors<{
  account: ResolvedBastionAccount;
  cfg: CoreConfig;
}>(collectBastionGroupPolicyWarnings);

export const bastionPlugin: ChannelPlugin<ResolvedBastionAccount, BastionProbe> = {
  id: "bastion",
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  setup: bastionSetupAdapter,
  setupWizard: bastionSetupWizard,
  pairing: createTextPairingAdapter({
    idLabel: "bastionUser",
    message: PAIRING_APPROVED_MESSAGE,
    normalizeAllowEntry: (entry) => normalizeBastionAllowEntry(entry),
    notify: async ({ id, message }) => {
      const target = id.trim();
      if (!target) {
        throw new Error(`invalid Bastion pairing id: ${id}`);
      }
      await sendMessageBastion(target, message);
    },
  }),
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.bastion"] },
  configSchema: buildChannelConfigSchema(BastionConfigSchema),
  config: {
    ...bastionConfigAdapter,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.baseUrl,
      tokenSource: account.tokenSource,
    }),
  },
  security: {
    resolveDmPolicy: resolveBastionDmPolicy,
    collectWarnings: collectBastionSecurityWarnings,
  },
  groups: {
    resolveRequireMention: () => false,
    resolveToolPolicy: ({ cfg, accountId, groupId }) => {
      const account = resolveBastionAccount({ cfg: cfg as CoreConfig, accountId });
      if (!groupId) {
        return undefined;
      }
      const groups = account.config.groups;
      const groupConfig = groups?.[groupId] ?? groups?.["*"];
      return groupConfig?.tools;
    },
  },
  messaging: {
    normalizeTarget: (raw: string) => normalizeBastionMessagingTarget(raw) ?? undefined,
    targetResolver: {
      looksLikeId: looksLikeBastionTargetId,
      hint: "<channelId|userId>",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeBastionMessagingTarget(input);
        if (!normalized) {
          return { input, resolved: false, note: "invalid Bastion target" };
        }
        return { input, resolved: true, id: normalized, name: normalized };
      });
    },
  },
  directory: createChannelDirectoryAdapter({
    listPeers: async (params) =>
      listResolvedDirectoryEntriesFromSources({
        ...params,
        kind: "user",
        resolveAccount: (cfg, accountId) =>
          resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }),
        resolveSources: (account) => [
          account.config.allowFrom ?? [],
          account.config.groupAllowFrom ?? [],
          ...Object.values(account.config.groups ?? {}).map((group) => group.allowFrom ?? []),
        ],
        normalizeId: (entry) => normalizeBastionAllowEntry(entry) || null,
      }),
    listGroups: async (params) => {
      const entries = listResolvedDirectoryEntriesFromSources({
        ...params,
        kind: "group",
        resolveAccount: (cfg, accountId) =>
          resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }),
        resolveSources: (account) => [
          account.config.channels ?? [],
          Object.keys(account.config.groups ?? {}),
        ],
        normalizeId: (entry) => String(entry).trim() || null,
      });
      return entries.map((entry) => ({ ...entry, name: entry.id }));
    },
  }),
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getBastionRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 2000,
    ...createAttachedChannelResultAdapter({
      channel: "bastion",
      sendText: async ({ cfg, to, text, accountId, replyToId }) =>
        await sendMessageBastion(to, text, {
          cfg: cfg as CoreConfig,
          accountId: accountId ?? undefined,
          replyToId: replyToId ?? undefined,
        }),
      sendMedia: async ({ cfg, to, text, mediaUrl, accountId, replyToId }) =>
        await sendMessageBastion(to, mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text, {
          cfg: cfg as CoreConfig,
          accountId: accountId ?? undefined,
          replyToId: replyToId ?? undefined,
        }),
    }),
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ account, snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
      baseUrl: account.baseUrl,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg, account, timeoutMs }) =>
      probeBastion(cfg as CoreConfig, { accountId: account.accountId, timeoutMs }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      ...buildBaseAccountStatusSnapshot({ account, runtime, probe }),
      baseUrl: account.baseUrl,
      tokenSource: account.tokenSource,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const statusSink = createAccountStatusSink({
        accountId: ctx.accountId,
        setStatus: ctx.setStatus,
      });
      if (!account.configured) {
        throw new Error(
          `Bastion is not configured for account "${account.accountId}" (need baseUrl and token in channels.bastion).`,
        );
      }
      ctx.log?.info(`[${account.accountId}] starting Bastion provider (${account.baseUrl})`);
      await runStoppablePassiveMonitor({
        abortSignal: ctx.abortSignal,
        start: async () =>
          await monitorBastionProvider({
            accountId: account.accountId,
            config: ctx.cfg as CoreConfig,
            runtime: ctx.runtime,
            abortSignal: ctx.abortSignal,
            statusSink,
          }),
      });
    },
  },
};
