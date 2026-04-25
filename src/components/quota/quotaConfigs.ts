/**
 * Quota configuration definitions.
 */

import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaGroup,
  AntigravityModelsPayload,
  AntigravityQuotaState,
  AuthFileItem,
  CodexQuotaState,
  CodexUsageWindow,
  CodexQuotaWindow,
  CodexUsagePayload,
  CursorQuotaState,
  CursorUsageSummary,
  GeminiCliParsedBucket,
  GeminiCliQuotaBucketState,
  GeminiCliQuotaState,
  ZenQuotaState,
  ZenUsageSummary
} from '@/types';
import { apiCallApi, authFilesApi, getApiCallErrorMessage, usageApi } from '@/services/api';
import { buildCandidateUsageSourceIds, normalizeUsageSourceId } from '@/utils/usage';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  normalizeAuthIndexValue,
  normalizeNumberValue,
  normalizePlanType,
  normalizeQuotaFraction,
  normalizeStringValue,
  parseAntigravityPayload,
  parseCodexUsagePayload,
  parseGeminiCliQuotaPayload,
  extractCodexChatgptAccountId,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveGeminiCliProjectId,
  formatCodexResetLabel,
  formatQuotaResetTime,
  buildAntigravityQuotaGroups,
  buildGeminiCliQuotaBuckets,
  createStatusError,
  getStatusFromError,
  isAntigravityFile,
  isCodexFile,
  isCursorFile,
  isGeminiCliFile,
  isZenFile,
  isRuntimeOnlyAuthFile
} from '@/utils/quota';
import type { QuotaRenderHelpers } from './QuotaCard';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaType = 'antigravity' | 'codex' | 'gemini-cli' | 'cursor' | 'opencode-go';

const DEFAULT_ANTIGRAVITY_PROJECT_ID = 'bamboo-precept-lgxtn';

export interface QuotaStore {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  cursorQuota: Record<string, CursorQuotaState>;
  zenQuota: Record<string, ZenQuotaState>;
  antigravityQuotaLastUpdatedAt: number | null;
  codexQuotaLastUpdatedAt: number | null;
  geminiCliQuotaLastUpdatedAt: number | null;
  cursorQuotaLastUpdatedAt: number | null;
  zenQuotaLastUpdatedAt: number | null;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setCursorQuota: (updater: QuotaUpdater<Record<string, CursorQuotaState>>) => void;
  setZenQuota: (updater: QuotaUpdater<Record<string, ZenQuotaState>>) => void;
  setAntigravityQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setCodexQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setGeminiCliQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setCursorQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setZenQuotaLastUpdatedAt: (timestamp: number | null) => void;
  clearQuotaCache: () => void;
}

type LastUpdatedAtSetterKey = {
  [K in keyof QuotaStore]: QuotaStore[K] extends (timestamp: number | null) => void ? K : never;
}[keyof QuotaStore];

export interface QuotaConfig<TState, TData> {
  type: QuotaType;
  i18nPrefix: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  storeSelector: (state: QuotaStore) => Record<string, TState>;
  storeSetter: keyof QuotaStore;
  storeLastUpdatedAtSelector: (state: QuotaStore) => number | null;
  storeLastUpdatedAtSetter: LastUpdatedAtSetterKey;
  buildLoadingState: () => TState;
  buildSuccessState: (data: TData) => TState;
  buildErrorState: (message: string, status?: number) => TState;
  cardClassName: string;
  controlsClassName: string;
  controlClassName: string;
  gridClassName: string;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return DEFAULT_ANTIGRAVITY_PROJECT_ID;

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topLevel = normalizeStringValue(parsed.project_id ?? parsed.projectId);
    if (topLevel) return topLevel;

    const installed =
      parsed.installed && typeof parsed.installed === 'object' && parsed.installed !== null
        ? (parsed.installed as Record<string, unknown>)
        : null;
    const installedProjectId = installed
      ? normalizeStringValue(installed.project_id ?? installed.projectId)
      : null;
    if (installedProjectId) return installedProjectId;

    const web =
      parsed.web && typeof parsed.web === 'object' && parsed.web !== null
        ? (parsed.web as Record<string, unknown>)
        : null;
    const webProjectId = web ? normalizeStringValue(web.project_id ?? web.projectId) : null;
    if (webProjectId) return webProjectId;
  } catch {
    return DEFAULT_ANTIGRAVITY_PROJECT_ID;
  }

  return DEFAULT_ANTIGRAVITY_PROJECT_ID;
};

