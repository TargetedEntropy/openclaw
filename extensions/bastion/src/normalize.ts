/**
 * Normalize a Bastion messaging target (channel ID or user ID).
 * Bastion uses opaque IDs for both channels and users.
 */
export function normalizeBastionMessagingTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

/**
 * Check if a raw string looks like a Bastion target ID (non-empty string).
 */
export function looksLikeBastionTargetId(raw: string): boolean {
  return Boolean(raw.trim());
}

/**
 * Normalize a Bastion allowlist entry (user ID or display name).
 */
export function normalizeBastionAllowEntry(raw: string | number): string {
  return String(raw).trim().toLowerCase();
}

/**
 * Normalize a list of allowlist entries.
 */
export function normalizeBastionAllowlist(raw?: Array<string | number>): string[] {
  if (!raw) {
    return [];
  }
  return raw.map((entry) => normalizeBastionAllowEntry(entry)).filter((entry) => entry.length > 0);
}

/**
 * Check if a sender matches an allowlist.
 */
export function resolveBastionAllowlistMatch(params: {
  allowFrom: string[];
  senderId: string;
  senderName?: string;
}): { allowed: boolean } {
  if (params.allowFrom.length === 0) {
    return { allowed: false };
  }
  const normalizedSender = params.senderId.trim().toLowerCase();
  const normalizedName = params.senderName?.trim().toLowerCase();
  const allowed = params.allowFrom.some(
    (entry) => entry === normalizedSender || (normalizedName && entry === normalizedName),
  );
  return { allowed };
}
