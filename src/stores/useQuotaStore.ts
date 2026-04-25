/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import type {
  AntigravityQuotaState,
  CodexQuotaState,
  CursorQuotaState,
  GeminiCliQuotaState,
  ZenQuotaState
} from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);

interface QuotaStoreState {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  cursorQuota: Record<string, CursorQuotaState>;
  zenQuota: Record<string, ZenQuotaState>;
  antigravityQuotaLastUpdatedAt: number | null;
  codexQuotaLastUpdatedAt: number | null;
  geminiCliQuotaLastUpdatedAt: number | null;
  cursorQuotaLastUpdatedAt: number | null;
  zenQuotaLastUpdatedAt: number | null;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setCursorQuota: (updater: QuotaUpdater<Record<string, CursorQuotaState>>) => void;
  setZenQuota: (updater: QuotaUpdater<Record<string, ZenQuotaState>>) => void;
  setAntigravityQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setCodexQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setGeminiCliQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setCursorQuotaLastUpdatedAt: (timestamp: number | null) => void;
  setZenQuotaLastUpdatedAt: (timestamp: number | null) => void;
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
  cursorQuota: {},
  zenQuota: {},
  antigravityQuotaLastUpdatedAt: null,
  codexQuotaLastUpdatedAt: null,
  geminiCliQuotaLastUpdatedAt: null,
  cursorQuotaLastUpdatedAt: null,
  zenQuotaLastUpdatedAt: null,
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
  setCursorQuota: (updater) =>
    set((state) => ({
      cursorQuota: resolveUpdater(updater, state.cursorQuota)
    })),
  setZenQuota: (updater) =>
    set((state) => ({
      zenQuota: resolveUpdater(updater, state.zenQuota)
    })),
  setAntigravityQuotaLastUpdatedAt: (timestamp) => set({ antigravityQuotaLastUpdatedAt: timestamp }),
  setCodexQuotaLastUpdatedAt: (timestamp) => set({ codexQuotaLastUpdatedAt: timestamp }),
  setGeminiCliQuotaLastUpdatedAt: (timestamp) => set({ geminiCliQuotaLastUpdatedAt: timestamp }),
  setCursorQuotaLastUpdatedAt: (timestamp) => set({ cursorQuotaLastUpdatedAt: timestamp }),
  setZenQuotaLastUpdatedAt: (timestamp) => set({ zenQuotaLastUpdatedAt: timestamp }),
  clearQuotaCache: () =>
    set({
      antigravityQuota: {},
      codexQuota: {},
      geminiCliQuota: {},
      cursorQuota: {},
      zenQuota: {},
      antigravityQuotaLastUpdatedAt: null,
      codexQuotaLastUpdatedAt: null,
      geminiCliQuotaLastUpdatedAt: null,
      cursorQuotaLastUpdatedAt: null,
      zenQuotaLastUpdatedAt: null
    })
}));
