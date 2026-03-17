/**
 * 模型列表状态管理（带缓存）
 */

import { create } from 'zustand';
import { modelsApi } from '@/services/api/models';
import { CACHE_EXPIRY_MS } from '@/utils/constants';
import type { ModelInfo } from '@/utils/models';

interface ModelsCache {
  data: ModelInfo[];
  timestamp: number;
  apiBase: string;
  authFingerprint: string;
}

interface ModelsState {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  cache: ModelsCache | null;

  fetchModels: (apiBase: string, apiKey?: string, forceRefresh?: boolean) => Promise<ModelInfo[]>;
  clearCache: () => void;
  isCacheValid: (apiBase: string, apiKey?: string) => boolean;
}

const hashAuthContext = (apiKey?: string): string => {
  const value = String(apiKey || '');
  if (!value) return 'anonymous';
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `auth-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  loading: false,
  error: null,
  cache: null,

  fetchModels: async (apiBase, apiKey, forceRefresh = false) => {
    const { cache, isCacheValid } = get();
    const authFingerprint = hashAuthContext(apiKey);

    // 检查缓存
    if (!forceRefresh && isCacheValid(apiBase, apiKey) && cache) {
      set({ models: cache.data, error: null });
      return cache.data;
    }

    set({ loading: true, error: null });

    try {
      const list = await modelsApi.fetchModels(apiBase, apiKey);
      const now = Date.now();

      set({
        models: list,
        loading: false,
        cache: { data: list, timestamp: now, apiBase, authFingerprint }
      });

      return list;
    } catch (error: any) {
      const message = error?.message || 'Failed to fetch models';
      set({
        error: message,
        loading: false,
        models: []
      });
      throw error;
    }
  },

  clearCache: () => {
    set({ cache: null, models: [] });
  },

  isCacheValid: (apiBase, apiKey) => {
    const { cache } = get();
    if (!cache) return false;
    if (cache.apiBase !== apiBase) return false;
    if (cache.authFingerprint !== hashAuthContext(apiKey)) return false;
    return Date.now() - cache.timestamp < CACHE_EXPIRY_MS;
  }
}));