const isAntigravityUnknownFieldError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes('unknown name') && normalized.includes('cannot find field');
};

const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaGroup[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndexValue(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  const requestBodies = [JSON.stringify({ projectId }), JSON.stringify({ project: projectId })];

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    for (let attempt = 0; attempt < requestBodies.length; attempt++) {
      try {
        const result = await apiCallApi.request({
          authIndex,
          method: 'POST',
          url,
          header: { ...ANTIGRAVITY_REQUEST_HEADERS },
          data: requestBodies[attempt]
        });

        if (result.statusCode < 200 || result.statusCode >= 300) {
          lastError = getApiCallErrorMessage(result);
          lastStatus = result.statusCode;
          if (result.statusCode === 403 || result.statusCode === 404) {
            priorityStatus ??= result.statusCode;
          }
          if (
            result.statusCode === 400 &&
            isAntigravityUnknownFieldError(lastError) &&
            attempt < requestBodies.length - 1
          ) {
            continue;
          }
          break;
        }

        hadSuccess = true;
        const payload = parseAntigravityPayload(result.body ?? result.bodyText);
        const models = payload?.models;
        if (!models || typeof models !== 'object' || Array.isArray(models)) {
          lastError = t('antigravity_quota.empty_models');
          continue;
        }

        const groups = buildAntigravityQuotaGroups(models as AntigravityModelsPayload);
        if (groups.length === 0) {
          lastError = t('antigravity_quota.empty_models');
          continue;
        }

        return groups;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        if (status) {
          lastStatus = status;
          if (status === 403 || status === 404) {
            priorityStatus ??= status;
          }
        }
      }
    }
  }

  if (hadSuccess) {
    return [];
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};

const buildCodexQuotaWindows = (payload: CodexUsagePayload, t: TFunction): CodexQuotaWindow[] => {
  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit = payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const windows: CodexQuotaWindow[] = [];

  const addWindow = (
    id: string,
    labelKey: string,
    window?: CodexUsageWindow | null,
    limitReached?: boolean,
    allowed?: boolean
  ) => {
    if (!window) return;
    const resetLabel = formatCodexResetLabel(window);
    const usedPercentRaw = normalizeNumberValue(window.used_percent ?? window.usedPercent);
    const isLimitReached = Boolean(limitReached) || allowed === false;
    const usedPercent = usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel
    });
  };

  addWindow(
    'primary',
    'codex_quota.primary_window',
    rateLimit?.primary_window ?? rateLimit?.primaryWindow,
    rateLimit?.limit_reached ?? rateLimit?.limitReached,
    rateLimit?.allowed
  );
  addWindow(
    'secondary',
    'codex_quota.secondary_window',
    rateLimit?.secondary_window ?? rateLimit?.secondaryWindow,
    rateLimit?.limit_reached ?? rateLimit?.limitReached,
    rateLimit?.allowed
  );
  addWindow(
    'code-review',
    'codex_quota.code_review_window',
    codeReviewLimit?.primary_window ?? codeReviewLimit?.primaryWindow,
    codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached,
    codeReviewLimit?.allowed
  );

  return windows;
};

const resolveCodexChatgptAccountIdFromFile = async (file: AuthFileItem): Promise<string | null> => {
  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return null;

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const metadata =
      parsed.metadata && typeof parsed.metadata === 'object' && parsed.metadata !== null
        ? (parsed.metadata as Record<string, unknown>)
        : null;
    const attributes =
      parsed.attributes && typeof parsed.attributes === 'object' && parsed.attributes !== null
        ? (parsed.attributes as Record<string, unknown>)
        : null;

    const candidates: unknown[] = [
      parsed.chatgpt_account_id,
      parsed.chatgptAccountId,
      parsed.id_token,
      parsed.idToken,
      metadata?.chatgpt_account_id,
      metadata?.chatgptAccountId,
      metadata?.id_token,
      metadata?.idToken,
      attributes?.chatgpt_account_id,
      attributes?.chatgptAccountId,
      attributes?.id_token,
      attributes?.idToken
    ];

    for (const candidate of candidates) {
      const extracted = extractCodexChatgptAccountId(candidate);
      if (extracted) return extracted;

      const direct = normalizeStringValue(candidate);
      if (direct && !direct.includes('.')) return direct;
    }
  } catch {
    return null;
  }

  return null;
};

const fetchCodexQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{ planType: string | null; windows: CodexQuotaWindow[] }> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndexValue(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const planTypeFromFile = resolveCodexPlanType(file);
  let accountId = resolveCodexChatgptAccountId(file);
  if (!accountId) {
    accountId = await resolveCodexChatgptAccountIdFromFile(file);
  }
  if (!accountId) {
    throw new Error(t('codex_quota.missing_account_id'));
  }

  const requestHeader: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
    'Chatgpt-Account-Id': accountId
  };

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CODEX_USAGE_URL,
    header: requestHeader
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('codex_quota.empty_windows'));
  }

  const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
  const windows = buildCodexQuotaWindows(payload, t);
  return { planType: planTypeFromUsage ?? planTypeFromFile, windows };
};

const fetchGeminiCliQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<GeminiCliQuotaBucketState[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndexValue(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('gemini_cli_quota.missing_auth_index'));
  }

  const projectId = resolveGeminiCliProjectId(file);
  if (!projectId) {
    throw new Error(t('gemini_cli_quota.missing_project_id'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: GEMINI_CLI_QUOTA_URL,
    header: { ...GEMINI_CLI_REQUEST_HEADERS },
    data: JSON.stringify({ project: projectId })
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseGeminiCliQuotaPayload(result.body ?? result.bodyText);
  const buckets = Array.isArray(payload?.buckets) ? payload?.buckets : [];
  if (buckets.length === 0) return [];

  const parsedBuckets = buckets
    .map((bucket) => {
      const modelId = normalizeStringValue(bucket.modelId ?? bucket.model_id);
      if (!modelId) return null;
      const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type);
      const remainingFractionRaw = normalizeQuotaFraction(
        bucket.remainingFraction ?? bucket.remaining_fraction
      );
      const remainingAmount = normalizeNumberValue(bucket.remainingAmount ?? bucket.remaining_amount);
      const resetTime = normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined;
      let fallbackFraction: number | null = null;
      if (remainingAmount !== null) {
        fallbackFraction = remainingAmount <= 0 ? 0 : null;
      } else if (resetTime) {
        fallbackFraction = 0;
      }
      const remainingFraction = remainingFractionRaw ?? fallbackFraction;
      return {
        modelId,
        tokenType,
        remainingFraction,
        remainingAmount,
        resetTime
      };
    })
    .filter((bucket): bucket is GeminiCliParsedBucket => bucket !== null);

  return buildGeminiCliQuotaBuckets(parsedBuckets);
};

const emptyCursorSummary = (): CursorUsageSummary => ({
  requests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
  modelCount: 0,
  tokenTelemetryCount: 0
});

interface CursorUsageAccumulator {
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  tokenTelemetryCount: number;
  modelNames: Set<string>;
  lastSeenMillis: number | null;
}

interface CursorUsageIndex {
  byAuthIndex: Map<string, CursorUsageSummary>;
  byAuthId: Map<string, CursorUsageSummary>;
  bySource: Map<string, CursorUsageSummary>;
}

const CURSOR_USAGE_CACHE_TTL_MS = 1500;
let cursorUsageIndexCache: { fetchedAt: number; index: CursorUsageIndex } | null = null;
let cursorUsageIndexInFlight: Promise<CursorUsageIndex> | null = null;

const createCursorUsageAccumulator = (): CursorUsageAccumulator => ({
  requests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
  tokenTelemetryCount: 0,
  modelNames: new Set<string>(),
  lastSeenMillis: null
});

const cloneCursorSummary = (summary: CursorUsageSummary): CursorUsageSummary => ({ ...summary });

const mergeCursorSummary = (
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
    lastSeenAt:
      base.lastSeenAt && patch.lastSeenAt
        ? (Date.parse(base.lastSeenAt) >= Date.parse(patch.lastSeenAt) ? base.lastSeenAt : patch.lastSeenAt)
        : base.lastSeenAt ?? patch.lastSeenAt
  };
};

