import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/config-runtime";
import { tryReadSecretFileSync } from "openclaw/plugin-sdk/infra-runtime";
import type { BastionAccountConfig, CoreConfig } from "./types.js";

export type ResolvedBastionAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  baseUrl: string;
  token: string;
  tokenSource: "env" | "tokenFile" | "config" | "none";
  webhookUrl: string;
  config: BastionAccountConfig;
};

const {
  listAccountIds: listBastionAccountIds,
  resolveDefaultAccountId: resolveDefaultBastionAccountId,
} = createAccountListHelpers("bastion", { normalizeAccountId });
export { listBastionAccountIds, resolveDefaultBastionAccountId };

function resolveAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): BastionAccountConfig | undefined {
  const accounts = cfg.channels?.bastion?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  const direct = accounts[accountId] as BastionAccountConfig | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeAccountId(accountId);
  const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === normalized);
  return matchKey ? (accounts[matchKey] as BastionAccountConfig | undefined) : undefined;
}

function mergeBastionAccountConfig(cfg: CoreConfig, accountId: string): BastionAccountConfig {
  const {
    accounts: _ignored,
    defaultAccount: _ignoredDefaultAccount,
    ...base
  } = (cfg.channels?.bastion ?? {}) as BastionAccountConfig & {
    accounts?: unknown;
    defaultAccount?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

function resolveToken(accountId: string, merged: BastionAccountConfig) {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    const envToken = process.env.BASTION_TOKEN?.trim();
    if (envToken) {
      return { token: envToken, source: "env" as const };
    }
  }

  if (merged.tokenFile?.trim()) {
    const fileToken = tryReadSecretFileSync(merged.tokenFile, "Bastion token file", {
      rejectSymlink: true,
    });
    if (fileToken) {
      return { token: fileToken, source: "tokenFile" as const };
    }
  }

  const configToken = normalizeResolvedSecretInputString({
    value: merged.token,
    path: `channels.bastion.accounts.${accountId}.token`,
  });
  if (configToken) {
    return { token: configToken, source: "config" as const };
  }

  return { token: "", source: "none" as const };
}

export function resolveBastionAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedBastionAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.bastion?.enabled !== false;

  const resolve = (accountId: string) => {
    const merged = mergeBastionAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;

    const baseUrl = (
      merged.baseUrl?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.BASTION_BASE_URL?.trim() : "") ||
      ""
    )
      .trim()
      .replace(/\/+$/, "");

    const tokenResolution = resolveToken(accountId, merged);

    const webhookUrl = (
      merged.webhookUrl?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.BASTION_WEBHOOK_URL?.trim() : "") ||
      ""
    ).trim();

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      configured: Boolean(baseUrl && tokenResolution.token),
      baseUrl,
      token: tokenResolution.token,
      tokenSource: tokenResolution.source,
      webhookUrl,
      config: merged,
    } satisfies ResolvedBastionAccount;
  };

  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);
  if (hasExplicitAccountId) {
    return primary;
  }
  if (primary.configured) {
    return primary;
  }

  const fallbackId = resolveDefaultBastionAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  if (!fallback.configured) {
    return primary;
  }
  return fallback;
}

export function listEnabledBastionAccounts(cfg: CoreConfig): ResolvedBastionAccount[] {
  return listBastionAccountIds(cfg)
    .map((accountId) => resolveBastionAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
