/**
 * Quota configuration definitions.
 */

import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaSubscription,
  AntigravityQuotaSummaryPayload,
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  ClaudeUsagePayload,
  CodexRateLimitInfo,
  CodexRateLimitResetCredit,
  CodexQuotaState,
  CodexUsageWindow,
  CodexQuotaWindow,
  CodexUsagePayload,
  CursorModelUsageSummary,
  CursorQuotaState,
  CursorUsageSummary,
  KimiQuotaRow,
  KimiQuotaState,
  XaiBillingSummary,
  XaiQuotaState,
  ZenQuotaState,
  ZenUsageSummary,
} from '@/types';
import {
  antigravitySubscriptionApi,
  apiCallApi,
  authFilesApi,
  getApiCallErrorMessage,
  usageApi,
  type AntigravitySubscriptionSummary,
} from '@/services/api';
import { buildCandidateUsageSourceIds, normalizeUsageSourceId } from '@/utils/usage';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_WINDOW_KEYS,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  XAI_API_CHAT_URL,
  XAI_API_ME_URL,
  XAI_API_REQUEST_HEADERS,
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
  XAI_PAID_HEALTH_MODEL,
  XAI_REQUEST_HEADERS,
  normalizeNumberValue,
  normalizePlanType,
  normalizeStringValue,
  normalizeCodexResetCreditsPayload,
  parseAntigravityPayload,
  parseClaudeUsagePayload,
  parseCodexUsagePayload,
  parseKimiUsagePayload,
  parseXaiBillingPayload,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveCodexSubscriptionActiveUntil,
  formatCodexResetLabel,
  formatQuotaResetTime,
  formatKimiResetHint,
  buildAntigravityQuotaGroups,
  buildKimiQuotaRows,
  buildXaiBillingSummary,
  buildXaiPaidHealthSummary,
  mergeXaiBillingSummaries,
  createStatusError,
  formatShanghaiDateTime,
  getStatusFromError,
  isAntigravityFile,
  isClaudeFile,
  isCodexFile,
  isCursorFile,
  isDisabledAuthFile,
  isKimiFile,
  isPaidXaiAuthFile,
  isXaiFile,
  isZenFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { formatDateTimeValue } from '@/utils/format';
import type { QuotaRenderHelpers } from './QuotaCard';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaType = 'antigravity' | 'claude' | 'codex' | 'cursor' | 'kimi' | 'opencode-go' | 'xai';

type AntigravityQuotaData = {
  groups: AntigravityQuotaGroup[];
  subscription: AntigravityQuotaSubscription | null;
  serverTimeOffsetMs: number | null;
};

type CodexResetCreditsData = {
  availableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  error: string;
};

type CodexQuotaData = {
  planType: string | null;
  subscriptionActiveUntil: string | number | null;
  rateLimitResetCreditsAvailableCount: number | null;
  rateLimitResetCredits: CodexRateLimitResetCredit[];
  rateLimitResetCreditsError: string;
  windows: CodexQuotaWindow[];
};

const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;
const CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS = 8000;
const XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS = 15000;

export interface QuotaStore {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  cursorQuota: Record<string, CursorQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  zenQuota: Record<string, ZenQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setCursorQuota: (updater: QuotaUpdater<Record<string, CursorQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  setZenQuota: (updater: QuotaUpdater<Record<string, ZenQuotaState>>) => void;
  clearQuotaCache: () => void;
}

export interface QuotaConfig<TState, TData> {
  type: QuotaType;
  i18nPrefix: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  canResetQuota?: (quota: TState) => boolean;
  storeSelector: (state: QuotaStore) => Record<string, TState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: () => TState;
  buildSuccessState: (data: TData) => TState;
  buildErrorState: (message: string, status?: number) => TState;
  cardClassName: string;
  gridClassName: string;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  const directProjectId = normalizeStringValue(file.project_id ?? file.projectId);
  if (directProjectId) return directProjectId;

  const metadata =
    file.metadata && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const metadataProjectId = metadata
    ? normalizeStringValue(metadata.project_id ?? metadata.projectId)
    : null;
  if (metadataProjectId) return metadataProjectId;

  const attributes =
    file.attributes && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const attributesProjectId = attributes
    ? normalizeStringValue(
        attributes.project_id ?? attributes.projectId ?? attributes.gemini_virtual_project
      )
    : null;
  if (attributesProjectId) return attributesProjectId;

  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return '';

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
    return '';
  }

  return '';
};

const resolveResponseServerTimeOffsetMs = (
  header: Record<string, string[]> | undefined
): number | null => {
  if (!header) return null;
  const dateEntry = Object.entries(header).find(([key]) => key.toLowerCase() === 'date');
  const rawDate = dateEntry?.[1]?.[0];
  if (!rawDate) return null;
  const serverTime = new Date(rawDate).getTime();
  if (Number.isNaN(serverTime)) return null;
  return serverTime - Date.now();
};

const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  if (!projectId) {
    throw new Error(t('antigravity_quota.missing_project_id'));
  }
  const requestBody = JSON.stringify({ project: projectId });
  const subscriptionPromise = antigravitySubscriptionApi
    .get(authIndex)
    .then(toAntigravityQuotaSubscription)
    .catch(() => null);

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: requestBody,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        lastError = getApiCallErrorMessage(result);
        lastStatus = result.statusCode;
        if (result.statusCode === 403 || result.statusCode === 404) {
          priorityStatus ??= result.statusCode;
        }
        continue;
      }

      hadSuccess = true;
      const payload = parseAntigravityPayload(
        result.body ?? result.bodyText
      ) as AntigravityQuotaSummaryPayload | null;
      if (!payload || !Array.isArray(payload.groups)) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      const groups = buildAntigravityQuotaGroups(payload);
      if (groups.length === 0) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      return {
        groups,
        subscription: await subscriptionPromise,
        serverTimeOffsetMs: resolveResponseServerTimeOffsetMs(result.header),
      };
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

  if (hadSuccess) {
    return { groups: [], subscription: await subscriptionPromise, serverTimeOffsetMs: null };
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};

const toAntigravityQuotaSubscription = (
  summary: AntigravitySubscriptionSummary | null
): AntigravityQuotaSubscription | null => {
  if (!summary) return null;
  return {
    plan: summary.plan,
    tierName: summary.tierName,
    tierId: summary.tierId,
  };
};

