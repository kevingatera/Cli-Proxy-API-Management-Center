import { apiClient } from './client';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const uiPreferencesApi = {
  async getSection<T extends Record<string, unknown>>(key: string): Promise<T> {
    const data = await apiClient.get<T>(`/ui-preferences/${encodeURIComponent(key)}`);
    return isPlainObject(data) ? (data as T) : ({} as T);
  },

  putSection: (key: string, value: Record<string, unknown>) =>
    apiClient.put(`/ui-preferences/${encodeURIComponent(key)}`, value),

  deleteSection: (key: string) => apiClient.delete(`/ui-preferences/${encodeURIComponent(key)}`),
};
