/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Card } from '@/components/ui/Card';
import { useAuthStore, useConfigStore, useQuotaStationKeepingStore, useQuotaStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG
} from '@/components/quota';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { AuthFileItem } from '@/types';
import { isCodexFile, isRuntimeOnlyAuthFile } from '@/utils/quota';
import styles from './QuotaPage.module.scss';

const strategyLabelKey = (strategy?: string | null) => {
  switch (strategy) {
    case 'fill-first':
      return 'basic_settings.routing_strategy_fill_first';
    case 'quota-aware':
      return 'basic_settings.routing_strategy_quota_aware';
    case 'round-robin':
    default:
      return 'basic_settings.routing_strategy_round_robin';
  }
};

const formatRelativeTime = (timestamp: number, locale: string) => {
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  let value = diffSeconds;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  if (absSeconds >= 60 && absSeconds < 3600) {
    value = Math.round(diffSeconds / 60);
    unit = 'minute';
  } else if (absSeconds >= 3600 && absSeconds < 86400) {
    value = Math.round(diffSeconds / 3600);
    unit = 'hour';
  } else if (absSeconds >= 86400) {
    value = Math.round(diffSeconds / 86400);
    unit = 'day';
  }

  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
  } catch {
    const safeValue = Math.abs(value);
    return `${safeValue} ${unit}${safeValue === 1 ? '' : 's'} ${value < 0 ? 'ago' : ''}`.trim();
  }
};

export function QuotaPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const stationKeepingEnabled = useQuotaStationKeepingStore((state) => state.enabled);
  const setStationKeepingEnabled = useQuotaStationKeepingStore((state) => state.setEnabled);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const codexQuotaLastUpdatedAt = useQuotaStore((state) => state.codexQuotaLastUpdatedAt);

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

  const codexRecommendation = useMemo(() => {
    const codexFiles = files.filter((file) => isCodexFile(file) && !isRuntimeOnlyAuthFile(file));
    if (!codexFiles.length) {
      return {
        currentStrategy: config?.routingStrategy ?? 'round-robin',
        recommendedStrategy: 'round-robin',
        coverage: '0/0',
        bestName: t('quota_management.routing_unknown'),
        bestRemaining: null as number | null,
        updatedLabel: t('quota_management.routing_not_refreshed'),
        reason: t('quota_management.routing_reason_empty'),
        ranked: [] as Array<{ name: string; planType: string | null; remainingPercent: number }>
      };
    }

    const ranked = codexFiles
      .map((file) => {
        const quota = codexQuota[file.name];
        const remainingPercent = (quota?.windows ?? []).reduce<number | null>((lowest, window) => {
          if (typeof window.usedPercent !== 'number') return lowest;
          const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
          if (lowest === null) return remaining;
          return Math.min(lowest, remaining);
        }, null);
        return {
          name: file.name,
          planType: quota?.planType ?? null,
          remainingPercent,
        };
      })
      .filter((entry): entry is { name: string; planType: string | null; remainingPercent: number } => entry.remainingPercent !== null)
      .sort((left, right) => right.remainingPercent - left.remainingPercent);

    const currentStrategy = config?.routingStrategy ?? 'round-robin';
    const updatedLabel = codexQuotaLastUpdatedAt
      ? t('quota_management.routing_updated', {
          time: formatRelativeTime(codexQuotaLastUpdatedAt, i18n.language)
        })
      : t('quota_management.routing_not_refreshed');

    if (codexFiles.length === 1) {
      return {
        currentStrategy,
        recommendedStrategy: 'round-robin',
        coverage: `${ranked.length}/${codexFiles.length}`,
        bestName: codexFiles[0].name,
        bestRemaining: ranked[0]?.remainingPercent ?? null,
        updatedLabel,
        reason: t('quota_management.routing_reason_single'),
        ranked
      };
    }

    if (ranked.length >= 2) {
      return {
        currentStrategy,
        recommendedStrategy: 'quota-aware',
        coverage: `${ranked.length}/${codexFiles.length}`,
        bestName: ranked[0].name,
        bestRemaining: ranked[0].remainingPercent,
        updatedLabel,
        reason: t('quota_management.routing_reason_quota_aware', {
          best: ranked[0].name,
          bestRemaining: ranked[0].remainingPercent,
          next: ranked[1].name,
          nextRemaining: ranked[1].remainingPercent
        }),
        ranked
      };
    }

    return {
      currentStrategy,
      recommendedStrategy: 'round-robin',
      coverage: `${ranked.length}/${codexFiles.length}`,
      bestName: ranked[0]?.name ?? t('quota_management.routing_unknown'),
      bestRemaining: ranked[0]?.remainingPercent ?? null,
      updatedLabel,
      reason: codexQuotaLastUpdatedAt
        ? t('quota_management.routing_reason_round_robin')
        : t('quota_management.routing_refresh_hint'),
      ranked
    };
  }, [codexQuota, codexQuotaLastUpdatedAt, config?.routingStrategy, files, i18n.language, t]);

  return (
    <div className={`page-shell ${styles.container}`}>
      <div className="page-header">
        <div className="page-heading">
          <h1 className="page-title">{t('quota_management.title')}</h1>
          <p className="page-description">{t('quota_management.description')}</p>
        </div>
        <div className={`page-actions ${styles.stationKeepingRow}`}>
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

      <Card className={styles.recommendationCard} title={t('quota_management.routing_recommendation_title')}>
        <div className={styles.recommendationIntro}>
          <p className={styles.recommendationDescription}>
            {t('quota_management.routing_recommendation_description')}
          </p>
          <span className={styles.recommendationUpdated}>{codexRecommendation.updatedLabel}</span>
        </div>

        <div className={styles.recommendationGrid}>
          <div className={styles.recommendationMetric}>
            <span className={styles.recommendationLabel}>{t('quota_management.routing_current')}</span>
            <strong className={styles.recommendationValue}>
              {t(strategyLabelKey(codexRecommendation.currentStrategy))}
            </strong>
          </div>
          <div className={styles.recommendationMetric}>
            <span className={styles.recommendationLabel}>{t('quota_management.routing_recommended')}</span>
            <strong className={styles.recommendationValue}>
              {t(strategyLabelKey(codexRecommendation.recommendedStrategy))}
            </strong>
          </div>
          <div className={styles.recommendationMetric}>
            <span className={styles.recommendationLabel}>{t('quota_management.routing_coverage')}</span>
            <strong className={styles.recommendationValue}>{codexRecommendation.coverage}</strong>
          </div>
          <div className={styles.recommendationMetric}>
            <span className={styles.recommendationLabel}>{t('quota_management.routing_best')}</span>
            <strong className={styles.recommendationValue}>
              {codexRecommendation.bestName}
              {typeof codexRecommendation.bestRemaining === 'number'
                ? ` · ${codexRecommendation.bestRemaining}%`
                : ''}
            </strong>
          </div>
        </div>

        <p className={styles.recommendationReason}>{codexRecommendation.reason}</p>

        {codexRecommendation.ranked.length > 0 && (
          <div className={styles.recommendationList}>
            {codexRecommendation.ranked.slice(0, 3).map((entry) => (
              <div key={entry.name} className={styles.recommendationItem}>
                <span className={styles.recommendationItemName}>{entry.name}</span>
                <span className={styles.recommendationItemMeta}>
                  {entry.planType ? `${entry.planType} · ` : ''}{entry.remainingPercent}%
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

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
