/**
 * Cursor 用量数据层。React-free / SCSS-free。
 * 遥测来自代理 /usage 端点（见 telemetry/usageIndex.ts），不是官方额度 API。
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, CursorQuotaState, CursorUsageSummary } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isCursorFile, isDisabledAuthFile, normalizeStringValue } from '@/utils/quota';
import {
  cloneUsageSummary,
  emptyUsageSummary,
  loadUsageIndex,
  mergeUsageSummary,
} from '../telemetry/usageIndex';
import type { QuotaProviderData } from '../types';

const fetchCursorQuota = async (file: AuthFileItem, t: TFunction): Promise<CursorUsageSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  const authIds = [normalizeStringValue(file.id), normalizeStringValue(file.name)].filter(
    (value): value is string => Boolean(value)
  );
  if (!authIndex && authIds.length === 0) {
    throw new Error(t('cursor_quota.missing_auth_index'));
  }

  const usageIndex = await loadUsageIndex();
  let summary = emptyUsageSummary();

  if (authIndex) {
    summary = mergeUsageSummary(summary, usageIndex.byAuthIndex.get(authIndex));
  }

  if (summary.requests === 0 && authIds.length > 0) {
    for (const authId of authIds) {
      const byAuthIdSummary = usageIndex.byAuthId.get(authId);
      if (!byAuthIdSummary) continue;
      summary = mergeUsageSummary(summary, byAuthIdSummary);
      if (summary.requests > 0) break;
    }
  }

  return cloneUsageSummary(summary);
};

export const CURSOR_CONFIG: QuotaProviderData<CursorQuotaState, CursorUsageSummary> = {
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
};