const upsertCursorUsageAccumulator = (
  map: Map<string, CursorUsageAccumulator>,
  key: string,
  model: string,
  detail: Record<string, unknown>
) => {
  const normalizedKey = normalizeStringValue(key);
  if (!normalizedKey) return;

  const current = map.get(normalizedKey) ?? createCursorUsageAccumulator();
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

  const millis = parseTimestamp(detail.timestamp);
  if (millis !== null && (current.lastSeenMillis === null || millis > current.lastSeenMillis)) {
    current.lastSeenMillis = millis;
  }
  map.set(normalizedKey, current);
};

const finalizeCursorUsageMap = (
  map: Map<string, CursorUsageAccumulator>
): Map<string, CursorUsageSummary> => {
  const out = new Map<string, CursorUsageSummary>();
  map.forEach((acc, key) => {
    out.set(key, {
      requests: acc.requests,
      successCount: acc.successCount,
      failureCount: acc.failureCount,
      totalTokens: acc.totalTokens,
      modelCount: acc.modelNames.size,
      tokenTelemetryCount: acc.tokenTelemetryCount,
      lastSeenAt: acc.lastSeenMillis !== null ? new Date(acc.lastSeenMillis).toISOString() : undefined
    });
  });
  return out;
};

const buildCursorUsageIndex = (usageRoot: Record<string, unknown>): CursorUsageIndex => {
  const apis =
    usageRoot && typeof usageRoot.apis === 'object' && usageRoot.apis !== null
      ? (usageRoot.apis as Record<string, unknown>)
      : {};

  const byAuthIndexAcc = new Map<string, CursorUsageAccumulator>();
  const byAuthIdAcc = new Map<string, CursorUsageAccumulator>();
  const bySourceAcc = new Map<string, CursorUsageAccumulator>();

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
        const detailAuthIndex = normalizeAuthIndexValue(detail.auth_index ?? detail.authIndex);
        const detailAuthId = normalizeStringValue(detail.auth_id ?? detail.authId);
        const detailSource = normalizeUsageSourceId(detail.source);

        if (detailAuthIndex) {
          upsertCursorUsageAccumulator(byAuthIndexAcc, detailAuthIndex, modelKey, detail);
        }
        if (detailAuthId) {
          upsertCursorUsageAccumulator(byAuthIdAcc, detailAuthId, modelKey, detail);
        }
        if (detailSource) {
          upsertCursorUsageAccumulator(bySourceAcc, detailSource, modelKey, detail);
        }
      }
    }
  }

  return {
    byAuthIndex: finalizeCursorUsageMap(byAuthIndexAcc),
    byAuthId: finalizeCursorUsageMap(byAuthIdAcc),
    bySource: finalizeCursorUsageMap(bySourceAcc)
  };
};

const loadCursorUsageIndex = async (): Promise<CursorUsageIndex> => {
  const now = Date.now();
  if (cursorUsageIndexCache && now - cursorUsageIndexCache.fetchedAt < CURSOR_USAGE_CACHE_TTL_MS) {
    return cursorUsageIndexCache.index;
  }
  if (cursorUsageIndexInFlight) {
    return cursorUsageIndexInFlight;
  }

  cursorUsageIndexInFlight = (async () => {
    const response = await usageApi.getUsage();
    const usageRoot = (response?.usage ?? response) as Record<string, unknown>;
    const index = buildCursorUsageIndex(usageRoot);
    cursorUsageIndexCache = { fetchedAt: Date.now(), index };
    return index;
  })();

  try {
    return await cursorUsageIndexInFlight;
  } finally {
    cursorUsageIndexInFlight = null;
  }
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

const fetchCursorQuota = async (file: AuthFileItem, t: TFunction): Promise<CursorUsageSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndexValue(rawAuthIndex);
  const authIds = [
    normalizeStringValue(file.id),
    normalizeStringValue(file.name)
  ].filter((value): value is string => Boolean(value));
  if (!authIndex && authIds.length === 0) {
    throw new Error(t('cursor_quota.missing_auth_index'));
  }

  const usageIndex = await loadCursorUsageIndex();
  let summary = emptyCursorSummary();

  if (authIndex) {
    summary = mergeCursorSummary(summary, usageIndex.byAuthIndex.get(authIndex));
  }

  if (summary.requests === 0 && authIds.length > 0) {
    for (const authId of authIds) {
      const byAuthIdSummary = usageIndex.byAuthId.get(authId);
      if (!byAuthIdSummary) continue;
      summary = mergeCursorSummary(summary, byAuthIdSummary);
      if (summary.requests > 0) break;
    }
  }

  return cloneCursorSummary(summary);
};

