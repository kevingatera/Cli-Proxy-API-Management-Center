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
