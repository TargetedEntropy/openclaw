import { describe, expect, it } from "vitest";
import {
  normalizeBastionMessagingTarget,
  normalizeBastionAllowEntry,
  normalizeBastionAllowlist,
  resolveBastionAllowlistMatch,
  looksLikeBastionTargetId,
} from "./normalize.js";

describe("normalizeBastionMessagingTarget", () => {
  it("returns trimmed target", () => {
    expect(normalizeBastionMessagingTarget("  abc123  ")).toBe("abc123");
  });

  it("returns null for empty string", () => {
    expect(normalizeBastionMessagingTarget("")).toBeNull();
    expect(normalizeBastionMessagingTarget("   ")).toBeNull();
  });
});

describe("looksLikeBastionTargetId", () => {
  it("returns true for non-empty strings", () => {
    expect(looksLikeBastionTargetId("user123")).toBe(true);
  });

  it("returns false for empty strings", () => {
    expect(looksLikeBastionTargetId("")).toBe(false);
    expect(looksLikeBastionTargetId("   ")).toBe(false);
  });
});

describe("normalizeBastionAllowEntry", () => {
  it("lowercases and trims", () => {
    expect(normalizeBastionAllowEntry("  Alice  ")).toBe("alice");
    expect(normalizeBastionAllowEntry("BOB123")).toBe("bob123");
  });

  it("handles numbers", () => {
    expect(normalizeBastionAllowEntry(42)).toBe("42");
  });
});

describe("normalizeBastionAllowlist", () => {
  it("normalizes entries", () => {
    expect(normalizeBastionAllowlist(["Alice", "BOB", ""])).toEqual(["alice", "bob"]);
  });

  it("returns empty for undefined", () => {
    expect(normalizeBastionAllowlist(undefined)).toEqual([]);
  });
});

describe("resolveBastionAllowlistMatch", () => {
  it("matches by sender ID", () => {
    expect(
      resolveBastionAllowlistMatch({
        allowFrom: ["user123"],
        senderId: "user123",
      }),
    ).toEqual({ allowed: true });
  });

  it("matches by sender name", () => {
    expect(
      resolveBastionAllowlistMatch({
        allowFrom: ["alice"],
        senderId: "user456",
        senderName: "Alice",
      }),
    ).toEqual({ allowed: true });
  });

  it("rejects when no match", () => {
    expect(
      resolveBastionAllowlistMatch({
        allowFrom: ["bob"],
        senderId: "user789",
        senderName: "Charlie",
      }),
    ).toEqual({ allowed: false });
  });

  it("rejects when allowFrom is empty", () => {
    expect(
      resolveBastionAllowlistMatch({
        allowFrom: [],
        senderId: "user123",
      }),
    ).toEqual({ allowed: false });
  });
});
