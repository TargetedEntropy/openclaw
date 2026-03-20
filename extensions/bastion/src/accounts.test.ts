import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveBastionAccount, listBastionAccountIds } from "./accounts.js";
import type { CoreConfig } from "./types.js";

function makeConfig(overrides?: Partial<CoreConfig["channels"]>): CoreConfig {
  return {
    channels: {
      bastion: {
        baseUrl: "https://bastion.example.com",
        token: "bot_testtoken123",
        ...overrides?.bastion,
      },
      ...overrides,
    },
  } as CoreConfig;
}

describe("resolveBastionAccount", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves a configured account from config", () => {
    const cfg = makeConfig();
    const account = resolveBastionAccount({ cfg });
    expect(account.configured).toBe(true);
    expect(account.baseUrl).toBe("https://bastion.example.com");
    expect(account.token).toBe("bot_testtoken123");
    expect(account.tokenSource).toBe("config");
    expect(account.enabled).toBe(true);
  });

  it("resolves unconfigured when missing baseUrl", () => {
    const cfg = makeConfig({ bastion: { token: "bot_test" } });
    const account = resolveBastionAccount({ cfg });
    expect(account.configured).toBe(false);
    expect(account.baseUrl).toBe("");
  });

  it("resolves unconfigured when missing token", () => {
    const cfg = makeConfig({ bastion: { baseUrl: "https://bastion.example.com" } });
    const account = resolveBastionAccount({ cfg });
    expect(account.configured).toBe(false);
    expect(account.token).toBe("");
  });

  it("resolves token from env for default account", () => {
    process.env.BASTION_TOKEN = "bot_envtoken";
    process.env.BASTION_BASE_URL = "https://env.bastion.com";
    const cfg = { channels: {} } as CoreConfig;
    const account = resolveBastionAccount({ cfg });
    expect(account.token).toBe("bot_envtoken");
    expect(account.tokenSource).toBe("env");
    expect(account.baseUrl).toBe("https://env.bastion.com");
    expect(account.configured).toBe(true);
  });

  it("strips trailing slashes from baseUrl", () => {
    const cfg = makeConfig({
      bastion: { baseUrl: "https://bastion.example.com///", token: "bot_t" },
    });
    const account = resolveBastionAccount({ cfg });
    expect(account.baseUrl).toBe("https://bastion.example.com");
  });

  it("respects enabled=false", () => {
    const cfg = makeConfig({
      bastion: { baseUrl: "https://x.com", token: "bot_t", enabled: false },
    });
    const account = resolveBastionAccount({ cfg });
    expect(account.enabled).toBe(false);
  });

  it("resolves a named account", () => {
    const cfg = makeConfig({
      bastion: {
        baseUrl: "https://default.com",
        token: "bot_default",
        accounts: {
          secondary: {
            baseUrl: "https://secondary.com",
            token: "bot_secondary",
          },
        },
      },
    });
    const account = resolveBastionAccount({ cfg, accountId: "secondary" });
    expect(account.accountId).toBe("secondary");
    expect(account.baseUrl).toBe("https://secondary.com");
    expect(account.token).toBe("bot_secondary");
  });

  it("merges account config over base config", () => {
    const cfg = makeConfig({
      bastion: {
        baseUrl: "https://base.com",
        token: "bot_base",
        dmPolicy: "open",
        accounts: {
          alt: {
            token: "bot_alt",
          },
        },
      },
    });
    const account = resolveBastionAccount({ cfg, accountId: "alt" });
    expect(account.baseUrl).toBe("https://base.com");
    expect(account.token).toBe("bot_alt");
    expect(account.config.dmPolicy).toBe("open");
  });
});

describe("listBastionAccountIds", () => {
  it("lists default when no accounts configured", () => {
    const cfg = makeConfig();
    const ids = listBastionAccountIds(cfg);
    expect(ids).toContain("default");
  });

  it("lists named accounts", () => {
    const cfg = makeConfig({
      bastion: {
        baseUrl: "https://x.com",
        token: "bot_t",
        accounts: {
          alpha: { token: "bot_a" },
          beta: { token: "bot_b" },
        },
      },
    });
    const ids = listBastionAccountIds(cfg);
    expect(ids).toContain("alpha");
    expect(ids).toContain("beta");
  });
});