const buildCodexQuotaWindows = (payload: CodexUsagePayload, t: TFunction): CodexQuotaWindow[] => {
  const FIVE_HOUR_SECONDS = 18000;
  const WEEK_SECONDS = 604800;
  const MIN_MONTH_SECONDS = 28 * 24 * 60 * 60;
  const MAX_MONTH_SECONDS = 31 * 24 * 60 * 60;
  const WINDOW_META = {
    codeFiveHour: { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
    codeWeekly: { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
    codeMonthly: { id: 'monthly', labelKey: 'codex_quota.team_secondary_window' },
    codeReviewFiveHour: {
      id: 'code-review-five-hour',
      labelKey: 'codex_quota.code_review_primary_window',
    },
    codeReviewWeekly: {
      id: 'code-review-weekly',
      labelKey: 'codex_quota.code_review_secondary_window',
    },
    codeReviewMonthly: {
      id: 'code-review-monthly',
      labelKey: 'codex_quota.code_review_team_secondary_window',
    },
  } as const;

  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit =
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits ?? [];
  const windows: CodexQuotaWindow[] = [];

  const addWindow = (
    id: string,
    label: string,
    labelKey: string | undefined,
    labelParams: Record<string, string | number> | undefined,
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
      label,
      labelKey,
      labelParams,
      usedPercent,
      resetLabel,
    });
  };

  const getWindowSeconds = (window?: CodexUsageWindow | null): number | null => {
    if (!window) return null;
    return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
  };

  const isMonthlyWindow = (window?: CodexUsageWindow | null): boolean => {
    const seconds = getWindowSeconds(window);
    return seconds !== null && seconds >= MIN_MONTH_SECONDS && seconds <= MAX_MONTH_SECONDS;
  };

  const selectSecondaryWindowMeta = <
    TWeekly extends { id: string; labelKey: string },
    TMonthly extends { id: string; labelKey: string },
  >(
    window: CodexUsageWindow | null | undefined,
    weeklyMeta: TWeekly,
    monthlyMeta: TMonthly
  ): TWeekly | TMonthly => (isMonthlyWindow(window) ? monthlyMeta : weeklyMeta);

  const rawLimitReached = rateLimit?.limit_reached ?? rateLimit?.limitReached;
  const rawAllowed = rateLimit?.allowed;

  const pickClassifiedWindows = (
    limitInfo?: CodexRateLimitInfo | null,
    options?: { allowOrderFallback?: boolean }
  ): { fiveHourWindow: CodexUsageWindow | null; weeklyWindow: CodexUsageWindow | null } => {
    const allowOrderFallback = options?.allowOrderFallback ?? true;
    const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
    const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
    const rawWindows = [primaryWindow, secondaryWindow];

    let fiveHourWindow: CodexUsageWindow | null = null;
    let weeklyWindow: CodexUsageWindow | null = null;

    for (const window of rawWindows) {
      if (!window) continue;
      const seconds = getWindowSeconds(window);
      if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
        fiveHourWindow = window;
      } else if ((seconds === WEEK_SECONDS || isMonthlyWindow(window)) && !weeklyWindow) {
        weeklyWindow = window;
      }
    }

    // For legacy payloads without window duration, fallback to primary/secondary ordering.
    if (allowOrderFallback) {
      if (!fiveHourWindow) {
        fiveHourWindow = primaryWindow && primaryWindow !== weeklyWindow ? primaryWindow : null;
      }
      if (!weeklyWindow) {
        weeklyWindow =
          secondaryWindow && secondaryWindow !== fiveHourWindow ? secondaryWindow : null;
      }
    }

    return { fiveHourWindow, weeklyWindow };
  };

  const rateWindows = pickClassifiedWindows(rateLimit);
  addWindow(
    WINDOW_META.codeFiveHour.id,
    t(WINDOW_META.codeFiveHour.labelKey),
    WINDOW_META.codeFiveHour.labelKey,
    undefined,
    rateWindows.fiveHourWindow,
    rawLimitReached,
    rawAllowed
  );
  const codeSecondaryWindowMeta = selectSecondaryWindowMeta(
    rateWindows.weeklyWindow,
    WINDOW_META.codeWeekly,
    WINDOW_META.codeMonthly
  );
  addWindow(
    codeSecondaryWindowMeta.id,
    t(codeSecondaryWindowMeta.labelKey),
    codeSecondaryWindowMeta.labelKey,
    undefined,
    rateWindows.weeklyWindow,
    rawLimitReached,
    rawAllowed
  );

  const codeReviewWindows = pickClassifiedWindows(codeReviewLimit);
  const codeReviewLimitReached = codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached;
  const codeReviewAllowed = codeReviewLimit?.allowed;
  addWindow(
    WINDOW_META.codeReviewFiveHour.id,
    t(WINDOW_META.codeReviewFiveHour.labelKey),
    WINDOW_META.codeReviewFiveHour.labelKey,
    undefined,
    codeReviewWindows.fiveHourWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );
  const codeReviewSecondaryWindowMeta = selectSecondaryWindowMeta(
    codeReviewWindows.weeklyWindow,
    WINDOW_META.codeReviewWeekly,
    WINDOW_META.codeReviewMonthly
  );
  addWindow(
    codeReviewSecondaryWindowMeta.id,
    t(codeReviewSecondaryWindowMeta.labelKey),
    codeReviewSecondaryWindowMeta.labelKey,
    undefined,
    codeReviewWindows.weeklyWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );

  const normalizeWindowId = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  if (Array.isArray(additionalRateLimits)) {
    additionalRateLimits.forEach((limitItem, index) => {
      const rateInfo = limitItem?.rate_limit ?? limitItem?.rateLimit ?? null;
      if (!rateInfo) return;

      const limitName =
        normalizeStringValue(limitItem?.limit_name ?? limitItem?.limitName) ??
        normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature) ??
        `additional-${index + 1}`;

      const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;
      const additionalWindows = pickClassifiedWindows(rateInfo);
      const additionalLimitReached = rateInfo.limit_reached ?? rateInfo.limitReached;
      const additionalAllowed = rateInfo.allowed;

      addWindow(
        `${idPrefix}-five-hour-${index}`,
        t('codex_quota.additional_primary_window', { name: limitName }),
        'codex_quota.additional_primary_window',
        { name: limitName },
        additionalWindows.fiveHourWindow,
        additionalLimitReached,
        additionalAllowed
      );
      const additionalSecondaryMeta = selectSecondaryWindowMeta(
        additionalWindows.weeklyWindow,
        { id: 'weekly', labelKey: 'codex_quota.additional_secondary_window' },
        { id: 'monthly', labelKey: 'codex_quota.additional_team_secondary_window' }
      );
      addWindow(
        `${idPrefix}-${additionalSecondaryMeta.id}-${index}`,
        t(additionalSecondaryMeta.labelKey, { name: limitName }),
        additionalSecondaryMeta.labelKey,
        { name: limitName },
        additionalWindows.weeklyWindow,
        additionalLimitReached,
        additionalAllowed
      );
    });
  }

  return windows;
};

