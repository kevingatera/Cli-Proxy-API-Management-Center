/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useQuotaStationKeepingStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG
} from '@/components/quota';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const stationKeepingEnabled = useQuotaStationKeepingStore((state) => state.enabled);
  const setStationKeepingEnabled = useQuotaStationKeepingStore((state) => state.setEnabled);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles()]);
  }, [loadConfig, loadFiles]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
  }, [loadFiles, loadConfig]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
        <div className={styles.stationKeepingRow}>
          <ToggleSwitch
            checked={stationKeepingEnabled}
            onChange={setStationKeepingEnabled}
            ariaLabel={t('quota_management.station_keeping_toggle_label')}
            label={t('quota_management.station_keeping_label')}
          />
          <span className={styles.stationKeepingHint}>
            {t('quota_management.station_keeping_hint')}
          </span>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        stationKeepingEnabled={stationKeepingEnabled}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        stationKeepingEnabled={stationKeepingEnabled}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        stationKeepingEnabled={stationKeepingEnabled}
      />
    </div>
  );
}
