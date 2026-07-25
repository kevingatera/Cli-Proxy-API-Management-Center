/**
 * 用量遥测索引：读取代理 /usage 端点，按 auth_index / auth_id / source 聚合请求。
 * Cursor 与 OpenCode Zen 共用。React-free —— 数据层不 import React 或 SCSS。
 * 端点不可用（404 / 网络错误）时索引为空，渲染体据此显示 fetcher_pending 提示。
 */

import { usageApi } from '@/services/api';
import type { CursorModelUsageSummary, CursorUsageSummary } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { normalizeNumberValue, normalizeStringValue } from '@/utils/quota';
import { normalizeUsageSourceId } from '@/utils/usage';

export const emptyUsageSummary = (): CursorUsageSummary => ({
  requests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
  modelCount: 0,
  tokenTelemetryCount: 0,
  models: [] as CursorModelUsageSummary[],
});

interface UsageAccumulator {
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  tokenTelemetryCount: number;
  modelNames: Set<string>;
  models: Map<string, UsageAccumulator>;
  lastSeenMillis: number | null;
}

interface UsageIndex {
  byAuthIndex: Map<string, CursorUsageSummary>;
  byAuthId: Map<string, CursorUsageSummary>;
  bySource: Map<string, CursorUsageSummary>;
}

const USAGE_CACHE_TTL_MS = 1500;
let usageIndexCache: { fetchedAt: number; index: UsageIndex } | null = null;
let usageIndexInFlight: Promise<UsageIndex> | null = null;
// Set when the /usage endpoint cannot be fetched (404, network error, ...).
// Renderers use it to show the fetcher_pending hint instead of empty_usage.
let usageEndpointUnavailable = false;

const createUsageAccumulator = (): UsageAccumulator => ({
  requests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
  tokenTelemetryCount: 0,
  modelNames: new Set<string>(),
  models: new Map<string, UsageAccumulator>(),
  lastSeenMillis: null,
});

export const cloneUsageSummary = (summary: CursorUsageSummary): CursorUsageSummary => ({
  ...summary,
  models: summary.models?.map((model) => ({ ...model })),
});

const mergeModelUsageSummaries = (
  base: CursorModelUsageSummary[] | undefined,
  patch: CursorModelUsageSummary[] | undefined
): CursorModelUsageSummary[] | undefined => {
  if (!base?.length && !patch?.length) return undefined;
  const byModel = new Map<string, CursorModelUsageSummary>();

  const upsert = (item: CursorModelUsageSummary) => {
    const current = byModel.get(item.model);
    if (!current) {
      byModel.set(item.model, { ...item });
      return;
    }
    current.requests += item.requests;
    current.successCount += item.successCount;
    current.failureCount += item.failureCount;
    current.totalTokens += item.totalTokens;
    current.tokenTelemetryCount =
      (current.tokenTelemetryCount ?? 0) + (item.tokenTelemetryCount ?? 0);
    current.lastSeenAt =
      current.lastSeenAt && item.lastSeenAt
        ? Date.parse(current.lastSeenAt) >= Date.parse(item.lastSeenAt)
          ? current.lastSeenAt
          : item.lastSeenAt
        : (current.lastSeenAt ?? item.lastSeenAt);
  };

  base?.forEach(upsert);
  patch?.forEach(upsert);
  return Array.from(byModel.values()).sort((a, b) => {
    if (b.requests !== a.requests) return b.requests - a.requests;
    return a.model.localeCompare(b.model);
  });
};

export const mergeUsageSummary = (
  base: CursorUsageSummary,
  patch: CursorUsageSummary | undefined
): CursorUsageSummary => {
  if (!patch) return base;
  return {
    requests: base.requests + patch.requests,
    successCount: base.successCount + patch.successCount,
    failureCount: base.failureCount + patch.failureCount,
    totalTokens: base.totalTokens + patch.totalTokens,
    modelCount: Math.max(base.modelCount, patch.modelCount),
    tokenTelemetryCount: (base.tokenTelemetryCount ?? 0) + (patch.tokenTelemetryCount ?? 0),
    models: mergeModelUsageSummaries(base.models, patch.models),
    lastSeenAt:
      base.lastSeenAt && patch.lastSeenAt
        ? Date.parse(base.lastSeenAt) >= Date.parse(patch.lastSeenAt)
          ? base.lastSeenAt
          : patch.lastSeenAt
        : (base.lastSeenAt ?? patch.lastSeenAt),
  };
};

