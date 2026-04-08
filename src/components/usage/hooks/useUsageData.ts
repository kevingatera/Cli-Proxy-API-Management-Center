import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerPreferenceSync } from '@/hooks/useServerPreferenceSync';
import { useNotificationStore } from '@/stores';
import { usageApi } from '@/services/api/usage';
import { clearModelPrices, loadModelPrices, saveModelPrices, type ModelPrice } from '@/utils/usage';
import {
  CURSOR_REMOTE_SYNC_INTERVAL_MS,
  fetchBundledCursorPrices,
  OPENROUTER_REMOTE_SYNC_INTERVAL_MS,
  fetchBundledOpenRouterPrices,
  fetchCursorLatestPrices,
  fetchOpenRouterLatestPrices,
  getUsedModelNames,
  loadLastCursorRemoteSyncAt,
  loadLastOpenRouterRemoteSyncAt,
  mergeModelPricesForUsedModels,
  saveLastCursorRemoteSyncAt,
  saveLastOpenRouterRemoteSyncAt,
} from '@/utils/modelPrices';

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UseUsageDataReturn {
  usage: UsagePayload | null;
  loading: boolean;
  error: string;
  modelPrices: Record<string, ModelPrice>;
  setModelPrices: (prices: Record<string, ModelPrice>) => void;
  loadUsage: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleImport: () => void;
  handleImportChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  exporting: boolean;
  importing: boolean;
}

export function useUsageData(): UseUsageDataReturn {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>({});
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const syncingPricesRef = useRef(false);
  const lastAutoSyncSignatureRef = useRef('');
  const lastAutoSyncAtRef = useRef(0);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await usageApi.getUsage();
      const payload = data?.usage ?? data;
      setUsage(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('usage_stats.loading_error');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadUsage();
    setModelPrices(loadModelPrices());
  }, [loadUsage]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await usageApi.exportUsage();
      const exportedAt =
        typeof data?.exported_at === 'string' ? new Date(data.exported_at) : new Date();
      const safeTimestamp = Number.isNaN(exportedAt.getTime())
        ? new Date().toISOString()
        : exportedAt.toISOString();
      const filename = `usage-export-${safeTimestamp.replace(/[:.]/g, '-')}.json`;
      const blob = new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(url);
      showNotification(t('usage_stats.export_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        showNotification(t('usage_stats.import_invalid'), 'error');
        return;
      }

      const result = await usageApi.importUsage(payload);
      showNotification(
        t('usage_stats.import_success', {
          added: result?.added ?? 0,
          skipped: result?.skipped ?? 0,
          total: result?.total_requests ?? 0,
          failed: result?.failed_requests ?? 0
        }),
        'success'
      );
      await loadUsage();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setImporting(false);
    }
  };

  const handleSetModelPrices = useCallback((prices: Record<string, ModelPrice>) => {
    setModelPrices(prices);
    saveModelPrices(prices);
  }, []);

  useServerPreferenceSync(
    'usage-model-prices',
    modelPrices,
    handleSetModelPrices,
    { readLegacy: loadModelPrices, clearLegacy: clearModelPrices }
  );

  useEffect(() => {
    if (!usage || syncingPricesRef.current) {
      return;
    }

    const activeModelNames = getUsedModelNames(usage);
    if (!activeModelNames.length) {
      return;
    }

    const signature = activeModelNames.join('|');
    const retained = mergeModelPricesForUsedModels(modelPrices, {}, activeModelNames).nextPrices;
    const retainedKeys = Object.keys(retained);
    const currentKeys = Object.keys(modelPrices);
    if (
      retainedKeys.length !== currentKeys.length ||
      retainedKeys.some((key) => !Object.prototype.hasOwnProperty.call(modelPrices, key))
    ) {
      handleSetModelPrices(retained);
      return;
    }

    const missingModels = activeModelNames.filter(
      (name: string) => !Object.prototype.hasOwnProperty.call(modelPrices, name)
    );
    if (!missingModels.length) {
      lastAutoSyncSignatureRef.current = signature;
      return;
    }
    if (lastAutoSyncSignatureRef.current === signature && Date.now() - lastAutoSyncAtRef.current < 30_000) {
      return;
    }

    syncingPricesRef.current = true;
    lastAutoSyncSignatureRef.current = signature;
    lastAutoSyncAtRef.current = Date.now();

    void (async () => {
      let nextPrices = { ...modelPrices };
      let remainingMissing = [...missingModels];

      try {
        const bundled = await fetchBundledOpenRouterPrices();
        const mergedBundled = mergeModelPricesForUsedModels(nextPrices, bundled, activeModelNames);
        nextPrices = mergedBundled.nextPrices;
        remainingMissing = mergedBundled.missingModels;
        if (mergedBundled.added > 0) {
          handleSetModelPrices(nextPrices);
        }
      } catch {
        // Ignore local catalog errors and fall through to remote sync when needed.
      }

      if (remainingMissing.length) {
        try {
          const bundledCursor = await fetchBundledCursorPrices();
          const mergedBundledCursor = mergeModelPricesForUsedModels(nextPrices, bundledCursor, activeModelNames);
          nextPrices = mergedBundledCursor.nextPrices;
          remainingMissing = mergedBundledCursor.missingModels;
          if (mergedBundledCursor.added > 0) {
            handleSetModelPrices(nextPrices);
          }
        } catch {
          // Ignore local cursor catalog errors and fall through to remote sync when needed.
        }
      }

      if (remainingMissing.length) {
        const lastRemoteSync = loadLastOpenRouterRemoteSyncAt();
        if (Date.now() - lastRemoteSync >= OPENROUTER_REMOTE_SYNC_INTERVAL_MS) {
          try {
            const remote = await fetchOpenRouterLatestPrices();
            const mergedRemote = mergeModelPricesForUsedModels(nextPrices, remote, activeModelNames);
            nextPrices = mergedRemote.nextPrices;
            remainingMissing = mergedRemote.missingModels;
            saveLastOpenRouterRemoteSyncAt(Date.now());
            if (mergedRemote.added > 0) {
              handleSetModelPrices(nextPrices);
            }
          } catch {
            // Keep current prices if remote sync fails.
          }
        }
      }

      if (remainingMissing.length) {
        const lastCursorRemoteSync = loadLastCursorRemoteSyncAt();
        if (Date.now() - lastCursorRemoteSync >= CURSOR_REMOTE_SYNC_INTERVAL_MS) {
          try {
            const remoteCursor = await fetchCursorLatestPrices();
            const mergedRemoteCursor = mergeModelPricesForUsedModels(nextPrices, remoteCursor, activeModelNames);
            nextPrices = mergedRemoteCursor.nextPrices;
            remainingMissing = mergedRemoteCursor.missingModels;
            saveLastCursorRemoteSyncAt(Date.now());
            if (mergedRemoteCursor.added > 0) {
              handleSetModelPrices(nextPrices);
            }
          } catch {
            // Keep current prices if cursor remote sync fails.
          }
        }
      }

      try {
        if (!remainingMissing.length) {
          lastAutoSyncSignatureRef.current = activeModelNames.join('|');
        }
      } finally {
        syncingPricesRef.current = false;
      }
    })();
  }, [handleSetModelPrices, modelPrices, usage]);

  return {
    usage,
    loading,
    error,
    modelPrices,
    setModelPrices: handleSetModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing
  };
}
