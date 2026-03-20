import type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
  MarkdownConfig,
  OpenClawConfig,
  BaseProbeResult,
} from "./runtime-api.js";

export type BastionChannelConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  skills?: string[];
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
};

export type BastionAccountConfig = {
  name?: string;
  enabled?: boolean;
  baseUrl?: string;
  token?: string;
  tokenFile?: string;
  webhookUrl?: string;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, BastionChannelConfig>;
  channels?: string[];
  mentionPatterns?: string[];
  markdown?: MarkdownConfig;
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, DmConfig>;
  textChunkLimit?: number;
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  responsePrefix?: string;
  mediaMaxMb?: number;
};

export type BastionConfig = BastionAccountConfig & {
  accounts?: Record<string, BastionAccountConfig>;
  defaultAccount?: string;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    bastion?: BastionConfig;
  };
};

export type BastionInboundMessage = {
  messageId: string;
  /** Channel ID for groups, sender user ID for DMs. */
  target: string;
  channelId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
  attachments?: Array<{ url: string; filename?: string }>;
};

export type BastionProbe = BaseProbeResult<string> & {
  baseUrl: string;
  botId?: string;
  latencyMs?: number;
};
