import { useEffect, useRef } from 'react';
import { uiPreferencesApi } from '@/services/api';

const isEmptyObject = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return true;
  }
  return Object.keys(value).length === 0;
};

interface UseServerPreferenceSyncOptions<T extends Record<string, unknown>> {
  readLegacy?: () => T;
  clearLegacy?: () => void;
  enabled?: boolean;
}

export function useServerPreferenceSync<T extends Record<string, unknown>>(
  key: string,
  state: T,
  applyState: (value: T) => void,
  options?: UseServerPreferenceSyncOptions<T>
) {
  const enabled = options?.enabled !== false;
  const readLegacy = options?.readLegacy;
  const clearLegacy = options?.clearLegacy;
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;

    const run = async () => {
      if (!enabled) {
        hydratedRef.current = true;
        return;
      }

      try {
        const serverState = await uiPreferencesApi.getSection<T>(key);
        if (!cancelled && !isEmptyObject(serverState)) {
          applyState(serverState);
          hydratedRef.current = true;
          return;
        }

        if (readLegacy) {
          const legacyState = readLegacy();
          if (!cancelled && !isEmptyObject(legacyState)) {
            applyState(legacyState);
            await uiPreferencesApi.putSection(key, legacyState);
            clearLegacy?.();
          }
        }
      } catch {
        if (!cancelled && readLegacy) {
          const legacyState = readLegacy();
          if (!isEmptyObject(legacyState)) {
            applyState(legacyState);
          }
        }
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [applyState, clearLegacy, enabled, key, readLegacy]);

  useEffect(() => {
    if (!enabled || !hydratedRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void uiPreferencesApi.putSection(key, state);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [enabled, key, state]);
}