const fetchZenQuota = async (file: AuthFileItem, t: TFunction): Promise<ZenUsageSummary> => {
  const apiKey = normalizeStringValue(file.apiKey ?? file.api_key);
  const prefix = normalizeStringValue(file.prefix);
  const sourceIds = new Set<string>();

  buildCandidateUsageSourceIds({
    apiKey: apiKey ?? undefined,
    prefix: prefix ?? undefined
  }).forEach((id) => sourceIds.add(id));
  if (apiKey) {
    sourceIds.add(normalizeUsageSourceId(apiKey));
  }
  if (prefix) {
    sourceIds.add(normalizeUsageSourceId(prefix));
  }

  if (sourceIds.size === 0) {
    throw new Error(t('zen_quota.missing_api_key'));
  }

  const usageIndex = await loadCursorUsageIndex();
  let summary = emptyCursorSummary();
  sourceIds.forEach((sourceId) => {
    summary = mergeCursorSummary(summary, usageIndex.bySource.get(sourceId));
  });

  return cloneCursorSummary(summary);
};

const renderAntigravityItems = (
  quota: AntigravityQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const groups = quota.groups ?? [];

  if (groups.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('antigravity_quota.empty_models'));
  }

  return groups.map((group) => {
    const clamped = Math.max(0, Math.min(1, group.remainingFraction));
    const percent = Math.round(clamped * 100);
    const resetLabel = formatQuotaResetTime(group.resetTime);

    return h(
      'div',
      { key: group.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h(
          'span',
          { className: styleMap.quotaModel, title: group.models.join(', ') },
          group.label
        ),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, `${percent}%`),
          h('span', { className: styleMap.quotaReset }, resetLabel)
        )
      ),
      h(QuotaProgressBar, { percent, highThreshold: 60, mediumThreshold: 20 })
    );
  });
};

const renderCodexItems = (
  quota: CodexQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const planType = quota.planType ?? null;

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const isFreePlan = normalizePlanType(planType) === 'free';
  const nodes: ReactNode[] = [];

  if (planLabel) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('codex_quota.plan_label')),
        h('span', { className: styleMap.codexPlanValue }, planLabel)
      )
    );
  }

  if (isFreePlan) {
    nodes.push(
      h(
        'div',
        { key: 'warning', className: styleMap.quotaWarning },
        t('codex_quota.no_access')
      )
    );
    return h(Fragment, null, ...nodes);
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('codex_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...windows.map((window) => {
      const used = window.usedPercent;
      const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
      const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
      const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
      const windowLabel = window.labelKey ? t(window.labelKey) : window.label;

      return h(
        'div',
        { key: window.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, windowLabel),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            h('span', { className: styleMap.quotaReset }, window.resetLabel)
          )
        ),
        h(QuotaProgressBar, { percent: remaining, highThreshold: 80, mediumThreshold: 50 })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const renderGeminiCliItems = (
  quota: GeminiCliQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const buckets = quota.buckets ?? [];

  if (buckets.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('gemini_cli_quota.empty_buckets'));
  }

  return buckets.map((bucket) => {
    const fraction = bucket.remainingFraction;
    const clamped = fraction === null ? null : Math.max(0, Math.min(1, fraction));
    const percent = clamped === null ? null : Math.round(clamped * 100);
    const percentLabel = percent === null ? '--' : `${percent}%`;
    const remainingAmountLabel =
      bucket.remainingAmount === null || bucket.remainingAmount === undefined
        ? null
        : t('gemini_cli_quota.remaining_amount', {
            count: bucket.remainingAmount
          });
    const titleBase =
      bucket.modelIds && bucket.modelIds.length > 0 ? bucket.modelIds.join(', ') : bucket.label;
    const title = bucket.tokenType ? `${titleBase} (${bucket.tokenType})` : titleBase;

    const resetLabel = formatQuotaResetTime(bucket.resetTime);

    return h(
      'div',
      { key: bucket.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel, title }, bucket.label),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, percentLabel),
          remainingAmountLabel
            ? h('span', { className: styleMap.quotaAmount }, remainingAmountLabel)
            : null,
          h('span', { className: styleMap.quotaReset }, resetLabel)
        )
      ),
      h(QuotaProgressBar, { percent, highThreshold: 60, mediumThreshold: 20 })
    );
  });
};

