import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/services/api/client';
import { pluginsApi } from '@/services/api/plugins';
import { useInterval } from '@/hooks/useInterval';
import {
  useThemeStore,
  useQuotaStore,
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
} from '@/stores';
import type { AuthFileItem, PluginListEntry } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { OAuthQuotaCards } from './OAuthQuotaCards';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  CURSOR_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from './quotaConfigs';
import { QuotaCard } from './QuotaCard';
import styles from '@/pages/QuotaPage.module.scss';

export interface ProviderQuotaReport {
  subscription?: { plan?: string };
  summary?: {
    key: string;
    label: string;
    value: number;
    unit?: string;
    format?: string;
    currency?: string;
  }[];
  groups?: {
    displayName?: string;
    buckets?: {
      window?: string;
      remainingFraction: number;
      resetTime?: string;
      description?: string;
    }[];
  }[];
}
type State = {
  status: 'loading' | 'success' | 'error';
  report?: ProviderQuotaReport;
  error?: string;
};

export function ProviderQuotaSection({
  files,
  disabled,
  stationKeepingEnabled,
}: {
  files: AuthFileItem[];
  disabled: boolean;
  stationKeepingEnabled: boolean;
}) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const generation = useQuotaStore((s) => s.cacheGeneration);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [plugins, setPlugins] = useState<PluginListEntry[]>([]);
  const [configuredFiles, setConfiguredFiles] = useState<AuthFileItem[]>([]);
  const [states, setStates] = useState<Record<string, State>>({});
  const [error, setError] = useState('');
  const pending = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    setPlugins([]);
    setConfiguredFiles([]);
    setStates({});
    setError('');
    pluginsApi
      .list()
      .then((data) => {
        if (!cancelled)
          setPlugins(data.plugins.filter((p) => p.effectiveEnabled && p.supportsQuota));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    apiClient
      .getV8<{ files: AuthFileItem[] }>('/credentials/configured-quota')
      .then((data) => {
        if (!cancelled) setConfiguredFiles(data.files);
      })
      .catch(() => {
        /* Older backends do not expose configured account quotas. */
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);
  const targets = useMemo(
    () => [
      ...plugins.flatMap((plugin) =>
        files
          .filter((file) => (file.provider || file.type) === (plugin.quotaProvider || plugin.id))
          .map((file) => ({ plugin, file }))
      ),
      ...configuredFiles.map((file) => ({ plugin: undefined, file })),
    ],
    [files, plugins, configuredFiles]
  );
  const refresh = useCallback(
    async (onlyName?: string) => {
      if (disabled) return;
      const currentGeneration = captureQuotaCacheGeneration();
      await Promise.all(
        targets
          .filter(({ file }) => !file.disabled && (!onlyName || file.name === onlyName))
          .map(async ({ plugin, file }) => {
            const key = file.name;
            const requestKey = `${currentGeneration}:${key}`;
            if (pending.current.has(requestKey)) return;
            pending.current.add(requestKey);
            setStates((s) => ({ ...s, [key]: { status: 'loading' } }));
            try {
              const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
              if (!authIndex) throw new Error(t('plugin_quota.missing_auth_index'));
              const report = plugin
                ? await pluginsApi.fetchQuota<ProviderQuotaReport>(plugin.id, authIndex)
                : await apiClient.postV8<ProviderQuotaReport>('/credentials/quota/native', {
                    auth_index: authIndex,
                  });
              if (!report.groups?.length && !report.summary?.length)
                throw new Error(t('plugin_quota.empty_report'));
              commitIfQuotaCacheCurrent(currentGeneration, () =>
                setStates((s) => ({ ...s, [key]: { status: 'success', report } }))
              );
            } catch (e: unknown) {
              commitIfQuotaCacheCurrent(currentGeneration, () =>
                setStates((s) => ({
                  ...s,
                  [key]: { status: 'error', error: e instanceof Error ? e.message : String(e) },
                }))
              );
            } finally {
              pending.current.delete(requestKey);
            }
          })
      );
    },
    [disabled, targets, t]
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useInterval(
    () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        setRefreshVersion((v) => v + 1);
      }
    },
    stationKeepingEnabled ? 300_000 : null
  );
  if (!targets.length && !files.length && !error) return null;
  return (
    <Card
      title={t('plugin_quota.title')}
      extra={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void refresh();
            setRefreshVersion((v) => v + 1);
          }}
          disabled={disabled}
        >
          {t('quota_management.refresh_all_credentials')}
        </Button>
      }
    >
      {error && <div className={styles.quotaError}>{error}</div>}
      <div className={styles.claudeGrid}>
        <OAuthQuotaCards
          config={CLAUDE_CONFIG}
          files={files}
          disabled={disabled}
          refreshVersion={refreshVersion}
        />
        <OAuthQuotaCards
          config={ANTIGRAVITY_CONFIG}
          files={files}
          disabled={disabled}
          refreshVersion={refreshVersion}
        />
        <OAuthQuotaCards
          config={CODEX_CONFIG}
          files={files}
          disabled={disabled}
          refreshVersion={refreshVersion}
        />
        <OAuthQuotaCards
          config={CURSOR_CONFIG}
          files={files}
          disabled={disabled}
          refreshVersion={refreshVersion}
        />
        <OAuthQuotaCards
          config={KIMI_CONFIG}
          files={files}
          disabled={disabled}
          refreshVersion={refreshVersion}
        />
        <OAuthQuotaCards
          config={XAI_CONFIG}
          files={files}
          disabled={disabled}
          refreshVersion={refreshVersion}
        />
        {targets.map(({ file }) => (
          <QuotaCard
            key={file.name}
            item={file}
            quota={states[file.name]}
            resolvedTheme={resolvedTheme}
            i18nPrefix="plugin_quota"
            defaultType={file.provider || file.type || 'plugin'}
            cardClassName=""
            canRefresh={!disabled && !file.disabled}
            onRefresh={() => void refresh(file.name)}
            renderQuotaItems={(state, translate, { QuotaProgressBar }) => (
              <>
                {Array.isArray(file.connections) && file.connections.length > 1 && (
                  <div className={styles.quotaMessage}>
                    {translate('plugin_quota.connections')}: {file.connections.join(', ')}
                  </div>
                )}
                {state.report?.subscription?.plan && (
                  <div className={styles.quotaModel}>{state.report.subscription.plan}</div>
                )}
                {state.report?.summary?.map((metric) => (
                  <div className={styles.quotaRow} key={metric.key}>
                    {metric.label}:{' '}
                    {Number.isFinite(metric.value)
                      ? metric.format === 'currency' && metric.currency
                        ? new Intl.NumberFormat(undefined, {
                            style: 'currency',
                            currency: metric.currency,
                          }).format(metric.value)
                        : metric.value.toLocaleString()
                      : '—'}{' '}
                    {metric.unit}
                  </div>
                ))}
                {state.report?.groups?.map((group, i) => (
                  <div key={i}>
                    <div className={styles.quotaModel}>{group.displayName}</div>
                    {group.buckets?.map((bucket, j) => (
                      <div className={styles.quotaRow} key={j}>
                        <div>
                          {bucket.window}:{' '}
                          {Number.isFinite(bucket.remainingFraction)
                            ? `${(Math.max(0, Math.min(1, bucket.remainingFraction)) * 100).toFixed(1)}% ${translate('plugin_quota.remaining')}`
                            : '—'}
                        </div>
                        <QuotaProgressBar
                          highThreshold={70}
                          mediumThreshold={30}
                          percent={
                            Number.isFinite(bucket.remainingFraction)
                              ? bucket.remainingFraction * 100
                              : null
                          }
                        />
                        {bucket.resetTime && (
                          <div>
                            {translate('plugin_quota.window_end')}:{' '}
                            {new Date(bucket.resetTime).toLocaleString()}
                          </div>
                        )}
                        {bucket.description && (
                          <div className={styles.quotaMessage}>{bucket.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          />
        ))}
      </div>
    </Card>
  );
}