const buildCodexRequestHeader = (file: AuthFileItem): Record<string, string> => {
  const accountId = resolveCodexChatgptAccountId(file);
  const requestHeader: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
  };
  if (accountId) {
    requestHeader['Chatgpt-Account-Id'] = accountId;
  }
  return requestHeader;
};

const fetchCodexResetCredits = async (
  authIndex: string,
  requestHeader: Record<string, string>,
  t: TFunction
): Promise<CodexResetCreditsData> => {
  try {
    const result = await apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: CODEX_RATE_LIMIT_RESET_CREDITS_URL,
        header: {
          ...requestHeader,
          Accept: 'application/json',
          'OpenAI-Beta': 'codex-1',
          Originator: 'Codex Desktop',
        },
      },
      { timeout: CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS }
    );

    if (result.statusCode < 200 || result.statusCode >= 300) {
      return {
        availableCount: null,
        credits: [],
        error: getApiCallErrorMessage(result),
      };
    }

    const summary = normalizeCodexResetCreditsPayload(result.body ?? result.bodyText);
    if (summary.invalidPayload) {
      return {
        availableCount: null,
        credits: [],
        error: t('codex_quota.reset_credits_invalid_payload'),
      };
    }

    return {
      availableCount: summary.availableCount,
      credits: summary.credits,
      error: '',
    };
  } catch (err: unknown) {
    return {
      availableCount: null,
      credits: [],
      error: err instanceof Error ? err.message : t('common.unknown_error'),
    };
  }
};

const fetchCodexQuota = async (file: AuthFileItem, t: TFunction): Promise<CodexQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const planTypeFromFile = resolveCodexPlanType(file);
  const subscriptionActiveUntil = resolveCodexSubscriptionActiveUntil(file);
  const requestHeader = buildCodexRequestHeader(file);

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CODEX_USAGE_URL,
    header: requestHeader,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('codex_quota.empty_windows'));
  }

  const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
  const resetCredits = payload.rate_limit_reset_credits ?? payload.rateLimitResetCredits ?? null;
  const usageResetCreditsAvailableCount = normalizeNumberValue(
    resetCredits?.available_count ?? resetCredits?.availableCount
  );
  const resetCreditsData = await fetchCodexResetCredits(authIndex, requestHeader, t);
  const resetCreditsCountFromDetails =
    resetCreditsData.credits.length > 0 ? resetCreditsData.credits.length : null;
  const rateLimitResetCreditsAvailableCount =
    resetCreditsData.availableCount ??
    resetCreditsCountFromDetails ??
    usageResetCreditsAvailableCount;
  const planType = planTypeFromUsage ?? planTypeFromFile;
  const windows = buildCodexQuotaWindows(payload, t);
  return {
    planType,
    subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount,
    rateLimitResetCredits: resetCreditsData.credits,
    rateLimitResetCreditsError: resetCreditsData.error,
    windows,
  };
};

const createCodexRedeemRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const segment = char === 'x' ? value : (value & 0x3) | 0x8;
    return segment.toString(16);
  });
};

const consumeCodexRateLimitResetCredit = async (
  file: AuthFileItem,
  t: TFunction
): Promise<void> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const requestHeader = buildCodexRequestHeader(file);

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
    header: requestHeader,
    data: JSON.stringify({
      redeem_request_id: createCodexRedeemRequestId(),
    }),
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }
};

const resetCodexQuota = async (file: AuthFileItem, t: TFunction): Promise<CodexQuotaData> => {
  await consumeCodexRateLimitResetCredit(file, t);
  return fetchCodexQuota(file, t);
};

const formatAntigravityDuration = (t: TFunction, deltaMs: number): string => {
  const totalMinutes = Math.max(1, Math.ceil(deltaMs / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return t('antigravity_quota.duration_day_hour', {
      days,
      hours,
    });
  }
  if (hours > 0) {
    return t('antigravity_quota.duration_hour_minute', {
      hours,
      minutes,
    });
  }
  if (minutes > 0) {
    return t('antigravity_quota.duration_minute', {
      minutes,
    });
  }
  return t('antigravity_quota.duration_less_than_minute');
};

const formatAntigravityResetLabel = (
  resetTime: string | undefined,
  t: TFunction,
  nowMs: number
): string => {
  if (!resetTime) return '-';
  const resetMs = new Date(resetTime).getTime();
  if (Number.isNaN(resetMs)) return '-';
  const deltaMs = resetMs - nowMs;
  if (deltaMs <= 0) return t('antigravity_quota.refresh_available');
  return t('antigravity_quota.refreshes_in', {
    duration: formatAntigravityDuration(t, deltaMs),
  });
};

const ANTIGRAVITY_GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const ANTIGRAVITY_BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const normalizeAntigravityQuotaText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const translateAntigravityQuotaLabel = (
  value: string,
  keys: Map<string, string>,
  t: TFunction
): string => {
  const key = keys.get(normalizeAntigravityQuotaText(value));
  return key ? t(`antigravity_quota.${key}`) : value;
};

const translateAntigravityQuotaDescription = (
  value: string | undefined,
  t: TFunction
): string | undefined => {
  if (!value) return undefined;
  const modelsMatch = value.match(/^models within this group:\s*(.+)$/i);
  if (modelsMatch) {
    return t('antigravity_quota.group_models_description', {
      models: modelsMatch[1].trim(),
    });
  }
  return value;
};

const getAntigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
};