const renderCursorItems = (
  quota: CursorQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const summary = quota.summary ?? emptyCursorSummary();
  const hasTelemetry = summary.requests > 0;
  const hasTokenTelemetry = (summary.tokenTelemetryCount ?? 0) > 0;
  const successPct = hasTelemetry ? Math.round((summary.successCount / summary.requests) * 100) : 0;
  const lastSeenLabel = summary.lastSeenAt
    ? formatQuotaResetTime(summary.lastSeenAt)
    : t('cursor_quota.last_seen_never');

  return h(
    Fragment,
    null,
    h(
      'div',
      { className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, t('cursor_quota.health_label')),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, `${successPct}%`),
          h('span', { className: styleMap.quotaReset }, lastSeenLabel)
        )
      ),
      h(QuotaProgressBar, { percent: successPct, highThreshold: 80, mediumThreshold: 50 })
    ),
    h(
      'div',
      { className: styleMap.quotaMeta, style: { marginTop: '0.5rem' } },
      h(
        'span',
        { className: styleMap.quotaAmount },
        t('cursor_quota.requests_value', { count: summary.requests })
      ),
      h(
        'span',
        { className: styleMap.quotaAmount },
        t('cursor_quota.failures_value', { count: summary.failureCount })
      ),
      h(
        'span',
        { className: styleMap.quotaAmount },
        hasTokenTelemetry
          ? t('cursor_quota.tokens_value', { count: summary.totalTokens })
          : t('cursor_quota.tokens_unavailable')
      ),
      h(
        'span',
        { className: styleMap.quotaAmount },
        t('cursor_quota.models_value', { count: summary.modelCount })
      )
    ),
    h(
      'div',
      { className: styleMap.quotaMessage, style: { marginTop: '0.5rem' } },
      hasTelemetry ? t('cursor_quota.telemetry_note') : t('cursor_quota.empty_usage')
    )
  );
};

const renderZenItems = (
  quota: ZenQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const summary = quota.summary ?? emptyCursorSummary();
  const hasTelemetry = summary.requests > 0;
  const hasTokenTelemetry = (summary.tokenTelemetryCount ?? 0) > 0;
  const successPct = hasTelemetry ? Math.round((summary.successCount / summary.requests) * 100) : 0;
  const lastSeenLabel = summary.lastSeenAt
    ? formatQuotaResetTime(summary.lastSeenAt)
    : t('zen_quota.last_seen_never');

  return h(
    Fragment,
    null,
    h(
      'div',
      { className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, t('zen_quota.health_label')),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, `${successPct}%`),
          h('span', { className: styleMap.quotaReset }, lastSeenLabel)
        )
      ),
      h(QuotaProgressBar, { percent: successPct, highThreshold: 80, mediumThreshold: 50 })
    ),
    h(
      'div',
      { className: styleMap.quotaMeta, style: { marginTop: '0.5rem' } },
      h(
        'span',
        { className: styleMap.quotaAmount },
        t('zen_quota.requests_value', { count: summary.requests })
      ),
      h(
        'span',
        { className: styleMap.quotaAmount },
        t('zen_quota.failures_value', { count: summary.failureCount })
      ),
      h(
        'span',
        { className: styleMap.quotaAmount },
        hasTokenTelemetry
          ? t('zen_quota.tokens_value', { count: summary.totalTokens })
          : t('zen_quota.tokens_unavailable')
      ),
      h(
        'span',
        { className: styleMap.quotaAmount },
        t('zen_quota.models_value', { count: summary.modelCount })
      )
    ),
    h(
      'div',
      { className: styleMap.quotaMessage, style: { marginTop: '0.5rem' } },
      hasTelemetry ? t('zen_quota.telemetry_note') : t('zen_quota.empty_usage')
    )
  );
};

