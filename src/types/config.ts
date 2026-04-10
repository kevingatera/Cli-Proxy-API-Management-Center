/**
 * 配置相关类型定义
 * 与基线 /config 返回结构保持一致（内部使用驼峰形式）
 */

import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from './provider';
import type { AmpcodeConfig } from './ampcode';

export interface QuotaExceededConfig {
  switchProject?: boolean;
  switchPreviewModel?: boolean;
}

export interface RoutingPolicyRouteConfig {
  provider: string;
  authOrder?: string[];
  includeRemainingAuth?: boolean;
}

export interface RoutingPolicyRuleConfig {
  route?: RoutingPolicyRouteConfig[];
  includeRemainingProviders?: boolean;
}

export interface RoutingFallbackPolicyConfig {
  on?: string[];
}

export interface RoutingPolicyObservabilityConfig {
  traceLimit?: number;
}

export interface RoutingPolicyConfig {
  enabled?: boolean;
  defaults?: RoutingPolicyRuleConfig;
  modelOverrides?: Record<string, RoutingPolicyRuleConfig>;
  fallback?: RoutingFallbackPolicyConfig;
  observability?: RoutingPolicyObservabilityConfig;
}

export interface RoutingPreviewProviderDetail {
  provider: string;
  authOrder?: string[];
  availableAuthIds?: string[];
}

export interface RoutingPreview {
  model: string;
  providers: string[];
  orderedProviders: string[];
  strategy: string;
  policyEnabled: boolean;
  fallbackOn?: string[];
  providerDetails?: RoutingPreviewProviderDetail[];
}

export interface RoutingTraceAttempt {
  provider: string;
  authId?: string;
  stage: string;
  success: boolean;
  httpStatus?: number;
  error?: string;
  fallback?: boolean;
  fallbackReason?: string;
}

export interface RoutingTrace {
  id: string;
  timestamp: string;
  operation: string;
  model: string;
  providers: string[];
  orderedProviders?: string[];
  strategy: string;
  policyEnabled: boolean;
  fallbackOn?: string[];
  attempts?: RoutingTraceAttempt[];
  finalStatus: string;
  stopReason?: string;
  error?: string;
}

export interface Config {
  debug?: boolean;
  proxyUrl?: string;
  requestRetry?: number;
  quotaExceeded?: QuotaExceededConfig;
  usageStatisticsEnabled?: boolean;
  requestLog?: boolean;
  loggingToFile?: boolean;
  logsMaxTotalSizeMb?: number;
  wsAuth?: boolean;
  forceModelPrefix?: boolean;
  routingStrategy?: string;
  routingPolicy?: RoutingPolicyConfig;
  apiKeys?: string[];
  ampcode?: AmpcodeConfig;
  geminiApiKeys?: GeminiKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
  oauthExcludedModels?: Record<string, string[]>;
  raw?: Record<string, any>;
}

export type RawConfigSection =
  | 'debug'
  | 'proxy-url'
  | 'request-retry'
  | 'quota-exceeded'
  | 'usage-statistics-enabled'
  | 'request-log'
  | 'logging-to-file'
  | 'logs-max-total-size-mb'
  | 'ws-auth'
  | 'force-model-prefix'
  | 'routing/strategy'
  | 'routing/policy'
  | 'api-keys'
  | 'ampcode'
  | 'gemini-api-key'
  | 'codex-api-key'
  | 'claude-api-key'
  | 'vertex-api-key'
  | 'openai-compatibility'
  | 'oauth-excluded-models';

export interface ConfigCache {
  data: Config;
  timestamp: number;
}
