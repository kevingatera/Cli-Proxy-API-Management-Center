/**
 * Quota management page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useAuthStore, useQuotaStationKeepingStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import { ProviderQuotaSection } from '@/components/quota/ProviderQuotaSection';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const stationKeepingEnabled = useQuotaStationKeepingStore((state) => state.enabled);
  const setStationKeepingEnabled = useQuotaStationKeepingStore((state) => state.setEnabled);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';

  const loadFiles = useCallback(async () => {
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    }
  }, [t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

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

      <ProviderQuotaSection
        files={files}
        disabled={disableControls}
        stationKeepingEnabled={stationKeepingEnabled}
      />
    </div>
  );
}
