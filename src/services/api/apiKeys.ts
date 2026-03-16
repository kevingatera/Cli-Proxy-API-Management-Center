/**
 * API key management
 */

import { apiClient } from './client';

type APIKeyLabelsResponse = {
  'api-key-labels'?: Record<string, string>;
  apiKeyLabels?: Record<string, string>;
};

const normalizeLabels = (payload: APIKeyLabelsResponse | null | undefined): Record<string, string> => {
  const source = payload?.['api-key-labels'] ?? payload?.apiKeyLabels;
  if (!source || typeof source !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  Object.entries(source).forEach(([fingerprint, label]) => {
    const trimmed = String(label ?? '').trim();
    if (fingerprint && trimmed) {
      result[fingerprint] = trimmed;
    }
  });
  return result;
};

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const data = await apiClient.get('/api-keys');
    const keys = (data && (data['api-keys'] ?? data.apiKeys)) as unknown;
    return Array.isArray(keys) ? (keys as string[]) : [];
  },

  async listLabels(): Promise<Record<string, string>> {
    return normalizeLabels(await apiClient.get<APIKeyLabelsResponse>('/api-key-labels'));
  },

  replace: (keys: string[]) => apiClient.put('/api-keys', keys),

  replaceLabels: (labels: Record<string, string>) => apiClient.put('/api-key-labels', labels),

  update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),
};
