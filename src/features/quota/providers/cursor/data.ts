/**
 * Cursor 额度数据层。React-free / SCSS-free。
 * 直接调用 Cursor 控制台接口（当前周期用量 + 套餐信息），返回账户级用量。
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, CursorQuotaState, CursorUsageSummary } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { createStatusError, isCursorFile, isDisabledAuthFile } from '@/utils/quota';
import { normalizeCursorAccountUsage } from '@/utils/quota/cursorAccount';
import type { QuotaProviderData } from '../types';

const fetchCursorQuota = async (file: AuthFileItem, t: TFunction): Promise<CursorUsageSummary> => {
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  if (!authIndex) throw new Error(t('cursor_quota.missing_auth_index'));
  const headers = {
    Authorization: 'Bearer $TOKEN$',
    'Content-Type': 'application/json',
    'Connect-Protocol-Version': '1',
  };
  const [usage, plan] = await Promise.all(
    ['GetCurrentPeriodUsage', 'GetPlanInfo'].map((method) =>
      apiCallApi.request({
        authIndex,
        method: 'POST',
        url: `https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`,
        header: headers,
        data: '{}',
      })
    )
  );
  if (usage.statusCode !== 200)
    throw createStatusError(getApiCallErrorMessage(usage), usage.statusCode);
  return {
    requests: 0,
    successCount: 0,
    failureCount: 0,
    totalTokens: 0,
    modelCount: 0,
    account: normalizeCursorAccountUsage(usage.body, plan.statusCode === 200 ? plan.body : null),
  };
};

export const CURSOR_CONFIG: QuotaProviderData<CursorQuotaState, CursorUsageSummary> = {
  type: 'cursor',
  i18nPrefix: 'cursor_quota',
  filterFn: (file) => isCursorFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCursorQuota,
  storeSelector: (state) => state.cursorQuota,
  storeSetter: 'setCursorQuota',
  buildLoadingState: () => ({
    status: 'loading',
    summary: { requests: 0, successCount: 0, failureCount: 0, totalTokens: 0, modelCount: 0 },
  }),
  buildSuccessState: (summary) => ({ status: 'success', summary }),
  buildErrorState: (message, status) => ({
    status: 'error',
    summary: { requests: 0, successCount: 0, failureCount: 0, totalTokens: 0, modelCount: 0 },
    error: message,
    errorStatus: status,
  }),
};
