/**
 * 使用统计相关 API
 */

import { apiClient } from './client';

const USAGE_TIMEOUT_MS = 60 * 1000;

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: () => apiClient.get('/usage', { timeout: USAGE_TIMEOUT_MS }),
};