const renderAntigravityItems = (
  quota: AntigravityQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const groups = quota.groups ?? [];
  const nodes: ReactNode[] = [];
  const planLabel = getAntigravityPlanLabel(quota.subscription, t);
  const normalizedPlan = quota.subscription?.plan?.toLowerCase() ?? '';
  const isPremiumPlan = normalizedPlan === 'ultra' || normalizedPlan === 'ultra-lite';

  if (planLabel) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h(
          'span',
          { className: styleMap.codexPlanItem },
          h('span', { className: styleMap.codexPlanLabel }, t('antigravity_quota.plan_label')),
          h(
            'span',
            { className: isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue },
            planLabel
          )
        )
      )
    );
  }

  if (groups.length === 0) {
    nodes.push(
      h(
        'div',
        { key: 'empty', className: styleMap.quotaMessage },
        t('antigravity_quota.empty_models')
      )
    );
    return h(Fragment, null, ...nodes);
  }

  const nowMs = Date.now() + (quota.serverTimeOffsetMs ?? 0);

  nodes.push(
    ...groups.map((group) => {
      const groupLabel = translateAntigravityQuotaLabel(
        group.label,
        ANTIGRAVITY_GROUP_LABEL_KEYS,
        t
      );
      const groupDescription = translateAntigravityQuotaDescription(group.description, t);

      return h(
        'div',
        { key: group.id, className: styleMap.antigravityQuotaGroup },
        h(
          'div',
          { className: styleMap.antigravityQuotaGroupHeader },
          h('span', { className: styleMap.antigravityQuotaGroupTitle }, groupLabel),
          groupDescription
            ? h('span', { className: styleMap.antigravityQuotaGroupDescription }, groupDescription)
            : null
        ),
        ...group.buckets.map((bucket) => {
          const clamped = Math.max(0, Math.min(1, bucket.remainingFraction));
          const percent = clamped * 100;
          const percentLabel =
            bucket.remainingFraction === 1
              ? t('antigravity_quota.quota_available')
              : t('antigravity_quota.remaining_percent', {
                  percent: Math.round(percent),
                });
          const resetLabel = formatAntigravityResetLabel(bucket.resetTime, t, nowMs);
          const bucketLabel = translateAntigravityQuotaLabel(
            bucket.label,
            ANTIGRAVITY_BUCKET_LABEL_KEYS,
            t
          );
          const bucketDescription = translateAntigravityQuotaDescription(bucket.description, t);

          return h(
            'div',
            { key: bucket.id, className: styleMap.quotaRow },
            h(
              'div',
              { className: styleMap.quotaRowHeader },
              h('span', { className: styleMap.quotaModel, title: bucketDescription }, bucketLabel),
              h(
                'div',
                { className: styleMap.quotaMeta },
                h('span', { className: styleMap.quotaPercent }, percentLabel),
                h('span', { className: styleMap.quotaReset }, resetLabel)
              )
            ),
            h(QuotaProgressBar, {
              percent,
              highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
              mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
            })
          );
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite', 'pro-lite', 'pro_lite']);

const renderCodexItems = (
  quota: CodexQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const planType = quota.planType ?? null;
  const subscriptionActiveUntil = quota.subscriptionActiveUntil ?? null;
  const rateLimitResetCreditsAvailableCount = quota.rateLimitResetCreditsAvailableCount ?? null;
  const rateLimitResetCredits = quota.rateLimitResetCredits ?? [];
  const rateLimitResetCreditsError = quota.rateLimitResetCreditsError ?? '';

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (normalized === 'pro') return t('codex_quota.plan_pro');
    if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
      return t('codex_quota.plan_prolite');
    }
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const isPremiumPlan = PREMIUM_CODEX_PLAN_TYPES.has(normalizePlanType(planType) ?? '');
  const expiryLabel = subscriptionActiveUntil ? formatDateTimeValue(subscriptionActiveUntil) : '';
  const nodes: ReactNode[] = [];

  if (planLabel || expiryLabel || rateLimitResetCreditsAvailableCount !== null) {
    const planValueClass = isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue;
    const planNodes: ReactNode[] = [];

    const appendPlanItem = (
      key: string,
      label: string,
      value: string,
      valueClassName = styleMap.codexPlanValue
    ) => {
      planNodes.push(
        h(
          'span',
          { key, className: styleMap.codexPlanItem },
          h('span', { className: styleMap.codexPlanLabel }, label),
          h('span', { className: valueClassName }, value)
        )
      );
    };

    if (planLabel) {
      appendPlanItem('plan-type', t('codex_quota.plan_label'), planLabel, planValueClass);
    }

    if (expiryLabel) {
      appendPlanItem('subscription-expiry', t('codex_quota.expires_label'), expiryLabel);
    }

    if (rateLimitResetCreditsAvailableCount !== null) {
      appendPlanItem(
        'reset-credits',
        t('codex_quota.reset_credits_label'),
        rateLimitResetCreditsAvailableCount.toString()
      );
    }

    nodes.push(h('div', { key: 'plan', className: styleMap.codexPlan }, ...planNodes));
  }

  if (rateLimitResetCredits.length > 0) {
    nodes.push(
      h(
        'div',
        { key: 'reset-credit-expiries', className: styleMap.codexResetCredits },
        h(
          'div',
          { className: styleMap.codexResetCreditsTitle },
          t('codex_quota.reset_credits_expiry_label')
        ),
        ...rateLimitResetCredits.map((credit, index) =>
          h(
            'div',
            {
              key: credit.id || `${credit.expiresAt}-${index}`,
              className: styleMap.codexResetCreditRow,
            },
            h(
              'span',
              { className: styleMap.codexResetCreditLabel },
              t('codex_quota.reset_credit_number', { index: index + 1 })
            ),
            h(
              'span',
              { className: styleMap.codexResetCreditTime },
              formatShanghaiDateTime(credit.expiresAt) || credit.expiresAt
            )
          )
        )
      )
    );
  } else if (rateLimitResetCreditsError) {
    nodes.push(
      h(
        'div',
        { key: 'reset-credit-expiry-error', className: styleMap.codexResetCreditsError },
        t('codex_quota.reset_credits_expiry_failed', {
          message: rateLimitResetCreditsError,
        })
      )
    );
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
      const windowLabel = window.labelKey
        ? t(window.labelKey, window.labelParams as Record<string, string | number>)
        : window.label;

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
        h(QuotaProgressBar, {
          percent: remaining,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = payload[key as keyof ClaudeUsagePayload];
    if (!window || typeof window !== 'object' || !('utilization' in window)) continue;
    const typedWindow = window as { utilization: number; resets_at: string };
    const usedPercent = normalizeNumberValue(typedWindow.utilization);
    const resetLabel = formatQuotaResetTime(typedWindow.resets_at);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel,
    });
  }

  return windows;
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

const fetchClaudeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
}> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  ]);

  if (usageResult.status === 'rejected') {
    throw usageResult.reason;
  }

  const result = usageResult.value;

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseClaudeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('claude_quota.empty_windows'));
  }

  const windows = buildClaudeQuotaWindows(payload, t);
  const planType =
    profileResult.status === 'fulfilled' &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? resolveClaudePlanType(
          parseClaudeProfilePayload(profileResult.value.body ?? profileResult.value.bodyText)
        )
      : null;

  return { windows, extraUsage: payload.extra_usage, planType };
};

