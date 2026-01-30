/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import type { AntigravityQuotaState, CodexQuotaState, GeminiCliQuotaState } from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);

interface QuotaStoreState {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  antigravityQuotaLastUpdatedAt: number | null;
  codexQuotaLastUpdatedAt: number | null;
  geminiCliQuotaLastUpdatedAt: number | null;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setAntigravityQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setCodexQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setGeminiCliQuotaLastUpdatedAt: (timestamp: number | null) => void;
  clearQuotaCache: () => void;
}

const resolveUpdater = <T,>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

export const useQuotaStore = create<QuotaStoreState>((set) => ({
  antigravityQuota: {},
  codexQuota: {},
  geminiCliQuota: {},
  antigravityQuotaLastUpdatedAt: null,
  codexQuotaLastUpdatedAt: null,
  geminiCliQuotaLastUpdatedAt: null,
  setAntigravityQuota: (updater) =>
    set((state) => ({
      antigravityQuota: resolveUpdater(updater, state.antigravityQuota)
    })),
  setCodexQuota: (updater) =>
    set((state) => ({
      codexQuota: resolveUpdater(updater, state.codexQuota)
    })),
  setGeminiCliQuota: (updater) =>
    set((state) => ({
      geminiCliQuota: resolveUpdater(updater, state.geminiCliQuota)
    })),
  setAntigravityQuotaLastUpdatedAt: (timestamp) => set({ antigravityQuotaLastUpdatedAt: timestamp }),
  setCodexQuotaLastUpdatedAt: (timestamp) => set({ codexQuotaLastUpdatedAt: timestamp }),
  setGeminiCliQuotaLastUpdatedAt: (timestamp) => set({ geminiCliQuotaLastUpdatedAt: timestamp }),
  clearQuotaCache: () =>
    set({
      antigravityQuota: {},
      codexQuota: {},
      geminiCliQuota: {},
      antigravityQuotaLastUpdatedAt: null,
      codexQuotaLastUpdatedAt: null,
      geminiCliQuotaLastUpdatedAt: null
    })
}));
