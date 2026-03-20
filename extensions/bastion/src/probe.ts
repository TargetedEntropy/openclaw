import { resolveBastionAccount } from "./accounts.js";
import { bastionApiGetSelf } from "./client.js";
import type { BastionProbe, CoreConfig } from "./types.js";

export async function probeBastion(
  cfg: CoreConfig,
  params: { accountId?: string; timeoutMs?: number },
): Promise<BastionProbe> {
  const account = resolveBastionAccount({ cfg, accountId: params.accountId });
  if (!account.configured) {
    return {
      ok: false,
      error: `Bastion not configured for account "${account.accountId}"`,
      baseUrl: account.baseUrl,
    };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 10000);
    try {
      const self = await bastionApiGetSelf({
        baseUrl: account.baseUrl,
        token: account.token,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - start;
      return {
        ok: true,
        baseUrl: account.baseUrl,
        botId: self.id,
        latencyMs,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return {
      ok: false,
      error: String(err),
      baseUrl: account.baseUrl,
      latencyMs: Date.now() - start,
    };
  }
}
