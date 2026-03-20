import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  BastionApiError,
  bastionApiSendMessage,
  bastionApiGetSelf,
  bastionApiCreateDm,
} from "./client.js";

describe("bastionApiSendMessage", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a message to the correct endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "msg-1",
        channelId: "ch-1",
        content: "hello",
        timestamp: "2026-03-20T00:00:00Z",
      }),
    });

    const result = await bastionApiSendMessage({
      baseUrl: "https://bastion.example.com",
      token: "bot_test",
      channelId: "ch-1",
      content: "hello",
    });

    expect(result.id).toBe("msg-1");
    expect(result.channelId).toBe("ch-1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://bastion.example.com/api/v1/channels/ch-1/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot bot_test",
        },
        body: JSON.stringify({ content: "hello" }),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    await expect(
      bastionApiSendMessage({
        baseUrl: "https://bastion.example.com",
        token: "bot_test",
        channelId: "ch-1",
        content: "hello",
      }),
    ).rejects.toThrow(BastionApiError);
  });

  it("includes status code on typed error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });

    try {
      await bastionApiSendMessage({
        baseUrl: "https://bastion.example.com",
        token: "bot_test",
        channelId: "ch-1",
        content: "hello",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BastionApiError);
      expect((err as BastionApiError).status).toBe(404);
    }
  });
});

describe("bastionApiGetSelf", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches bot identity", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "bot-1", username: "testbot" }),
    });

    const self = await bastionApiGetSelf({
      baseUrl: "https://bastion.example.com",
      token: "bot_test",
    });

    expect(self.id).toBe("bot-1");
    expect(self.username).toBe("testbot");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://bastion.example.com/api/v1/users/@me",
      expect.objectContaining({
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bot bot_test",
        },
      }),
    );
  });
});

describe("bastionApiCreateDm", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates a DM channel", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "dm-ch-1" }),
    });

    const result = await bastionApiCreateDm({
      baseUrl: "https://bastion.example.com",
      token: "bot_test",
      recipientId: "user-1",
    });

    expect(result.id).toBe("dm-ch-1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://bastion.example.com/api/v1/dm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recipientId: "user-1" }),
      }),
    );
  });
});