const renderClaudeItems = (
  quota: ClaudeQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const extraUsage = quota.extraUsage ?? null;
  const planType = quota.planType ?? null;
  const nodes: ReactNode[] = [];

  if (planType) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.plan_label')),
        h('span', { className: styleMap.codexPlanValue }, t(`claude_quota.${planType}`))
      )
    );
  }

  if (extraUsage && extraUsage.is_enabled) {
    const usedLabel = `$${(extraUsage.used_credits / 100).toFixed(2)} / $${(extraUsage.monthly_limit / 100).toFixed(2)}`;
    nodes.push(
      h(
        'div',
        { key: 'extra', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.extra_usage_label')),
        h('span', { className: styleMap.codexPlanValue }, usedLabel)
      )
    );
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('claude_quota.empty_windows'))
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
        h(QuotaProgressBar, {
          percent: remaining,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

export const CLAUDE_CONFIG: QuotaConfig<
  ClaudeQuotaState,
  { windows: ClaudeQuotaWindow[]; extraUsage?: ClaudeExtraUsage | null; planType?: string | null }
> = {
  type: 'claude',
  i18nPrefix: 'claude_quota',
  filterFn: (file) => isClaudeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchClaudeQuota,
  storeSelector: (state) => state.claudeQuota,
  storeSetter: 'setClaudeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    extraUsage: data.extraUsage,
    planType: data.planType,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.claudeCard,
  gridClassName: styles.claudeGrid,
  renderQuotaItems: renderClaudeItems,
};

export const ANTIGRAVITY_CONFIG: QuotaConfig<AntigravityQuotaState, AntigravityQuotaData> = {
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  filterFn: (file) => isAntigravityFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchAntigravityQuota,
  storeSelector: (state) => state.antigravityQuota,
  storeSetter: 'setAntigravityQuota',
  buildLoadingState: () => ({
    status: 'loading',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    groups: data.groups,
    subscription: data.subscription,
    serverTimeOffsetMs: data.serverTimeOffsetMs,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.antigravityCard,
  gridClassName: styles.antigravityGrid,
  renderQuotaItems: renderAntigravityItems,
};

export const CODEX_CONFIG: QuotaConfig<CodexQuotaState, CodexQuotaData> = {
  type: 'codex',
  i18nPrefix: 'codex_quota',
  filterFn: (file) => isCodexFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCodexQuota,
  resetQuota: resetCodexQuota,
  canResetQuota: (quota) => (quota.rateLimitResetCreditsAvailableCount ?? 0) > 0,
  storeSelector: (state) => state.codexQuota,
  storeSetter: 'setCodexQuota',
  buildLoadingState: () => ({
    status: 'loading',
    windows: [],
    rateLimitResetCredits: [],
    rateLimitResetCreditsError: '',
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    planType: data.planType,
    subscriptionActiveUntil: data.subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount: data.rateLimitResetCreditsAvailableCount,
    rateLimitResetCredits: data.rateLimitResetCredits,
    rateLimitResetCreditsError: data.rateLimitResetCreditsError,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    rateLimitResetCredits: [],
    rateLimitResetCreditsError: '',
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.codexCard,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCodexItems,
};

const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};

const renderKimiItems = (
  quota: KimiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('kimi_quota.empty_data'));
  }

  return rows.map((row) => {
    const limit = row.limit;
    const used = row.used;
    const remaining =
      limit > 0
        ? Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)))
        : used > 0
          ? 0
          : null;
    const percentLabel = remaining === null ? '--' : `${remaining}%`;
    const rowLabel = row.labelKey
      ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
      : (row.label ?? '');
    const resetLabel = formatKimiResetHint(t, row.resetHint);

    return h(
      'div',
      { key: row.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, rowLabel),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, percentLabel),
          resetLabel ? h('span', { className: styleMap.quotaReset }, resetLabel) : null
        )
      ),
      h(QuotaProgressBar, {
        percent: remaining,
        highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
        mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
      })
    );
  });
};

const toXaiRecord = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const resolveXaiUserId = (file: AuthFileItem): string | null => {
  const metadata = toXaiRecord(file.metadata);
  const attributes = toXaiRecord(file.attributes);
  const oauth = toXaiRecord(file.oauth ?? metadata?.oauth ?? attributes?.oauth);
  const user = toXaiRecord(file.user ?? metadata?.user ?? attributes?.user);

  const candidates = [
    file.sub,
    file.subject,
    file.user_id,
    file.userId,
    metadata?.sub,
    metadata?.subject,
    metadata?.user_id,
    metadata?.userId,
    attributes?.sub,
    attributes?.subject,
    attributes?.user_id,
    attributes?.userId,
    oauth?.sub,
    oauth?.subject,
    user?.sub,
    user?.id,
  ];

  for (const candidate of candidates) {
    const userId = normalizeStringValue(candidate);
    if (userId) return userId;
  }

  return null;
};

const buildXaiRequestHeaders = (file: AuthFileItem): Record<string, string> => {
  const headers: Record<string, string> = { ...XAI_REQUEST_HEADERS };
  const userId = resolveXaiUserId(file);
  if (userId) {
    headers['x-userid'] = userId;
  }
  return headers;
};

const requestXaiBilling = async (
  authIndex: string,
  url: string,
  header: Record<string, string>
): Promise<XaiBillingSummary | null> => {
  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url,
    header,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseXaiBillingPayload(result.body ?? result.bodyText);
  return buildXaiBillingSummary(payload?.config);
};

const requestXaiPaidHealth = async (authIndex: string): Promise<XaiBillingSummary> => {
  const [profileRequest, chatRequest] = await Promise.allSettled([
    apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: XAI_API_ME_URL,
        header: XAI_API_REQUEST_HEADERS,
      },
      { timeout: XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS }
    ),
    apiCallApi.request(
      {
        authIndex,
        method: 'POST',
        url: XAI_API_CHAT_URL,
        header: {
          ...XAI_API_REQUEST_HEADERS,
          'Content-Type': 'application/json',
        },
        data: JSON.stringify({
          model: XAI_PAID_HEALTH_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      },
      { timeout: XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS }
    ),
  ]);

  if (chatRequest.status === 'rejected') throw chatRequest.reason;
  if (chatRequest.value.statusCode < 200 || chatRequest.value.statusCode >= 300) {
    throw createStatusError(
      getApiCallErrorMessage(chatRequest.value),
      chatRequest.value.statusCode
    );
  }

  const profile =
    profileRequest.status === 'fulfilled' &&
    profileRequest.value.statusCode >= 200 &&
    profileRequest.value.statusCode < 300
      ? profileRequest.value.body
      : null;
  return buildXaiPaidHealthSummary(profile);
};

const fetchXaiQuota = async (file: AuthFileItem, t: TFunction): Promise<XaiBillingSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('xai_quota.missing_auth_index'));
  }

  if (isPaidXaiAuthFile(file)) {
    return requestXaiPaidHealth(authIndex);
  }

  const requestHeader = buildXaiRequestHeaders(file);
  const [weeklyResult, monthlyResult] = await Promise.allSettled([
    requestXaiBilling(authIndex, XAI_BILLING_WEEKLY_URL, requestHeader),
    requestXaiBilling(authIndex, XAI_BILLING_MONTHLY_URL, requestHeader),
  ]);
  const weeklySummary = weeklyResult.status === 'fulfilled' ? weeklyResult.value : null;
  const monthlySummary = monthlyResult.status === 'fulfilled' ? monthlyResult.value : null;
  const summary = mergeXaiBillingSummaries(weeklySummary, monthlySummary);
  if (summary) return summary;

  const billingError =
    weeklyResult.status === 'rejected' && monthlyResult.status === 'rejected'
      ? weeklyResult.reason
      : new Error(t('xai_quota.empty_data'));

  try {
    return await requestXaiPaidHealth(authIndex);
  } catch {
    // Preserve the original free billing error when neither account mode can be queried.
    throw billingError;
  }
};

