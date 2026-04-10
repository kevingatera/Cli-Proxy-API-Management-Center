/**
 * 配置相关 API
 */

import { apiClient } from './client';
import type { Config, RoutingPolicyConfig, RoutingPreview, RoutingTrace } from '@/types';
import { normalizeConfigResponse } from './transformers';

export const configApi = {
  /**
   * 获取配置（会进行字段规范化）
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    return normalizeConfigResponse(raw);
  },

  /**
   * 获取原始配置（不做转换）
   */
  getRawConfig: () => apiClient.get('/config'),

  /**
   * 更新 Debug 模式
   */
  updateDebug: (enabled: boolean) => apiClient.put('/debug', { value: enabled }),

  /**
   * 更新代理 URL
   */
  updateProxyUrl: (proxyUrl: string) => apiClient.put('/proxy-url', { value: proxyUrl }),

  /**
   * 清除代理 URL
   */
  clearProxyUrl: () => apiClient.delete('/proxy-url'),

  /**
   * 更新重试次数
   */
  updateRequestRetry: (retryCount: number) => apiClient.put('/request-retry', { value: retryCount }),

  /**
   * 配额回退：切换项目
   */
  updateSwitchProject: (enabled: boolean) =>
    apiClient.put('/quota-exceeded/switch-project', { value: enabled }),

  /**
   * 配额回退：切换预览模型
   */
  updateSwitchPreviewModel: (enabled: boolean) =>
    apiClient.put('/quota-exceeded/switch-preview-model', { value: enabled }),

  /**
   * 使用统计开关
   */
  updateUsageStatistics: (enabled: boolean) =>
    apiClient.put('/usage-statistics-enabled', { value: enabled }),

  /**
   * 请求日志开关
   */
  updateRequestLog: (enabled: boolean) => apiClient.put('/request-log', { value: enabled }),

  /**
   * 写日志到文件开关
   */
  updateLoggingToFile: (enabled: boolean) => apiClient.put('/logging-to-file', { value: enabled }),

  /**
   * 获取日志总大小上限（MB）
   */
  async getLogsMaxTotalSizeMb(): Promise<number> {
    const data = await apiClient.get('/logs-max-total-size-mb');
    return data?.['logs-max-total-size-mb'] ?? data?.logsMaxTotalSizeMb ?? 0;
  },

  /**
   * 更新日志总大小上限（MB）
   */
  updateLogsMaxTotalSizeMb: (value: number) =>
    apiClient.put('/logs-max-total-size-mb', { value }),

  /**
   * WebSocket 鉴权开关
   */
  updateWsAuth: (enabled: boolean) => apiClient.put('/ws-auth', { value: enabled }),

  /**
   * 获取强制模型前缀开关
   */
  async getForceModelPrefix(): Promise<boolean> {
    const data = await apiClient.get('/force-model-prefix');
    return data?.['force-model-prefix'] ?? data?.forceModelPrefix ?? false;
  },

  /**
   * 更新强制模型前缀开关
   */
  updateForceModelPrefix: (enabled: boolean) => apiClient.put('/force-model-prefix', { value: enabled }),

  /**
   * 获取路由策略
   */
  async getRoutingStrategy(): Promise<string> {
    const data = await apiClient.get('/routing/strategy');
    return data?.strategy ?? data?.['routing-strategy'] ?? data?.routingStrategy ?? 'round-robin';
  },

  /**
   * 更新路由策略
   */
  updateRoutingStrategy: (strategy: string) => apiClient.put('/routing/strategy', { value: strategy }),

  /**
   * 获取路由策略（policy）
   */
  async getRoutingPolicy(): Promise<RoutingPolicyConfig> {
    const data = await apiClient.get('/routing/policy');
    return data?.policy ?? data ?? {};
  },

  /**
   * 更新路由策略（policy）
   */
  updateRoutingPolicy: (policy: RoutingPolicyConfig) => apiClient.put('/routing/policy', { policy }),

  /**
   * 预览路由计划
   */
  async previewRouting(model: string, providers?: string[], pinnedAuthId?: string): Promise<RoutingPreview> {
    const data = await apiClient.post('/routing/preview', {
      model,
      providers,
      pinned_auth_id: pinnedAuthId,
    });
    return data?.preview ?? data;
  },

  /**
   * 获取路由追踪
   */
  async getRoutingTraces(params?: {
    limit?: number;
    model?: string;
    provider?: string;
    failed?: boolean;
  }): Promise<RoutingTrace[]> {
    const query = new URLSearchParams();
    if (params?.limit && Number.isFinite(params.limit)) query.set('limit', String(params.limit));
    if (params?.model) query.set('model', params.model);
    if (params?.provider) query.set('provider', params.provider);
    if (params?.failed !== undefined) query.set('failed', String(params.failed));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const data = await apiClient.get(`/routing/traces${suffix}`);
    return Array.isArray(data?.traces) ? data.traces : [];
  },
};
