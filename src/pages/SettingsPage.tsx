import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { authFilesApi, configApi } from '@/services/api';
import type {
  AuthFileItem,
  Config,
  RoutingPolicyConfig,
  RoutingPolicyRouteConfig,
  RoutingPreview,
  RoutingTrace,
} from '@/types';
import styles from './Settings/Settings.module.scss';

type PendingKey =
  | 'debug'
  | 'proxy'
  | 'retry'
  | 'logsMaxSize'
  | 'forceModelPrefix'
  | 'routingStrategy'
  | 'routingPolicy'
  | 'routingPreview'
  | 'routingTraces'
  | 'switchProject'
  | 'switchPreview'
  | 'usage'
  | 'loggingToFile'
  | 'wsAuth';

const DEFAULT_FALLBACK_TRIGGERS = ['exhausted', 'rate_limited', 'server_error', 'transport_error'];

// Human-readable descriptions for each fallback trigger, shown in the UI so
// operators understand what each toggle does without reading the docs.
const FALLBACK_TRIGGER_LABELS: Record<string, { label: string; hint: string }> = {
  exhausted: {
    label: 'exhausted',
    hint: 'Credential has no remaining quota (e.g. plan limit reached). Fall back to the next candidate.',
  },
  rate_limited: {
    label: 'rate_limited',
    hint: 'Upstream returned 429 / rate-limit. Fall back instead of waiting out the cooldown.',
  },
  server_error: {
    label: 'server_error',
    hint: 'Upstream returned a 5xx response. Try the next credential.',
  },
  transport_error: {
    label: 'transport_error',
    hint: 'Network failure (timeout, connection reset, DNS). Try the next credential.',
  },
};

const createDefaultRoutingPolicy = (): RoutingPolicyConfig => ({
  enabled: false,
  defaults: {
    route: [],
    includeRemainingProviders: true,
  },
  fallback: {
    on: DEFAULT_FALLBACK_TRIGGERS.slice(),
  },
  observability: {
    traceLimit: 200,
  },
});

const cloneRoutingPolicy = (policy: RoutingPolicyConfig): RoutingPolicyConfig =>
  JSON.parse(JSON.stringify(policy || createDefaultRoutingPolicy()));

const normalizeRoutingPolicy = (input?: RoutingPolicyConfig): RoutingPolicyConfig => {
  const base = cloneRoutingPolicy(input || createDefaultRoutingPolicy());
  base.enabled = Boolean(base.enabled);
  base.defaults = base.defaults || {};
  base.defaults.route = Array.isArray(base.defaults.route) ? base.defaults.route : [];
  base.defaults.includeRemainingProviders = base.defaults.includeRemainingProviders !== false;
  base.fallback = base.fallback || {};
  base.fallback.on = Array.isArray(base.fallback.on) && base.fallback.on.length
    ? Array.from(new Set(base.fallback.on.map((item) => String(item || '').trim()).filter(Boolean)))
    : DEFAULT_FALLBACK_TRIGGERS.slice();
  base.observability = base.observability || {};
  const traceLimit = Number(base.observability.traceLimit ?? 200);
  base.observability.traceLimit = Number.isFinite(traceLimit) ? Math.max(0, Math.min(2000, Math.trunc(traceLimit))) : 200;
  return base;
};