const parseTokenMetrics = (tokens: unknown): { total: number; reported: boolean } => {
  if (!tokens || typeof tokens !== 'object') return { total: 0, reported: false };
  const record = tokens as Record<string, unknown>;
  const totalNode = normalizeNumberValue(record.total_tokens ?? record.totalTokens);

  const input = normalizeNumberValue(record.input_tokens ?? record.inputTokens);
  const output = normalizeNumberValue(record.output_tokens ?? record.outputTokens);
  const reasoning = normalizeNumberValue(record.reasoning_tokens ?? record.reasoningTokens);
  const cached = normalizeNumberValue(record.cached_tokens ?? record.cachedTokens);

  if (totalNode !== null) {
    const isAllZero =
      totalNode === 0 &&
      (input ?? 0) === 0 &&
      (output ?? 0) === 0 &&
      (reasoning ?? 0) === 0 &&
      (cached ?? 0) === 0;
    return { total: Math.max(0, Math.round(totalNode)), reported: !isAllZero };
  }

  const reported = input !== null || output !== null || reasoning !== null;
  if (!reported) {
    return { total: 0, reported: false };
  }

  const total = (input ?? 0) + (output ?? 0) + (reasoning ?? 0);
  return { total: Math.max(0, Math.round(total)), reported: true };
};

const parseTimestamp = (value: unknown): number | null => {
  const ts = normalizeStringValue(value);
  if (!ts) return null;
  const millis = Date.parse(ts);
  return Number.isFinite(millis) ? millis : null;
};

const upsertUsageAccumulator = (
  map: Map<string, UsageAccumulator>,
  key: string,
  model: string,
  detail: Record<string, unknown>
) => {
  const normalizedKey = normalizeStringValue(key);
  if (!normalizedKey) return;

  const current = map.get(normalizedKey) ?? createUsageAccumulator();
  current.requests += 1;
  const failed = Boolean(detail.failed);
  if (failed) current.failureCount += 1;
  else current.successCount += 1;

  if (model) current.modelNames.add(model);
  const tokenMetrics = parseTokenMetrics(detail.tokens);
  current.totalTokens += tokenMetrics.total;
  if (tokenMetrics.reported) {
    current.tokenTelemetryCount += 1;
  }

  if (model) {
    const modelAcc = current.models.get(model) ?? createUsageAccumulator();
    modelAcc.requests += 1;
    if (failed) modelAcc.failureCount += 1;
    else modelAcc.successCount += 1;
    modelAcc.modelNames.add(model);
    modelAcc.totalTokens += tokenMetrics.total;
    if (tokenMetrics.reported) {
      modelAcc.tokenTelemetryCount += 1;
    }
    const modelMillis = parseTimestamp(detail.timestamp);
    if (
      modelMillis !== null &&
      (modelAcc.lastSeenMillis === null || modelMillis > modelAcc.lastSeenMillis)
    ) {
      modelAcc.lastSeenMillis = modelMillis;
    }
    current.models.set(model, modelAcc);
  }

  const millis = parseTimestamp(detail.timestamp);
  if (millis !== null && (current.lastSeenMillis === null || millis > current.lastSeenMillis)) {
    current.lastSeenMillis = millis;
  }
  map.set(normalizedKey, current);
};

const finalizeUsageMap = (
  map: Map<string, UsageAccumulator>
): Map<string, CursorUsageSummary> => {
  const out = new Map<string, CursorUsageSummary>();
  map.forEach((acc, key) => {
    const models = Array.from(acc.models.entries())
      .map(([model, modelAcc]) => ({
        model,
        requests: modelAcc.requests,
        successCount: modelAcc.successCount,
        failureCount: modelAcc.failureCount,
        totalTokens: modelAcc.totalTokens,
        tokenTelemetryCount: modelAcc.tokenTelemetryCount,
        lastSeenAt:
          modelAcc.lastSeenMillis !== null
            ? new Date(modelAcc.lastSeenMillis).toISOString()
            : undefined,
      }))
      .sort((a, b) => {
        if (b.requests !== a.requests) return b.requests - a.requests;
        return a.model.localeCompare(b.model);
      });
    out.set(key, {
      requests: acc.requests,
      successCount: acc.successCount,
      failureCount: acc.failureCount,
      totalTokens: acc.totalTokens,
      modelCount: acc.modelNames.size,
      tokenTelemetryCount: acc.tokenTelemetryCount,
      models,
      lastSeenAt:
        acc.lastSeenMillis !== null ? new Date(acc.lastSeenMillis).toISOString() : undefined,
    });
  });
  return out;
};

