/**
 * OpenCode Zen / Go 用量数据层。React-free / SCSS-free。
 * 按 API key 的 source 匹配代理 /usage 遥测；Go 套餐的模型限额为估算值。
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, ZenQuotaState, ZenUsageSummary } from '@/types';
import { isDisabledAuthFile, isZenFile, normalizeStringValue } from '@/utils/quota';
import { buildCandidateUsageSourceIds, normalizeUsageSourceId } from '@/utils/usage';
import {
  cloneUsageSummary,
  emptyUsageSummary,
  loadUsageIndex,
  mergeUsageSummary,
} from '../telemetry/usageIndex';
import type { QuotaProviderData } from '../types';

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

  const usageIndex = await loadUsageIndex();
  let summary = emptyUsageSummary();
  sourceIds.forEach((sourceId) => {
    summary = mergeUsageSummary(summary, usageIndex.bySource.get(sourceId));
  });

  return cloneUsageSummary(summary);
};

/** 估算的 Go 套餐限额（请求数，5 小时 / 每周 / 每月）。 */
export const ZEN_GO_MODEL_LIMITS: Record<
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

export const normalizeZenGoModelId = (model: string): string => {
  const lower = model.trim().toLowerCase();
  const withoutPrefix = lower.startsWith('opencode-go/')
    ? lower.slice('opencode-go/'.length)
    : lower;
  const parts = withoutPrefix.split('/');
  return parts[parts.length - 1];
};

export const ZEN_CONFIG: QuotaProviderData<ZenQuotaState, ZenUsageSummary> = {
  type: 'zen',
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
};