export const ANTIGRAVITY_CONFIG: QuotaConfig<AntigravityQuotaState, AntigravityQuotaGroup[]> = {
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  filterFn: (file) => isAntigravityFile(file),
  fetchQuota: fetchAntigravityQuota,
  storeSelector: (state) => state.antigravityQuota,
  storeSetter: 'setAntigravityQuota',
  storeLastUpdatedAtSelector: (state) => state.antigravityQuotaLastUpdatedAt,
  storeLastUpdatedAtSetter: 'setAntigravityQuotaLastUpdatedAt',
  buildLoadingState: () => ({ status: 'loading', groups: [] }),
  buildSuccessState: (groups) => ({ status: 'success', groups }),
  buildErrorState: (message, status) => ({
    status: 'error',
    groups: [],
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.antigravityCard,
  controlsClassName: styles.antigravityControls,
  controlClassName: styles.antigravityControl,
  gridClassName: styles.antigravityGrid,
  renderQuotaItems: renderAntigravityItems
};

export const CODEX_CONFIG: QuotaConfig<
  CodexQuotaState,
  { planType: string | null; windows: CodexQuotaWindow[] }
> = {
  type: 'codex',
  i18nPrefix: 'codex_quota',
  filterFn: (file) => isCodexFile(file),
  fetchQuota: fetchCodexQuota,
  storeSelector: (state) => state.codexQuota,
  storeSetter: 'setCodexQuota',
  storeLastUpdatedAtSelector: (state) => state.codexQuotaLastUpdatedAt,
  storeLastUpdatedAtSetter: 'setCodexQuotaLastUpdatedAt',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    planType: data.planType
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.codexCard,
  controlsClassName: styles.codexControls,
  controlClassName: styles.codexControl,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCodexItems
};

export const GEMINI_CLI_CONFIG: QuotaConfig<GeminiCliQuotaState, GeminiCliQuotaBucketState[]> = {
  type: 'gemini-cli',
  i18nPrefix: 'gemini_cli_quota',
  filterFn: (file) => isGeminiCliFile(file) && !isRuntimeOnlyAuthFile(file),
  fetchQuota: fetchGeminiCliQuota,
  storeSelector: (state) => state.geminiCliQuota,
  storeSetter: 'setGeminiCliQuota',
  storeLastUpdatedAtSelector: (state) => state.geminiCliQuotaLastUpdatedAt,
  storeLastUpdatedAtSetter: 'setGeminiCliQuotaLastUpdatedAt',
  buildLoadingState: () => ({ status: 'loading', buckets: [] }),
  buildSuccessState: (buckets) => ({ status: 'success', buckets }),
  buildErrorState: (message, status) => ({
    status: 'error',
    buckets: [],
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.geminiCliCard,
  controlsClassName: styles.geminiCliControls,
  controlClassName: styles.geminiCliControl,
  gridClassName: styles.geminiCliGrid,
  renderQuotaItems: renderGeminiCliItems
};

export const CURSOR_CONFIG: QuotaConfig<CursorQuotaState, CursorUsageSummary> = {
  type: 'cursor',
  i18nPrefix: 'cursor_quota',
  filterFn: (file) => isCursorFile(file) && !isRuntimeOnlyAuthFile(file),
  fetchQuota: fetchCursorQuota,
  storeSelector: (state) => state.cursorQuota,
  storeSetter: 'setCursorQuota',
  storeLastUpdatedAtSelector: (state) => state.cursorQuotaLastUpdatedAt,
  storeLastUpdatedAtSetter: 'setCursorQuotaLastUpdatedAt',
  buildLoadingState: () => ({ status: 'loading', summary: emptyCursorSummary() }),
  buildSuccessState: (summary) => ({ status: 'success', summary }),
  buildErrorState: (message, status) => ({
    status: 'error',
    summary: emptyCursorSummary(),
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.codexCard,
  controlsClassName: styles.codexControls,
  controlClassName: styles.codexControl,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCursorItems
};

export const ZEN_CONFIG: QuotaConfig<ZenQuotaState, ZenUsageSummary> = {
  type: 'opencode-go',
  i18nPrefix: 'zen_quota',
  filterFn: (file) => isZenFile(file),
  fetchQuota: fetchZenQuota,
  storeSelector: (state) => state.zenQuota,
  storeSetter: 'setZenQuota',
  storeLastUpdatedAtSelector: (state) => state.zenQuotaLastUpdatedAt,
  storeLastUpdatedAtSetter: 'setZenQuotaLastUpdatedAt',
  buildLoadingState: () => ({ status: 'loading', summary: emptyCursorSummary() }),
  buildSuccessState: (summary) => ({ status: 'success', summary }),
  buildErrorState: (message, status) => ({
    status: 'error',
    summary: emptyCursorSummary(),
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.codexCard,
  controlsClassName: styles.codexControls,
  controlClassName: styles.codexControl,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderZenItems
};