export function SettingsPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [loading, setLoading] = useState(true);
  const [proxyValue, setProxyValue] = useState('');
  const [retryValue, setRetryValue] = useState(0);
  const [logsMaxTotalSizeMb, setLogsMaxTotalSizeMb] = useState(0);
  const [routingStrategy, setRoutingStrategy] = useState('round-robin');
  const [routingPolicy, setRoutingPolicy] = useState<RoutingPolicyConfig>(createDefaultRoutingPolicy());
  // Tracks the last successfully saved policy so we can show an unsaved-changes
  // indicator on the Save button.
  const savedPolicyRef = useRef<RoutingPolicyConfig>(createDefaultRoutingPolicy());
  const routingPolicyDirty = JSON.stringify(normalizeRoutingPolicy(routingPolicy)) !== JSON.stringify(savedPolicyRef.current);
  const [routingPolicyAdvanced, setRoutingPolicyAdvanced] = useState(false);
  const [routingPolicyText, setRoutingPolicyText] = useState('');
  const [routingPreviewModel, setRoutingPreviewModel] = useState('gpt-5.4-mini');
  const [routingPreview, setRoutingPreview] = useState<RoutingPreview | null>(null);
  const [routingPreviewError, setRoutingPreviewError] = useState('');
  const [routingTraces, setRoutingTraces] = useState<RoutingTrace[]>([]);
  const [routingTraceFailedOnly, setRoutingTraceFailedOnly] = useState(false);
  const [authFiles, setAuthFiles] = useState<AuthFileItem[]>([]);
  const [pending, setPending] = useState<Record<PendingKey, boolean>>({} as Record<PendingKey, boolean>);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';
  const providerAuthIds: Record<string, string[]> = {};
  authFiles.forEach((item) => {
    const provider = String(item.provider || item.type || '').trim().toLowerCase();
    const authId = String(item.id || item.name || '').trim();
    if (!provider || !authId) return;
    if (!providerAuthIds[provider]) providerAuthIds[provider] = [];
    if (!providerAuthIds[provider].includes(authId)) providerAuthIds[provider].push(authId);
  });
  Object.keys(providerAuthIds).forEach((provider) => providerAuthIds[provider].sort());
  const providerOptions = Object.keys(providerAuthIds).sort();

  const setPendingFlag = (key: PendingKey, value: boolean) => {
    setPending((prev) => ({ ...prev, [key]: value }));
  };

  const refreshRoutingTraces = async (failedOnly = routingTraceFailedOnly) => {
    setPendingFlag('routingTraces', true);
    try {
      const traces = await configApi.getRoutingTraces({ limit: 30, failed: failedOnly });
      setRoutingTraces(traces);
    } catch (err: any) {
      showNotification(`Failed to refresh routing traces: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('routingTraces', false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [configResult, logsResult, prefixResult, routingResult, routingPolicyResult, authFilesResult, tracesResult] =
          await Promise.allSettled([
            fetchConfig(),
            configApi.getLogsMaxTotalSizeMb(),
            configApi.getForceModelPrefix(),
            configApi.getRoutingStrategy(),
            configApi.getRoutingPolicy(),
            authFilesApi.list(),
            configApi.getRoutingTraces({ limit: 20 }),
          ]);

        if (configResult.status !== 'fulfilled') throw configResult.reason;
        const data = configResult.value as Config;
        setProxyValue(data?.proxyUrl ?? '');
        setRetryValue(typeof data?.requestRetry === 'number' ? data.requestRetry : 0);
        if (logsResult.status === 'fulfilled' && Number.isFinite(logsResult.value)) {
          const normalizedLogsSize = Math.max(0, Number(logsResult.value));
          setLogsMaxTotalSizeMb(normalizedLogsSize);
          updateConfigValue('logs-max-total-size-mb', normalizedLogsSize);
        }
        if (prefixResult.status === 'fulfilled') {
          updateConfigValue('force-model-prefix', Boolean(prefixResult.value));
        }
        if (routingResult.status === 'fulfilled' && routingResult.value) {
          const nextStrategy = String(routingResult.value);
          setRoutingStrategy(nextStrategy);
          updateConfigValue('routing/strategy', nextStrategy);
        }
        if (routingPolicyResult.status === 'fulfilled') {
          const normalizedPolicy = normalizeRoutingPolicy(routingPolicyResult.value);
          setRoutingPolicy(normalizedPolicy);
          setRoutingPolicyText(JSON.stringify(normalizedPolicy, null, 2));
          savedPolicyRef.current = normalizedPolicy;
          updateConfigValue('routing/policy', normalizedPolicy);
        }
        if (authFilesResult.status === 'fulfilled') {
          setAuthFiles(Array.isArray(authFilesResult.value?.files) ? authFilesResult.value.files : []);
        }
        if (tracesResult.status === 'fulfilled') {
          setRoutingTraces(Array.isArray(tracesResult.value) ? tracesResult.value : []);
        }
      } catch (err: any) {
        setError(err?.message || t('notification.refresh_failed'));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [fetchConfig, t, updateConfigValue]);

  useEffect(() => {
    if (!config) return;
    setProxyValue(config.proxyUrl ?? '');
    if (typeof config.requestRetry === 'number') setRetryValue(config.requestRetry);
    if (typeof config.logsMaxTotalSizeMb === 'number') setLogsMaxTotalSizeMb(config.logsMaxTotalSizeMb);
    if (config.routingStrategy) setRoutingStrategy(config.routingStrategy);
    if (config.routingPolicy) {
      const normalizedPolicy = normalizeRoutingPolicy(config.routingPolicy);
      setRoutingPolicy(normalizedPolicy);
      setRoutingPolicyText(JSON.stringify(normalizedPolicy, null, 2));
    }
  }, [config?.proxyUrl, config?.requestRetry, config?.logsMaxTotalSizeMb, config?.routingStrategy, config?.routingPolicy]);

  const toggleSetting = async (
    section: PendingKey,
    rawKey: 'debug' | 'usage-statistics-enabled' | 'logging-to-file' | 'ws-auth' | 'force-model-prefix',
    value: boolean,
    updater: (val: boolean) => Promise<any>,
    successMessage: string
  ) => {
    const previous = (() => {
      switch (rawKey) {
        case 'debug':
          return config?.debug ?? false;
        case 'usage-statistics-enabled':
          return config?.usageStatisticsEnabled ?? false;
        case 'logging-to-file':
          return config?.loggingToFile ?? false;
        case 'ws-auth':
          return config?.wsAuth ?? false;
        case 'force-model-prefix':
          return config?.forceModelPrefix ?? false;
        default:
          return false;
      }
    })();

    setPendingFlag(section, true);
    updateConfigValue(rawKey, value);
    try {
      await updater(value);
      clearCache(rawKey);
      showNotification(successMessage, 'success');
    } catch (err: any) {
      updateConfigValue(rawKey, previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag(section, false);
    }
  };

  const handleProxyUpdate = async () => {
    const previous = config?.proxyUrl ?? '';
    setPendingFlag('proxy', true);
    updateConfigValue('proxy-url', proxyValue);
    try {
      await configApi.updateProxyUrl(proxyValue.trim());
      clearCache('proxy-url');
      showNotification(t('notification.proxy_updated'), 'success');
    } catch (err: any) {
      setProxyValue(previous);
      updateConfigValue('proxy-url', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('proxy', false);
    }
  };

  const handleProxyClear = async () => {
    const previous = config?.proxyUrl ?? '';
    setPendingFlag('proxy', true);
    updateConfigValue('proxy-url', '');
    try {
      await configApi.clearProxyUrl();
      clearCache('proxy-url');
      setProxyValue('');
      showNotification(t('notification.proxy_cleared'), 'success');
    } catch (err: any) {
      setProxyValue(previous);
      updateConfigValue('proxy-url', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('proxy', false);
    }
  };

  const handleRetryUpdate = async () => {
    const previous = config?.requestRetry ?? 0;
    const parsed = Number(retryValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      showNotification(t('login.error_invalid'), 'error');
      setRetryValue(previous);
      return;
    }
    setPendingFlag('retry', true);
    updateConfigValue('request-retry', parsed);
    try {
      await configApi.updateRequestRetry(parsed);
      clearCache('request-retry');
      showNotification(t('notification.retry_updated'), 'success');
    } catch (err: any) {
      setRetryValue(previous);
      updateConfigValue('request-retry', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('retry', false);
    }
  };

  const handleLogsMaxTotalSizeUpdate = async () => {
    const previous = config?.logsMaxTotalSizeMb ?? 0;
    const parsed = Number(logsMaxTotalSizeMb);
    if (!Number.isFinite(parsed) || parsed < 0) {
      showNotification(t('login.error_invalid'), 'error');
      setLogsMaxTotalSizeMb(previous);
      return;
    }
    const normalized = Math.max(0, parsed);
    setPendingFlag('logsMaxSize', true);
    updateConfigValue('logs-max-total-size-mb', normalized);
    try {
      await configApi.updateLogsMaxTotalSizeMb(normalized);
      clearCache('logs-max-total-size-mb');
      showNotification(t('notification.logs_max_total_size_updated'), 'success');
    } catch (err: any) {
      setLogsMaxTotalSizeMb(previous);
      updateConfigValue('logs-max-total-size-mb', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('logsMaxSize', false);
    }
  };

  const handleRoutingStrategyUpdate = async () => {
    const strategy = routingStrategy.trim();
    if (!strategy) {
      showNotification(t('login.error_invalid'), 'error');
      return;
    }
    const previous = config?.routingStrategy ?? 'round-robin';
    setPendingFlag('routingStrategy', true);
    updateConfigValue('routing/strategy', strategy);
    try {
      await configApi.updateRoutingStrategy(strategy);
      clearCache('routing/strategy');
      showNotification(t('notification.routing_strategy_updated'), 'success');
    } catch (err: any) {
      setRoutingStrategy(previous);
      updateConfigValue('routing/strategy', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('routingStrategy', false);
    }
  };

  const updateRoutingPolicy = (updater: (prev: RoutingPolicyConfig) => RoutingPolicyConfig) => {
    setRoutingPolicy((prev) => {
      const next = normalizeRoutingPolicy(updater(cloneRoutingPolicy(prev)));
      setRoutingPolicyText(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const addRoute = () => {
    updateRoutingPolicy((prev) => {
      const nextRoute: RoutingPolicyRouteConfig = {
        provider: providerOptions[0] || '',
        authOrder: [],
        includeRemainingAuth: true,
      };
      prev.defaults = prev.defaults || {};
      prev.defaults.route = [...(prev.defaults.route || []), nextRoute];
      return prev;
    });
  };

  const removeRoute = (index: number) => {
    updateRoutingPolicy((prev) => {
      prev.defaults = prev.defaults || {};
      prev.defaults.route = (prev.defaults.route || []).filter((_, i) => i !== index);
      return prev;
    });
  };

  const setRouteProvider = (index: number, provider: string) => {
    updateRoutingPolicy((prev) => {
      prev.defaults = prev.defaults || {};
      const route = [...(prev.defaults.route || [])];
      if (!route[index]) return prev;
      route[index] = {
        ...route[index],
        provider,
        authOrder: (route[index].authOrder || []).filter((authId) => (providerAuthIds[provider] || []).includes(authId)),
      };
      prev.defaults.route = route;
      return prev;
    });
  };

  const toggleRouteAuthOrder = (index: number, authId: string) => {
    updateRoutingPolicy((prev) => {
      prev.defaults = prev.defaults || {};
      const route = [...(prev.defaults.route || [])];
      if (!route[index]) return prev;
      const current = route[index];
      const order = [...(current.authOrder || [])];
      const existingIndex = order.indexOf(authId);
      if (existingIndex >= 0) {
        order.splice(existingIndex, 1);
      } else {
        order.push(authId);
      }
      route[index] = { ...current, authOrder: order };
      prev.defaults.route = route;
      return prev;
    });
  };

  const moveRoute = (index: number, direction: -1 | 1) => {
    updateRoutingPolicy((prev) => {
      prev.defaults = prev.defaults || {};
      const route = [...(prev.defaults.route || [])];
      const target = index + direction;
      if (index < 0 || target < 0 || target >= route.length) return prev;
      [route[index], route[target]] = [route[target], route[index]];
      prev.defaults.route = route;
      return prev;
    });
  };

  const toggleFallbackTrigger = (trigger: string) => {
    updateRoutingPolicy((prev) => {
      prev.fallback = prev.fallback || { on: [] };
      const on = new Set(prev.fallback.on || []);
      if (on.has(trigger)) {
        on.delete(trigger);
      } else {
        on.add(trigger);
      }
      prev.fallback.on = Array.from(on);
      return prev;
    });
  };

  const handleRoutingPolicyUpdate = async () => {
    const previous = normalizeRoutingPolicy(config?.routingPolicy || createDefaultRoutingPolicy());
    const policyToSave = normalizeRoutingPolicy(routingPolicy);
    setPendingFlag('routingPolicy', true);
    updateConfigValue('routing/policy', policyToSave);
    try {
      await configApi.updateRoutingPolicy(policyToSave);
      clearCache('routing/policy');
      savedPolicyRef.current = policyToSave;
      showNotification('Routing policy updated', 'success');
    } catch (err: any) {
      setRoutingPolicy(previous);
      setRoutingPolicyText(JSON.stringify(previous, null, 2));
      updateConfigValue('routing/policy', previous);
      showNotification(`Failed to update routing policy: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('routingPolicy', false);
    }
  };

  const applyAdvancedRoutingPolicy = () => {
    try {
      const parsed = JSON.parse(routingPolicyText || '{}');
      const normalized = normalizeRoutingPolicy(parsed);
      setRoutingPolicy(normalized);
      showNotification('Routing policy JSON loaded into guided editor', 'success');
    } catch (err: any) {
      showNotification(`Invalid routing policy JSON: ${err?.message || ''}`, 'error');
    }
  };

  const handleRoutingPreview = async () => {
    const model = routingPreviewModel.trim();
    if (!model) {
      showNotification('Model is required for preview', 'error');
      return;
    }
    setPendingFlag('routingPreview', true);
    setRoutingPreviewError('');
    try {
      const preview = await configApi.previewRouting(model);
      setRoutingPreview(preview);
    } catch (err: any) {
      setRoutingPreview(null);
      setRoutingPreviewError(err?.message || 'Preview failed');
    } finally {
      setPendingFlag('routingPreview', false);
    }
  };

  const quotaSwitchProject = config?.quotaExceeded?.switchProject ?? false;
  const quotaSwitchPreview = config?.quotaExceeded?.switchPreviewModel ?? false;
  const routingHintKey =
    routingStrategy === 'quota-aware'
      ? 'basic_settings.routing_strategy_hint_quota_aware'
      : 'basic_settings.routing_strategy_hint';

  // Plain-English summary of the current policy state, shown at the top of the
  // routing policy card so operators can see what's configured at a glance.
  const policySummary = (() => {
    if (!routingPolicy.enabled) {
      return 'Policy routing is off. Requests use the strategy above (round-robin / fill-first / quota-aware) without explicit provider ordering.';
    }
    const routes = routingPolicy.defaults?.route || [];
    const order = routes.map((r) => r.provider).filter(Boolean);
    const fallbacks = routingPolicy.fallback?.on || [];
    if (order.length === 0) {
      return `Policy is enabled but no route steps are defined. All providers are tried in their natural order${fallbacks.length ? `, falling back on: ${fallbacks.join(', ')}` : ' with no automatic fallback'}.`;
    }
    const orderStr = order.join(' -> ');
    const tail = routingPolicy.defaults?.includeRemainingProviders !== false ? ' + remaining' : '';
    const fbStr = fallbacks.length ? `, falling back on: ${fallbacks.join(', ')}` : ', stopping on any error';
    return `Try ${orderStr}${tail}${fbStr}.`;
  })();

  return (
    <div className={`page-shell ${styles.container}`}>
      <div className="page-header">
        <div className="page-heading">
          <h1 className="page-title">{t('basic_settings.title')}</h1>
          <p className="page-description">{t('basic_settings.description')}</p>
        </div>
      </div>

      <div className={styles.grid}>
        <Card>
          {error && <div className="error-box">{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ToggleSwitch
              label={t('basic_settings.debug_enable')}
              checked={config?.debug ?? false}
              disabled={disableControls || pending.debug || loading}
              onChange={(value) => toggleSetting('debug', 'debug', value, configApi.updateDebug, t('notification.debug_updated'))}
            />
            <ToggleSwitch
              label={t('basic_settings.usage_statistics_enable')}
              checked={config?.usageStatisticsEnabled ?? false}
              disabled={disableControls || pending.usage || loading}
              onChange={(value) =>
                toggleSetting(
                  'usage',
                  'usage-statistics-enabled',
                  value,
                  configApi.updateUsageStatistics,
                  t('notification.usage_statistics_updated')
                )
              }
            />
            <ToggleSwitch
              label={t('basic_settings.logging_to_file_enable')}
              checked={config?.loggingToFile ?? false}
              disabled={disableControls || pending.loggingToFile || loading}
              onChange={(value) =>
                toggleSetting(
                  'loggingToFile',
                  'logging-to-file',
                  value,
                  configApi.updateLoggingToFile,
                  t('notification.logging_to_file_updated')
                )
              }
            />
            <ToggleSwitch
              label={t('basic_settings.ws_auth_enable')}
              checked={config?.wsAuth ?? false}
              disabled={disableControls || pending.wsAuth || loading}
              onChange={(value) => toggleSetting('wsAuth', 'ws-auth', value, configApi.updateWsAuth, t('notification.ws_auth_updated'))}
            />
            <ToggleSwitch
              label={t('basic_settings.force_model_prefix_enable')}
              checked={config?.forceModelPrefix ?? false}
              disabled={disableControls || pending.forceModelPrefix || loading}
              onChange={(value) =>
                toggleSetting(
                  'forceModelPrefix',
                  'force-model-prefix',
                  value,
                  configApi.updateForceModelPrefix,
                  t('notification.force_model_prefix_updated')
                )
              }
            />
          </div>
        </Card>

        <Card title={t('basic_settings.routing_title')}>
          <div className={`${styles.retryRow} ${styles.retryRowAligned} ${styles.retryRowInputGrow}`}>
            <div className="form-group">
              <label>{t('basic_settings.routing_strategy_label')}</label>
              <select
                className="input"
                value={routingStrategy}
                onChange={(e) => setRoutingStrategy(e.target.value)}
                disabled={disableControls || loading}
              >
                <option value="round-robin">{t('basic_settings.routing_strategy_round_robin')}</option>
                <option value="fill-first">{t('basic_settings.routing_strategy_fill_first')}</option>
                <option value="quota-aware">{t('basic_settings.routing_strategy_quota_aware')}</option>
              </select>
              <div className="hint">{t(routingHintKey)}</div>
            </div>
            <Button
              className={styles.retryButton}
              onClick={handleRoutingStrategyUpdate}
              loading={pending.routingStrategy}
              disabled={disableControls || loading}
            >
              {t('basic_settings.routing_strategy_update')}
            </Button>
          </div>
        </Card>

        <Card title="Routing Policy" className={styles.fullWidth}>
          <div className={styles.policyHint}>
            Control the order in which providers and credentials are tried, and which errors trigger an automatic fallback to the next candidate.
          </div>
          <div className={styles.policySummary} role="status">
            {policySummary}
          </div>
          <div className={styles.policyTopRow}>
            <ToggleSwitch
              label="Enable policy routing"
              checked={Boolean(routingPolicy.enabled)}
              disabled={disableControls || loading}
              onChange={(value) => updateRoutingPolicy((prev) => ({ ...prev, enabled: value }))}
            />
            <ToggleSwitch
              label="Use advanced JSON editor"
              checked={routingPolicyAdvanced}
              disabled={disableControls || loading}
              onChange={(value) => setRoutingPolicyAdvanced(value)}
            />
          </div>

          {routingPolicyAdvanced ? (
            <div className={styles.policyAdvanced}>
              <textarea
                className={styles.policyEditor}
                value={routingPolicyText}
                onChange={(e) => setRoutingPolicyText(e.target.value)}
                disabled={disableControls || loading}
                rows={14}
              />
              <div className={styles.policyButtonRow}>
                <Button variant="secondary" onClick={applyAdvancedRoutingPolicy} disabled={disableControls || loading}>
                  Load JSON Into Guided Form
                </Button>
                <Button onClick={handleRoutingPolicyUpdate} loading={pending.routingPolicy} disabled={disableControls || loading}>
                  Save Policy{routingPolicyDirty && <span className={styles.unsavedDot} title="Unsaved changes" />}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.policyGuided}>
              {/* Step 1: Route order */}
              <div className={styles.policySubSection}>
                <div>
                  <p className={styles.policySubHeading}>1. Route order</p>
                  <p className={styles.policySubHint}>
                    List providers in the order they should be tried. Within each provider, click auth files to pin a preferred credential order. Unlisted providers are appended automatically when the toggle below is on.
                  </p>
                </div>
                <ToggleSwitch
                  label="Include unspecified providers after listed route order"
                  checked={routingPolicy.defaults?.includeRemainingProviders !== false}
                  disabled={disableControls || loading}
                  onChange={(value) =>
                    updateRoutingPolicy((prev) => ({
                      ...prev,
                      defaults: {
                        ...(prev.defaults || {}),
                        includeRemainingProviders: value,
                      },
                    }))
                  }
                />
                <div className={styles.routeList}>
                  {(routingPolicy.defaults?.route || []).map((route, index) => {
                    const provider = String(route.provider || '').trim().toLowerCase();
                    const availableAuthIds = providerAuthIds[provider] || [];
                    return (
                      <div key={`${provider}-${index}`} className={styles.routeCard}>
                        <div className={styles.routeHeader}>
                          <strong>Route #{index + 1}</strong>
                          <div className={styles.routeHeaderActions}>
                            <button
                              type="button"
                              className={styles.routeMoveBtn}
                              onClick={() => moveRoute(index, -1)}
                              disabled={disableControls || loading || index === 0}
                              title="Move up"
                              aria-label="Move route up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className={styles.routeMoveBtn}
                              onClick={() => moveRoute(index, 1)}
                              disabled={disableControls || loading || index === (routingPolicy.defaults?.route || []).length - 1}
                              title="Move down"
                              aria-label="Move route down"
                            >
                              ↓
                            </button>
                            <Button variant="secondary" onClick={() => removeRoute(index)} disabled={disableControls || loading}>
                              Remove
                            </Button>
                          </div>
                        </div>
                        <div className={styles.routeGrid}>
                          <div className="form-group">
                            <label>Provider</label>
                            <select
                              className="input"
                              value={provider}
                              onChange={(e) => setRouteProvider(index, e.target.value)}
                              disabled={disableControls || loading}
                            >
                              <option value="">Select provider</option>
                              {providerOptions.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>
                          <ToggleSwitch
                            label="Append remaining auths for this provider"
                            checked={route.includeRemainingAuth !== false}
                            disabled={disableControls || loading}
                            onChange={(value) =>
                              updateRoutingPolicy((prev) => {
                                const nextRoute = [...(prev.defaults?.route || [])];
                                if (!nextRoute[index]) return prev;
                                nextRoute[index] = {
                                  ...nextRoute[index],
                                  includeRemainingAuth: value,
                                };
                                return {
                                  ...prev,
                                  defaults: { ...(prev.defaults || {}), route: nextRoute },
                                };
                              })
                            }
                          />
                        </div>
                        <div className={styles.routeAuthSection}>
                          <div className={styles.routeAuthHeading}>Auth order (click to add/remove):</div>
                          <div className={styles.routeAuthPills}>
                            {availableAuthIds.length === 0 ? (
                              <span className={styles.routeAuthEmpty}>No auth IDs found for this provider</span>
                            ) : (
                              availableAuthIds.map((authId) => {
                                const selected = (route.authOrder || []).includes(authId);
                                return (
                                  <button
                                    key={authId}
                                    type="button"
                                    className={selected ? styles.routeAuthPillSelected : styles.routeAuthPill}
                                    onClick={() => toggleRouteAuthOrder(index, authId)}
                                    disabled={disableControls || loading}
                                    title={authId}
                                  >
                                    {authId}
                                  </button>
                                );
                              })
                            )}
                          </div>
                          <div className={styles.routeAuthCurrent}>
                            Ordered: {(route.authOrder || []).length ? (route.authOrder || []).join(' -> ') : 'none'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <Button variant="secondary" onClick={addRoute} disabled={disableControls || loading}>
                    Add Route Step
                  </Button>
                </div>
              </div>

              {/* Step 2: Fallback behavior */}
              <div className={styles.policySubSection}>
                <div>
                  <p className={styles.policySubHeading}>2. Fallback behavior</p>
                  <p className={styles.policySubHint}>
                    When a credential fails with one of the selected errors, automatically advance to the next candidate in the route order. Clear a checkbox to stop on that error class instead.
                  </p>
                </div>
                <div className={styles.fallbackRow}>
                  {DEFAULT_FALLBACK_TRIGGERS.map((trigger) => {
                    const checked = (routingPolicy.fallback?.on || []).includes(trigger);
                    const meta = FALLBACK_TRIGGER_LABELS[trigger] || { label: trigger, hint: '' };
                    return (
                      <label
                        key={trigger}
                        className={styles.fallbackItem}
                        title={meta.hint}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFallbackTrigger(trigger)}
                          disabled={disableControls || loading}
                        />
                        <span className={styles.fallbackItemText}>
                          <span className={styles.fallbackItemLabel}>{meta.label}</span>
                          <span className={styles.fallbackItemHint}>{meta.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className={styles.policyBottomRow}>
                  <Input
                    label="Trace retention limit (0-2000)"
                    type="number"
                    min={0}
                    max={2000}
                    value={routingPolicy.observability?.traceLimit ?? 200}
                    onChange={(e) =>
                      updateRoutingPolicy((prev) => ({
                        ...prev,
                        observability: {
                          ...(prev.observability || {}),
                          traceLimit: Number(e.target.value),
                        },
                      }))
                    }
                    disabled={disableControls || loading}
                  />
                  <Button onClick={handleRoutingPolicyUpdate} loading={pending.routingPolicy} disabled={disableControls || loading}>
                    Save Policy{routingPolicyDirty && <span className={styles.unsavedDot} title="Unsaved changes" />}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Test & observe */}
          <div className={styles.policySubSection}>
            <div>
              <p className={styles.policySubHeading}>3. Test &amp; observe</p>
              <p className={styles.policySubHint}>
                Preview the resolved route for a model, and review recent live traces to confirm fallbacks fire as intended.
              </p>
            </div>
            <div className={styles.previewSection}>
              <div className={styles.retryRow}>
                <Input
                  label="Model"
                  value={routingPreviewModel}
                  onChange={(e) => setRoutingPreviewModel(e.target.value)}
                  disabled={disableControls || loading}
                  className={styles.retryInput}
                />
                <Button onClick={handleRoutingPreview} loading={pending.routingPreview} disabled={disableControls || loading}>
                  Preview
                </Button>
              </div>
              {routingPreviewError && <div className="error-box">{routingPreviewError}</div>}
              {routingPreview && (
                <div className={styles.previewResult}>
                  <div>Strategy: {routingPreview.strategy}</div>
                  <div>Policy enabled: {routingPreview.policyEnabled ? 'yes' : 'no'}</div>
                  <div>Ordered providers: {(routingPreview.orderedProviders || []).join(' -> ') || 'none'}</div>
                  {(routingPreview.providerDetails || []).map((detail) => (
                    <div key={detail.provider} className={styles.previewProviderRow}>
                      <strong>{detail.provider}</strong>
                      <span>Auth order: {(detail.authOrder || []).join(' -> ') || 'auto'}</span>
                      <span>Available auths: {(detail.availableAuthIds || []).join(', ') || 'none'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.tracesSection}>
              <div className={styles.policyTopRow}>
                <ToggleSwitch
                  label="Failed only"
                  checked={routingTraceFailedOnly}
                  disabled={disableControls || loading}
                  onChange={(value) => {
                    setRoutingTraceFailedOnly(value);
                    refreshRoutingTraces(value);
                  }}
                />
                <Button onClick={() => refreshRoutingTraces(routingTraceFailedOnly)} loading={pending.routingTraces} disabled={disableControls || loading}>
                  Refresh Traces
                </Button>
              </div>
              <div className={styles.traceList}>
                {routingTraces.length === 0 ? (
                  <div className={styles.routeAuthEmpty}>No traces yet. Send a request through the proxy to see how routing decisions are made.</div>
                ) : (
                  routingTraces.map((trace) => (
                    <div key={trace.id} className={styles.traceCard}>
                      <div className={styles.traceHead}>
                        <strong>{trace.model}</strong>
                        <span>{trace.operation}</span>
                        <span>{trace.finalStatus}</span>
                      </div>
                      <div className={styles.traceMeta}>
                        Providers: {(trace.orderedProviders || trace.providers || []).join(' -> ')}
                      </div>
                      <div className={styles.traceMeta}>
                        Attempts:{' '}
                        {(trace.attempts || [])
                          .map((attempt) => `${attempt.provider}/${attempt.authId || 'auto'}:${attempt.success ? 'ok' : 'err'}`)
                          .join(', ') || 'none'}
                      </div>
                      {trace.error && <div className={styles.traceError}>Error: {trace.error}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card title={t('basic_settings.proxy_title')}>
          <Input
            label={t('basic_settings.proxy_url_label')}
            placeholder={t('basic_settings.proxy_url_placeholder')}
            value={proxyValue}
            onChange={(e) => setProxyValue(e.target.value)}
            disabled={disableControls || loading}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <Button variant="secondary" onClick={handleProxyClear} disabled={disableControls || pending.proxy || loading}>
              {t('basic_settings.proxy_clear')}
            </Button>
            <Button onClick={handleProxyUpdate} loading={pending.proxy} disabled={disableControls || loading}>
              {t('basic_settings.proxy_update')}
            </Button>
          </div>
        </Card>

        <Card title={t('basic_settings.retry_title')}>
          <div className={styles.retryRow}>
            <Input
              label={t('basic_settings.retry_count_label')}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={retryValue}
              onChange={(e) => setRetryValue(Number(e.target.value))}
              disabled={disableControls || loading}
              className={styles.retryInput}
            />
            <Button className={styles.retryButton} onClick={handleRetryUpdate} loading={pending.retry} disabled={disableControls || loading}>
              {t('basic_settings.retry_update')}
            </Button>
          </div>
        </Card>

        <Card title={t('basic_settings.logs_max_total_size_title')}>
          <div className={`${styles.retryRow} ${styles.retryRowAligned} ${styles.retryRowInputGrow}`}>
            <Input
              label={t('basic_settings.logs_max_total_size_label')}
              hint={t('basic_settings.logs_max_total_size_hint')}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={logsMaxTotalSizeMb}
              onChange={(e) => setLogsMaxTotalSizeMb(Number(e.target.value))}
              disabled={disableControls || loading}
              className={styles.retryInput}
            />
            <Button
              className={styles.retryButton}
              onClick={handleLogsMaxTotalSizeUpdate}
              loading={pending.logsMaxSize}
              disabled={disableControls || loading}
            >
              {t('basic_settings.logs_max_total_size_update')}
            </Button>
          </div>
        </Card>

        <Card title={t('basic_settings.quota_title')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ToggleSwitch
              label={t('basic_settings.quota_switch_project')}
              checked={quotaSwitchProject}
              disabled={disableControls || pending.switchProject || loading}
              onChange={(value) =>
                (async () => {
                  const previous = config?.quotaExceeded?.switchProject ?? false;
                  const nextQuota = { ...(config?.quotaExceeded || {}), switchProject: value };
                  setPendingFlag('switchProject', true);
                  updateConfigValue('quota-exceeded', nextQuota);
                  try {
                    await configApi.updateSwitchProject(value);
                    clearCache('quota-exceeded');
                    showNotification(t('notification.quota_switch_project_updated'), 'success');
                  } catch (err: any) {
                    updateConfigValue('quota-exceeded', { ...(config?.quotaExceeded || {}), switchProject: previous });
                    showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
                  } finally {
                    setPendingFlag('switchProject', false);
                  }
                })()
              }
            />
            <ToggleSwitch
              label={t('basic_settings.quota_switch_preview')}
              checked={quotaSwitchPreview}
              disabled={disableControls || pending.switchPreview || loading}
              onChange={(value) =>
                (async () => {
                  const previous = config?.quotaExceeded?.switchPreviewModel ?? false;
                  const nextQuota = { ...(config?.quotaExceeded || {}), switchPreviewModel: value };
                  setPendingFlag('switchPreview', true);
                  updateConfigValue('quota-exceeded', nextQuota);
                  try {
                    await configApi.updateSwitchPreviewModel(value);
                    clearCache('quota-exceeded');
                    showNotification(t('notification.quota_switch_preview_updated'), 'success');
                  } catch (err: any) {
                    updateConfigValue('quota-exceeded', { ...(config?.quotaExceeded || {}), switchPreviewModel: previous });
                    showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
                  } finally {
                    setPendingFlag('switchPreview', false);
                  }
                })()
              }
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