const buildUsageIndex = (usageRoot: Record<string, unknown>): UsageIndex => {
  const apis =
    usageRoot && typeof usageRoot.apis === 'object' && usageRoot.apis !== null
      ? (usageRoot.apis as Record<string, unknown>)
      : {};

  const byAuthIndexAcc = new Map<string, UsageAccumulator>();
  const byAuthIdAcc = new Map<string, UsageAccumulator>();
  const bySourceAcc = new Map<string, UsageAccumulator>();

  for (const apiValue of Object.values(apis)) {
    if (!apiValue || typeof apiValue !== 'object') continue;
    const modelsRecord = (apiValue as Record<string, unknown>).models;
    if (!modelsRecord || typeof modelsRecord !== 'object') continue;

    for (const [modelKey, modelValue] of Object.entries(modelsRecord as Record<string, unknown>)) {
      if (!modelValue || typeof modelValue !== 'object') continue;
      const details = (modelValue as Record<string, unknown>).details;
      if (!Array.isArray(details)) continue;

      for (const detailValue of details) {
        if (!detailValue || typeof detailValue !== 'object') continue;
        const detail = detailValue as Record<string, unknown>;
        const detailAuthIndex = normalizeAuthIndex(detail.auth_index ?? detail.authIndex);
        const detailAuthId = normalizeStringValue(detail.auth_id ?? detail.authId);
        const detailSource = normalizeUsageSourceId(detail.source);

        if (detailAuthIndex) {
          upsertUsageAccumulator(byAuthIndexAcc, detailAuthIndex, modelKey, detail);
        }
        if (detailAuthId) {
          upsertUsageAccumulator(byAuthIdAcc, detailAuthId, modelKey, detail);
        }
        if (detailSource) {
          upsertUsageAccumulator(bySourceAcc, detailSource, modelKey, detail);
        }
      }
    }
  }

  return {
    byAuthIndex: finalizeUsageMap(byAuthIndexAcc),
    byAuthId: finalizeUsageMap(byAuthIdAcc),
    bySource: finalizeUsageMap(bySourceAcc),
  };
};

const emptyUsageIndex = (): UsageIndex => ({
  byAuthIndex: new Map<string, CursorUsageSummary>(),
  byAuthId: new Map<string, CursorUsageSummary>(),
  bySource: new Map<string, CursorUsageSummary>(),
});

export const loadUsageIndex = async (): Promise<UsageIndex> => {
  const now = Date.now();
  if (usageIndexCache && now - usageIndexCache.fetchedAt < USAGE_CACHE_TTL_MS) {
    return usageIndexCache.index;
  }
  if (usageIndexInFlight) {
    return usageIndexInFlight;
  }

  usageIndexInFlight = (async () => {
    try {
      const response = (await usageApi.getUsage()) as Record<string, unknown> | null | undefined;
      const usageRoot = (response?.usage ?? response) as Record<string, unknown>;
      const index = buildUsageIndex(usageRoot);
      usageEndpointUnavailable = false;
      usageIndexCache = { fetchedAt: Date.now(), index };
      return index;
    } catch {
      // The backend may not expose /usage (404) or may be unreachable. Degrade
      // to an empty index so cards render the fetcher_pending hint instead of
      // an error state.
      usageEndpointUnavailable = true;
      const index = emptyUsageIndex();
      usageIndexCache = { fetchedAt: Date.now(), index };
      return index;
    }
  })();

  try {
    return await usageIndexInFlight;
  } finally {
    usageIndexInFlight = null;
  }
};

export const isUsageEndpointUnavailable = (): boolean => usageEndpointUnavailable;
