import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/channel-runtime";
import type { ChannelSetupInput } from "openclaw/plugin-sdk/channel-runtime";
import type { DmPolicy } from "openclaw/plugin-sdk/config-runtime";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import {
  applyAccountNameToChannelSection,
  createTopLevelChannelAllowFromSetter,
  createTopLevelChannelDmPolicySetter,
  patchScopedAccountConfig,
} from "openclaw/plugin-sdk/setup";
import type { BastionAccountConfig, CoreConfig } from "./types.js";

const channel = "bastion" as const;
const setBastionTopLevelDmPolicy = createTopLevelChannelDmPolicySetter({ channel });
const setBastionTopLevelAllowFrom = createTopLevelChannelAllowFromSetter({ channel });

type BastionSetupInput = ChannelSetupInput & {
  baseUrl?: string;
  token?: string;
  webhookUrl?: string;
};

export function updateBastionAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  patch: Partial<BastionAccountConfig>,
): CoreConfig {
  return patchScopedAccountConfig({
    cfg,
    channelKey: channel,
    accountId,
    patch,
    ensureChannelEnabled: false,
    ensureAccountEnabled: false,
  }) as CoreConfig;
}

export function setBastionDmPolicy(cfg: CoreConfig, dmPolicy: DmPolicy): CoreConfig {
  return setBastionTopLevelDmPolicy(cfg, dmPolicy) as CoreConfig;
}

export function setBastionAllowFrom(cfg: CoreConfig, allowFrom: string[]): CoreConfig {
  return setBastionTopLevelAllowFrom(cfg, allowFrom) as CoreConfig;
}

export function setBastionGroupAccess(
  cfg: CoreConfig,
  accountId: string,
  policy: "open" | "allowlist" | "disabled",
  entries: string[],
): CoreConfig {
  if (policy !== "allowlist") {
    return updateBastionAccountConfig(cfg, accountId, { enabled: true, groupPolicy: policy });
  }
  const groups = Object.fromEntries(
    [...new Set(entries.filter(Boolean))].map((entry) => [entry, {}]),
  );
  return updateBastionAccountConfig(cfg, accountId, {
    enabled: true,
    groupPolicy: "allowlist",
    groups,
  });
}

export const bastionSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name,
    }),
  validateInput: ({ input }) => {
    const setupInput = input as BastionSetupInput;
    if (!setupInput.baseUrl?.trim()) {
      return "Bastion requires base URL.";
    }
    if (!setupInput.token?.trim()) {
      return "Bastion requires bot token.";
    }
    return null;
  },
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const setupInput = input as BastionSetupInput;
    const namedConfig = applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name: setupInput.name,
    });
    const patch: Partial<BastionAccountConfig> = {
      enabled: true,
      baseUrl: setupInput.baseUrl?.trim(),
      token: setupInput.token?.trim(),
      webhookUrl: setupInput.webhookUrl?.trim() || undefined,
    };
    return patchScopedAccountConfig({
      cfg: namedConfig,
      channelKey: channel,
      accountId,
      patch,
    }) as CoreConfig;
  },
};