const formatUsdFromCents = (cents: number | null): string => {
  if (cents === null) return '--';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

const formatXaiRemainingAmount = (billing: XaiBillingSummary): string => {
  const remainingCents =
    billing.monthlyLimitCents !== null && billing.includedUsedCents !== null
      ? Math.max(0, billing.monthlyLimitCents - billing.includedUsedCents)
      : null;
  const remaining = formatUsdFromCents(remainingCents);
  const limit = formatUsdFromCents(billing.monthlyLimitCents);
  if (billing.monthlyLimitCents === null) return remaining;
  return `${remaining} / ${limit}`;
};

const formatXaiOnDemandAmount = (billing: XaiBillingSummary): string => {
  const remainingCents =
    billing.onDemandCapCents !== null && billing.onDemandUsedCents !== null
      ? Math.max(0, billing.onDemandCapCents - billing.onDemandUsedCents)
      : null;
  const remaining = formatUsdFromCents(remainingCents);
  const cap = formatUsdFromCents(billing.onDemandCapCents);
  if (billing.onDemandCapCents === null) return remaining;
  return `${remaining} / ${cap}`;
};

const formatXaiPercent = (value: number | null): string => {
  if (value === null) return '--';
  return `${Math.round(value)}%`;
};

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

const resolveXaiPlan = (
  monthlyLimitCents: number | null
): { labelKey: string; premium: boolean } | null => {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok', premium: false };
  }
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok_heavy', premium: true };
  }
  return null;
};

