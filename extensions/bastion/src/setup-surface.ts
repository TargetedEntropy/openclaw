import type { DmPolicy } from "openclaw/plugin-sdk/config-runtime";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
import {
  createAllowFromSection,
  promptParsedAllowFromForAccount,
  setSetupChannelEnabled,
} from "openclaw/plugin-sdk/setup";
import type { ChannelSetupDmPolicy } from "openclaw/plugin-sdk/setup";
import type { ChannelSetupWizard } from "openclaw/plugin-sdk/setup";
import { formatDocsLink } from "openclaw/plugin-sdk/setup";
import type { WizardPrompter } from "openclaw/plugin-sdk/setup";
import {
  listBastionAccountIds,
  resolveDefaultBastionAccountId,
  resolveBastionAccount,
} from "./accounts.js";
import { normalizeBastionAllowEntry } from "./normalize.js";
import {
  bastionSetupAdapter,
  setBastionAllowFrom,
  setBastionDmPolicy,
  setBastionGroupAccess,
  updateBastionAccountConfig,
} from "./setup-core.js";
import type { CoreConfig } from "./types.js";

const channel = "bastion" as const;
const USE_ENV_FLAG = "__bastionUseEnv";

function parseListInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptBastionAllowFrom(params: {
  cfg: CoreConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<CoreConfig> {
  return await promptParsedAllowFromForAccount({
    cfg: params.cfg,
    accountId: params.accountId,
    defaultAccountId: resolveDefaultBastionAccountId(params.cfg),
    prompter: params.prompter,
    noteTitle: "Bastion allowlist",
    noteLines: [
      "Allowlist Bastion DMs by user ID or username.",
      "Multiple entries: comma-separated.",
    ],
    message: "Bastion allowFrom (user ID or username)",
    placeholder: "alice, bob123",
    parseEntries: (raw) => ({
      entries: parseListInput(raw)
        .map((entry) => normalizeBastionAllowEntry(entry))
        .filter(Boolean),
    }),
    getExistingAllowFrom: ({ cfg }) => cfg.channels?.bastion?.allowFrom ?? [],
    applyAllowFrom: ({ cfg, allowFrom }) => setBastionAllowFrom(cfg, allowFrom),
  });
}

const bastionDmPolicy: ChannelSetupDmPolicy = {
  label: "Bastion",
  channel,
  policyKey: "channels.bastion.dmPolicy",
  allowFromKey: "channels.bastion.allowFrom",
  getCurrent: (cfg) => (cfg as CoreConfig).channels?.bastion?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setBastionDmPolicy(cfg as CoreConfig, policy),
  promptAllowFrom: async ({ cfg, prompter, accountId }) =>
    await promptBastionAllowFrom({
      cfg: cfg as CoreConfig,
      prompter,
      accountId,
    }),
};

export const bastionSetupWizard: ChannelSetupWizard = {
  channel,
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs base URL + token",
    configuredHint: "configured",
    unconfiguredHint: "needs base URL + token",
    configuredScore: 1,
    unconfiguredScore: 0,
    resolveConfigured: ({ cfg }) =>
      listBastionAccountIds(cfg as CoreConfig).some(
        (accountId) => resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }).configured,
      ),
    resolveStatusLines: ({ configured }) => [
      `Bastion: ${configured ? "configured" : "needs base URL + token"}`,
    ],
  },
  introNote: {
    title: "Bastion setup",
    lines: [
      "Bastion needs the instance base URL and a bot token.",
      "Create a bot in Server Settings > Integrations to get a token (prefixed bot_).",
      "Optional: configure a webhook URL for outbound-only delivery.",
      "Env vars supported: BASTION_BASE_URL, BASTION_TOKEN, BASTION_WEBHOOK_URL.",
      `Docs: ${formatDocsLink("/channels/bastion", "channels/bastion")}`,
    ],
    shouldShow: ({ cfg, accountId }) =>
      !resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }).configured,
  },
  prepare: async ({ cfg, accountId, credentialValues, prompter }) => {
    const resolved = resolveBastionAccount({ cfg: cfg as CoreConfig, accountId });
    const isDefaultAccount = accountId === DEFAULT_ACCOUNT_ID;
    const envUrl = isDefaultAccount ? process.env.BASTION_BASE_URL?.trim() : "";
    const envToken = isDefaultAccount ? process.env.BASTION_TOKEN?.trim() : "";
    const envReady = Boolean(
      envUrl && envToken && !resolved.config.baseUrl && !resolved.config.token,
    );

    if (envReady) {
      const useEnv = await prompter.confirm({
        message: "BASTION_BASE_URL and BASTION_TOKEN detected. Use env vars?",
        initialValue: true,
      });
      if (useEnv) {
        return {
          cfg: updateBastionAccountConfig(cfg as CoreConfig, accountId, { enabled: true }),
          credentialValues: {
            ...credentialValues,
            [USE_ENV_FLAG]: "1",
          },
        };
      }
    }

    return {
      cfg: updateBastionAccountConfig(cfg as CoreConfig, accountId, { enabled: true }),
      credentialValues: {
        ...credentialValues,
        [USE_ENV_FLAG]: "0",
      },
    };
  },
  credentials: [],
  textInputs: [
    {
      inputKey: "httpHost",
      message: "Bastion instance base URL",
      placeholder: "https://bastion.example.com",
      currentValue: ({ cfg, accountId }) =>
        resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }).config.baseUrl || undefined,
      shouldPrompt: ({ credentialValues }) => credentialValues[USE_ENV_FLAG] !== "1",
      validate: ({ value }) => {
        const trimmed = String(value ?? "").trim();
        if (!trimmed) {
          return "Required";
        }
        try {
          new URL(trimmed);
          return undefined;
        } catch {
          return "Must be a valid URL (e.g. https://bastion.example.com)";
        }
      },
      normalizeValue: ({ value }) => String(value).trim().replace(/\/+$/, ""),
      applySet: async ({ cfg, accountId, value }) =>
        updateBastionAccountConfig(cfg as CoreConfig, accountId, {
          enabled: true,
          baseUrl: value,
        }),
    },
    {
      inputKey: "token",
      message: "Bastion bot token",
      currentValue: ({ cfg, accountId }) =>
        resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }).config.token
          ? "(set)"
          : undefined,
      shouldPrompt: ({ credentialValues }) => credentialValues[USE_ENV_FLAG] !== "1",
      validate: ({ value }) => (String(value ?? "").trim() ? undefined : "Required"),
      normalizeValue: ({ value }) => String(value).trim(),
      applySet: async ({ cfg, accountId, value }) =>
        updateBastionAccountConfig(cfg as CoreConfig, accountId, {
          enabled: true,
          token: value,
        }),
    },
    {
      inputKey: "webhookUrl",
      message: "Bastion webhook URL (optional)",
      required: false,
      applyEmptyValue: true,
      currentValue: ({ cfg, accountId }) =>
        resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }).config.webhookUrl || undefined,
      shouldPrompt: ({ credentialValues }) => credentialValues[USE_ENV_FLAG] !== "1",
      normalizeValue: ({ value }) => String(value).trim(),
      applySet: async ({ cfg, accountId, value }) =>
        updateBastionAccountConfig(cfg as CoreConfig, accountId, {
          enabled: true,
          webhookUrl: value || undefined,
        }),
    },
  ],
  groupAccess: {
    label: "Bastion channels",
    placeholder: "channel-id-1, channel-id-2, *",
    currentPolicy: ({ cfg, accountId }) =>
      resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }).config.groupPolicy ??
      "allowlist",
    currentEntries: ({ cfg, accountId }) =>
      Object.keys(resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }).config.groups ?? {}),
    updatePrompt: ({ cfg, accountId }) =>
      Boolean(resolveBastionAccount({ cfg: cfg as CoreConfig, accountId }).config.groups),
    setPolicy: ({ cfg, accountId, policy }) =>
      setBastionGroupAccess(cfg as CoreConfig, accountId, policy, []),
    resolveAllowlist: async ({ entries }) => [...new Set(entries.filter(Boolean))],
    applyAllowlist: ({ cfg, accountId, resolved }) =>
      setBastionGroupAccess(cfg as CoreConfig, accountId, "allowlist", resolved as string[]),
  },
  allowFrom: createAllowFromSection({
    helpTitle: "Bastion allowlist",
    helpLines: [
      "Allowlist Bastion DMs by user ID or username.",
      "Multiple entries: comma-separated.",
    ],
    message: "Bastion allowFrom (user ID or username)",
    placeholder: "alice, bob123",
    invalidWithoutCredentialNote: "Use a Bastion user ID or username.",
    parseId: (raw) => {
      const normalized = normalizeBastionAllowEntry(raw);
      return normalized || null;
    },
    apply: async ({ cfg, allowFrom }) => setBastionAllowFrom(cfg as CoreConfig, allowFrom),
  }),
  completionNote: {
    title: "Bastion next steps",
    lines: [
      "Next: restart gateway and verify status.",
      "Command: openclaw channels status --probe",
      `Docs: ${formatDocsLink("/channels/bastion", "channels/bastion")}`,
    ],
  },
  dmPolicy: bastionDmPolicy,
  disable: (cfg) => setSetupChannelEnabled(cfg, channel, false),
};

export { bastionSetupAdapter };