const renderXaiItems = (
  quota: XaiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const billing = quota.billing;

  if (!billing) {
    return h('div', { className: styleMap.quotaMessage }, t('xai_quota.empty_data'));
  }

  if (billing.mode === 'paid-health') {
    return h(
      Fragment,
      null,
      h(
        'div',
        { className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.plan_label')),
        h('span', { className: styleMap.premiumPlanValue }, t('xai_quota.plan_paid'))
      ),
      h('div', { className: styleMap.quotaMessage }, t('xai_quota.paid_health'))
    );
  }

  const clampedUsed =
    billing.usedPercent === null ? null : Math.max(0, Math.min(100, billing.usedPercent));
  const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
  const percentLabel = formatXaiPercent(remaining);
  const amountLabel = formatXaiRemainingAmount(billing);
  const resetLabel = formatQuotaResetTime(billing.billingPeriodEnd);
  const onDemandCap = billing.onDemandCapCents ?? 0;
  const clampedOnDemandUsed =
    billing.onDemandUsedPercent === null
      ? null
      : Math.max(0, Math.min(100, billing.onDemandUsedPercent));
  const onDemandRemaining =
    clampedOnDemandUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedOnDemandUsed));
  const onDemandPercentLabel = formatXaiPercent(onDemandRemaining);
  const onDemandAmountLabel = formatXaiOnDemandAmount(billing);
  const plan = resolveXaiPlan(billing.monthlyLimitCents);
  const weeklyUsed =
    billing.periodType === 'weekly' && billing.usagePercent !== null
      ? Math.max(0, Math.min(100, billing.usagePercent))
      : null;
  const weeklyRemaining = weeklyUsed === null ? null : Math.max(0, Math.min(100, 100 - weeklyUsed));
  const weeklyResetLabel = formatQuotaResetTime(billing.periodEnd);
  const hasWeeklyData =
    billing.periodType === 'weekly' &&
    (weeklyUsed !== null || Boolean(billing.periodEnd) || billing.productUsage.length > 0);
  const hasMonthlyData =
    billing.monthlyLimitCents !== null ||
    billing.usedCents !== null ||
    Boolean(billing.billingPeriodEnd);

  return h(
    Fragment,
    null,
    plan
      ? h(
          'div',
          { key: 'plan', className: styleMap.codexPlan },
          h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.plan_label')),
          h(
            'span',
            { className: plan.premium ? styleMap.premiumPlanValue : styleMap.codexPlanValue },
            t(`xai_quota.${plan.labelKey}`)
          )
        )
      : null,
    hasWeeklyData
      ? h(
          'div',
          { key: 'weekly-limit', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.weekly_limit')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h(
                'span',
                { className: styleMap.quotaPercent },
                t('xai_quota.used_percent', {
                  percent: formatXaiPercent(weeklyUsed),
                })
              ),
              weeklyResetLabel !== '-'
                ? h(
                    'span',
                    { className: styleMap.quotaReset },
                    t('xai_quota.reset_at', {
                      time: weeklyResetLabel,
                    })
                  )
                : null
            )
          ),
          h(QuotaProgressBar, {
            percent: weeklyRemaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : null,
    ...billing.productUsage.map((item) => {
      const used =
        item.usagePercent === null ? null : Math.max(0, Math.min(100, item.usagePercent));
      const remainingPercent = used === null ? null : Math.max(0, Math.min(100, 100 - used));
      return h(
        'div',
        { key: `product-${item.product}`, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h(
            'span',
            { className: styleMap.quotaModel },
            t('xai_quota.product_usage', { product: item.product })
          ),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h(
              'span',
              { className: styleMap.quotaPercent },
              t('xai_quota.used_percent', {
                percent: formatXaiPercent(used),
              })
            )
          )
        ),
        h(QuotaProgressBar, {
          percent: remainingPercent,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    }),
    onDemandCap > 0
      ? h(
          'div',
          { key: 'pay-as-you-go', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.pay_as_you_go_label')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h('span', { className: styleMap.quotaPercent }, onDemandPercentLabel),
              h('span', { className: styleMap.quotaAmount }, onDemandAmountLabel)
            )
          ),
          h(QuotaProgressBar, {
            percent: onDemandRemaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : h(
          'div',
          { key: 'pay-as-you-go', className: styleMap.codexPlan },
          h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.pay_as_you_go_label')),
          h('span', { className: styleMap.codexPlanValue }, t('xai_quota.pay_as_you_go_disabled'))
        ),
    hasMonthlyData
      ? h(
          'div',
          { key: 'monthly-credits', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.monthly_credits')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h('span', { className: styleMap.quotaPercent }, percentLabel),
              h('span', { className: styleMap.quotaAmount }, amountLabel),
              resetLabel !== '-' ? h('span', { className: styleMap.quotaReset }, resetLabel) : null
            )
          ),
          h(QuotaProgressBar, {
            percent: remaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : null
  );
};

export const KIMI_CONFIG: QuotaConfig<KimiQuotaState, KimiQuotaRow[]> = {
  type: 'kimi',
  i18nPrefix: 'kimi_quota',
  filterFn: (file) => isKimiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchKimiQuota,
  storeSelector: (state) => state.kimiQuota,
  storeSetter: 'setKimiQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.kimiCard,
  gridClassName: styles.kimiGrid,
  renderQuotaItems: renderKimiItems,
};

export const XAI_CONFIG: QuotaConfig<XaiQuotaState, XaiBillingSummary> = {
  type: 'xai',
  i18nPrefix: 'xai_quota',
  filterFn: (file) => isXaiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchXaiQuota,
  storeSelector: (state) => state.xaiQuota,
  storeSetter: 'setXaiQuota',
  buildLoadingState: () => ({ status: 'loading', billing: null }),
  buildSuccessState: (billing) => ({ status: 'success', billing }),
  buildErrorState: (message, status) => ({
    status: 'error',
    billing: null,
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.xaiCard,
  gridClassName: styles.xaiGrid,
  renderQuotaItems: renderXaiItems,
};

// ----- Cursor and OpenCode Zen quota configs -----
// The new upstream/main has Antigravity, Claude, Codex, Kimi, and xAI providers,
// but not Cursor or OpenCode Zen. The homelab .108 deployment uses these, so
// re-add the configs. The fetchers read the proxy /usage endpoint and aggregate
// request telemetry per auth file; when the endpoint is missing (older/newer
// backends without /usage) the cards degrade to the fetcher_pending hint.

const emptyUsageSummary = (): CursorUsageSummary => ({
  requests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
  modelCount: 0,
  tokenTelemetryCount: 0,
  models: [] as CursorModelUsageSummary[],
});

interface CursorUsageAccumulator {
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  tokenTelemetryCount: number;
  modelNames: Set<string>;
  models: Map<string, CursorUsageAccumulator>;
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
// Set when the /usage endpoint cannot be fetched (404, network error, ...).
// Renderers use it to show the fetcher_pending hint instead of empty_usage.
let cursorUsageEndpointUnavailable = false;

const createCursorUsageAccumulator = (): CursorUsageAccumulator => ({
  requests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
  tokenTelemetryCount: 0,
  modelNames: new Set<string>(),
  models: new Map<string, CursorUsageAccumulator>(),
  lastSeenMillis: null,
});

const cloneCursorSummary = (summary: CursorUsageSummary): CursorUsageSummary => ({
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

  if (model) {
    const modelAcc = current.models.get(model) ?? createCursorUsageAccumulator();
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

const finalizeCursorUsageMap = (
  map: Map<string, CursorUsageAccumulator>
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
        const detailAuthIndex = normalizeAuthIndex(detail.auth_index ?? detail.authIndex);
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
    bySource: finalizeCursorUsageMap(bySourceAcc),
  };
};

const emptyCursorUsageIndex = (): CursorUsageIndex => ({
  byAuthIndex: new Map<string, CursorUsageSummary>(),
  byAuthId: new Map<string, CursorUsageSummary>(),
  bySource: new Map<string, CursorUsageSummary>(),
});

const loadCursorUsageIndex = async (): Promise<CursorUsageIndex> => {
  const now = Date.now();
  if (cursorUsageIndexCache && now - cursorUsageIndexCache.fetchedAt < CURSOR_USAGE_CACHE_TTL_MS) {
    return cursorUsageIndexCache.index;
  }
  if (cursorUsageIndexInFlight) {
    return cursorUsageIndexInFlight;
  }

  cursorUsageIndexInFlight = (async () => {
    try {
      const response = (await usageApi.getUsage()) as Record<string, unknown> | null | undefined;
      const usageRoot = (response?.usage ?? response) as Record<string, unknown>;
      const index = buildCursorUsageIndex(usageRoot);
      cursorUsageEndpointUnavailable = false;
      cursorUsageIndexCache = { fetchedAt: Date.now(), index };
      return index;
    } catch {
      // The backend may not expose /usage (404) or may be unreachable. Degrade
      // to an empty index so cards render the fetcher_pending hint instead of
      // an error state.
      cursorUsageEndpointUnavailable = true;
      const index = emptyCursorUsageIndex();
      cursorUsageIndexCache = { fetchedAt: Date.now(), index };
      return index;
    }
  })();

  try {
    return await cursorUsageIndexInFlight;
  } finally {
    cursorUsageIndexInFlight = null;
  }
};

// Cursor quota card. Reads the proxy /usage endpoint and aggregates telemetry
// by auth_index (falling back to auth file id/name matching).
const fetchCursorQuota = async (file: AuthFileItem, t: TFunction): Promise<CursorUsageSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  const authIds = [normalizeStringValue(file.id), normalizeStringValue(file.name)].filter(
    (value): value is string => Boolean(value)
  );
  if (!authIndex && authIds.length === 0) {
    throw new Error(t('cursor_quota.missing_auth_index'));
  }

  const usageIndex = await loadCursorUsageIndex();
  let summary = emptyUsageSummary();

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

const renderCursorItems = (
  quota: CursorQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const summary = quota.summary ?? emptyUsageSummary();
  const hasTelemetry = summary.requests > 0;
  const hasTokenTelemetry = (summary.tokenTelemetryCount ?? 0) > 0;
  const successPct = hasTelemetry ? Math.round((summary.successCount / summary.requests) * 100) : 0;
  const lastSeenLabel = summary.lastSeenAt
    ? formatQuotaResetTime(summary.lastSeenAt)
    : t('cursor_quota.last_seen_never');
  const emptyHint = cursorUsageEndpointUnavailable
    ? t('cursor_quota.fetcher_pending')
    : t('cursor_quota.empty_usage');

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
          h(
            'span',
            { className: styleMap.quotaPercent },
            hasTelemetry ? `${successPct}%` : '--'
          ),
          h('span', { className: styleMap.quotaReset }, lastSeenLabel)
        )
      ),
      h(
        QuotaProgressBar,
        { percent: hasTelemetry ? successPct : null, highThreshold: 80, mediumThreshold: 50 }
      )
    ),
    hasTelemetry &&
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
      hasTelemetry ? t('cursor_quota.telemetry_note') : emptyHint
    )
  );
};

const fetchZenQuota = async (file: AuthFileItem, t: TFunction): Promise<ZenUsageSummary> => {
  const apiKey = normalizeStringValue(file.apiKey ?? file.api_key);
  const prefix = normalizeStringValue(file.prefix);
  const sourceIds = new Set<string>();

  buildCandidateUsageSourceIds({
    apiKey: apiKey ?? undefined,
    prefix: prefix ?? undefined,
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
  let summary = emptyUsageSummary();
  sourceIds.forEach((sourceId) => {
    summary = mergeCursorSummary(summary, usageIndex.bySource.get(sourceId));
  });

  return cloneCursorSummary(summary);
};

const ZEN_GO_MODEL_LIMITS: Record<
  string,
  { label: string; fiveHour: number; weekly: number; monthly: number }
> = {
  'glm-5.1': { label: 'GLM-5.1', fiveHour: 880, weekly: 2150, monthly: 4300 },
  'glm-5': { label: 'GLM-5', fiveHour: 1150, weekly: 2880, monthly: 5750 },
  'kimi-k2.5': { label: 'Kimi K2.5', fiveHour: 1850, weekly: 4630, monthly: 9250 },
  'kimi-k2.6': { label: 'Kimi K2.6', fiveHour: 1150, weekly: 2880, monthly: 5750 },
  'mimo-v2-pro': { label: 'MiMo-V2-Pro', fiveHour: 1290, weekly: 3225, monthly: 6450 },
  'mimo-v2-omni': { label: 'MiMo-V2-Omni', fiveHour: 2150, weekly: 5450, monthly: 10900 },
  'mimo-v2.5-pro': { label: 'MiMo-V2.5-Pro', fiveHour: 1290, weekly: 3225, monthly: 6450 },
  'mimo-v2.5': { label: 'MiMo-V2.5', fiveHour: 2150, weekly: 5450, monthly: 10900 },
  'minimax-m2.7': { label: 'MiniMax M2.7', fiveHour: 3400, weekly: 8500, monthly: 17000 },
  'minimax-m2.5': { label: 'MiniMax M2.5', fiveHour: 6300, weekly: 15900, monthly: 31800 },
  'qwen3.6-plus': { label: 'Qwen3.6 Plus', fiveHour: 3300, weekly: 8200, monthly: 16300 },
  'qwen3.5-plus': { label: 'Qwen3.5 Plus', fiveHour: 10200, weekly: 25200, monthly: 50500 },
  'deepseek-v4-pro': { label: 'DeepSeek V4 Pro', fiveHour: 1300, weekly: 3250, monthly: 6500 },
  'deepseek-v4-flash': { label: 'DeepSeek V4 Flash', fiveHour: 7450, weekly: 18600, monthly: 37300 },
};

const normalizeZenGoModelId = (model: string): string => {
  const lower = model.trim().toLowerCase();
  const withoutPrefix = lower.startsWith('opencode-go/')
    ? lower.slice('opencode-go/'.length)
    : lower;
  const parts = withoutPrefix.split('/');
  return parts[parts.length - 1];
};

const renderZenItems = (
  quota: ZenQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const summary = quota.summary ?? emptyUsageSummary();
  const hasTelemetry = summary.requests > 0;
  const hasTokenTelemetry = (summary.tokenTelemetryCount ?? 0) > 0;
  const successPct = hasTelemetry ? Math.round((summary.successCount / summary.requests) * 100) : 0;
  const lastSeenLabel = summary.lastSeenAt
    ? formatQuotaResetTime(summary.lastSeenAt)
    : t('zen_quota.last_seen_never');
  const emptyHint = cursorUsageEndpointUnavailable
    ? t('zen_quota.fetcher_pending')
    : t('zen_quota.empty_usage');
  const modelBreakdown = (summary.models ?? []).slice(0, 6);

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
          h(
            'span',
            { className: styleMap.quotaPercent },
            hasTelemetry ? `${successPct}%` : '--'
          ),
          h('span', { className: styleMap.quotaReset }, lastSeenLabel)
        )
      ),
      h(
        QuotaProgressBar,
        { percent: hasTelemetry ? successPct : null, highThreshold: 80, mediumThreshold: 50 }
      )
    ),
    hasTelemetry &&
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
      hasTelemetry ? t('zen_quota.telemetry_note') : emptyHint
    ),
    modelBreakdown.length > 0 &&
      h(
        'div',
        { className: styleMap.quotaMessage, style: { marginTop: '0.75rem' } },
        h(
          'div',
          { style: { fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' } },
          t('zen_quota.model_breakdown_title')
        ),
        ...modelBreakdown.map((model) => {
          const modelId = normalizeZenGoModelId(model.model);
          const limits = ZEN_GO_MODEL_LIMITS[modelId];
          const label = limits?.label ?? model.model;
          const tokenText =
            (model.tokenTelemetryCount ?? 0) > 0
              ? t('zen_quota.tokens_value', { count: model.totalTokens })
              : t('zen_quota.tokens_unavailable');
          const limitText = limits
            ? t('zen_quota.model_limits_value', {
                fiveHour: limits.fiveHour.toLocaleString(),
                weekly: limits.weekly.toLocaleString(),
                monthly: limits.monthly.toLocaleString(),
              })
            : t('zen_quota.model_limits_unknown');
          return h(
            'div',
            {
              key: model.model,
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                gap: '0.75rem',
                padding: '0.3rem 0',
                borderTop: '1px solid var(--border-color)',
              },
            },
            h('span', { style: { color: 'var(--text-primary)', fontWeight: 500 } }, label),
            h(
              'span',
              { style: { textAlign: 'right' } },
              t('zen_quota.model_usage_value', {
                requests: model.requests,
                failures: model.failureCount,
                tokens: tokenText,
                limits: limitText,
              })
            )
          );
        })
      )
  );
};

export const CURSOR_CONFIG: QuotaConfig<CursorQuotaState, CursorUsageSummary> = {
  type: 'cursor',
  i18nPrefix: 'cursor_quota',
  filterFn: (file) => isCursorFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCursorQuota,
  storeSelector: (state) => state.cursorQuota,
  storeSetter: 'setCursorQuota',
  buildLoadingState: () => ({ status: 'loading', summary: emptyUsageSummary() }),
  buildSuccessState: (summary) => ({ status: 'success', summary }),
  buildErrorState: (message, status) => ({
    status: 'error',
    summary: emptyUsageSummary(),
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.codexCard,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCursorItems,
};

export const ZEN_CONFIG: QuotaConfig<ZenQuotaState, ZenUsageSummary> = {
  type: 'opencode-go',
  i18nPrefix: 'zen_quota',
  filterFn: (file) => isZenFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchZenQuota,
  storeSelector: (state) => state.zenQuota,
  storeSetter: 'setZenQuota',
  buildLoadingState: () => ({ status: 'loading', summary: emptyUsageSummary() }),
  buildSuccessState: (summary) => ({ status: 'success', summary }),
  buildErrorState: (message, status) => ({
    status: 'error',
    summary: emptyUsageSummary(),
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.codexCard,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderZenItems,
};
