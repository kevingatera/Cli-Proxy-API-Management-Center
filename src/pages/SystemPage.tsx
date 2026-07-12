import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { IconGithub, IconBookOpen, IconExternalLink, IconCode } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useConfigStore, useNotificationStore, useModelsStore } from '@/stores';
import { apiKeysApi } from '@/services/api/apiKeys';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { classifyModels } from '@/utils/models';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import styles from './SystemPage.module.scss';

const SYSTEM_MODEL_TEST_TIMEOUT_MS = 30_000;
const SMOKE_TEST_VARIANTS = ['', 'fast', 'minimal', 'low', 'medium', 'high', 'xhigh', 'auto', 'none'];
// Above this tag count a model group collapses to just a header row until expanded.
const MODEL_GROUP_COLLAPSE_THRESHOLD = 8;

const splitSmokeTestModel = (value: string): { model: string; variant: string } => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return { model: '', variant: '' };
  }

  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash <= 0 || lastSlash === trimmed.length - 1) {
    return { model: trimmed, variant: '' };
  }

  const tail = trimmed.slice(lastSlash + 1).trim().toLowerCase();
  if (!SMOKE_TEST_VARIANTS.includes(tail)) {
    return { model: trimmed, variant: '' };
  }

  return {
    model: trimmed.slice(0, lastSlash).trim(),
    variant: tail,
  };
};

const buildSmokeTestModel = (model: string, variant: string): string => {
  const trimmedModel = String(model || '').trim();
  const trimmedVariant = String(variant || '').trim();
  if (!trimmedModel) return '';
  if (!trimmedVariant) return trimmedModel;
  return `${trimmedModel}/${trimmedVariant}`;
};

const normalizeProxyBaseUrl = (baseUrl: string): string => {
  let normalized = String(baseUrl || '').trim();
  if (!normalized) return '';
  normalized = normalized.replace(/\/?v0\/management\/?$/i, '');
  normalized = normalized.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  return normalized;
};

const buildProxyChatCompletionsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeProxyBaseUrl(baseUrl);
  if (!normalized) return '';
  return `${normalized}/v1/chat/completions`;
};

const extractTextSegments = (input: unknown): string[] => {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((entry) => extractTextSegments(entry));
  }

  if (input && typeof input === 'object') {
    const candidate = input as Record<string, unknown>;
    return [
      ...extractTextSegments(candidate.text),
      ...extractTextSegments(candidate.content),
      ...extractTextSegments(candidate.output_text),
    ];
  }

  return [];
};

const extractChatResponseText = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const body = payload as Record<string, unknown>;
  const choices = Array.isArray(body.choices) ? body.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const message = (choice as Record<string, unknown>).message;
    const text = extractTextSegments(message).join('\n').trim();
    if (text) return text;
  }

  return extractTextSegments(body.output ?? body.output_text ?? body.content).join('\n').trim();
};

/**
 * A single model-group row in the System page models card.
 *
 * Groups with more than MODEL_GROUP_COLLAPSE_THRESHOLD tags collapse to just
 * the header (label + count) by default and expand on click. This keeps the
 * page readable when a group has dozens of tags (e.g. 131 GPT variants).
 *
 * The open/closed state is owned by the parent (SystemPage) via the
 * expandedGroups set so that toggles survive re-renders even if the
 * groupedModels array is recomputed.
 */
function ModelGroupRow({
  group,
  modelsCountLabel,
  open,
  onToggle,
}: {
  group: { id: string; label: string; items: { name: string; alias?: string; description?: string }[] };
  modelsCountLabel: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const count = group.items.length;
  const collapsible = count > MODEL_GROUP_COLLAPSE_THRESHOLD;

  return (
    <div className="item-row">
      <div className="item-meta">
        <div
          className={`item-title ${collapsible ? styles.clickableTitle : ''}`}
          onClick={collapsible ? onToggle : undefined}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          onKeyDown={
            collapsible
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle();
                  }
                }
              : undefined
          }
        >
          {collapsible ? <span className={styles.collapseChevron}>{open ? '▾' : '▸'}</span> : null}
          {group.label}
        </div>
        <div className="item-subtitle">{modelsCountLabel}</div>
      </div>
      {open && (
        <div className={styles.modelTags}>
          {group.items.map((model) => (
            <span
              key={`${model.name}-${model.alias ?? 'default'}`}
              className={styles.modelTag}
              title={model.description || ''}
            >
              <span className={styles.modelName}>{model.name}</span>
              {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
            </span>
          ))}
        </div>
      )}
      {collapsible && !open && (
        <button type="button" className={styles.listToggle} onClick={onToggle}>
          {t('common.show_all_count', { defaultValue: 'Show all {{count}}', count })}
        </button>
      )}
    </div>
  );
}

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelStatus, setModelStatus] = useState<{ type: 'success' | 'warning' | 'error' | 'muted'; message: string }>();
  // Track which large model groups the user has expanded. Small groups (<=
  // MODEL_GROUP_COLLAPSE_THRESHOLD) are always open and not tracked here.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);
  const [smokeTestModel, setSmokeTestModel] = useState('');
  const [smokeTestVariant, setSmokeTestVariant] = useState('');
  const [smokeTestPrompt, setSmokeTestPrompt] = useState(() => 'Reply with OK only.');
  const [smokeTestRunning, setSmokeTestRunning] = useState(false);
  const [smokeTestStatus, setSmokeTestStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  }>();
  const [smokeTestResult, setSmokeTestResult] = useState<{
    statusCode: number;
    resolvedModel: string;
    content: string;
  } | null>(null);

  const apiKeysCache = useRef<string[]>([]);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);
  const modelOptions = useMemo(() => Array.from(new Set(models.map((model) => model.name).filter(Boolean))).sort(), [models]);
  const preferredSmokeTestModel = useMemo(() => {
    const names = new Set(modelOptions);
    if (names.has('gpt-5.4')) return 'gpt-5.4/fast';
    if (names.has('gpt-5')) return 'gpt-5/fast';
    return modelOptions[0] || '';
  }, [modelOptions]);

  const normalizeApiKeyList = (input: any): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const value = typeof item === 'string' ? item : item?.['api-key'] ?? item?.apiKey ?? '';
      const trimmed = String(value || '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch (err) {
      console.warn('Auto loading API keys for models failed:', err);
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required')
      });
      return;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    if (forceRefresh) {
      apiKeysCache.current = [];
    }

    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      const list = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh);
      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels ? t('system_info.models_count', { count: list.length }) : t('system_info.models_empty')
      });
    } catch (err: any) {
      const message = `${t('system_info.models_error')}: ${err?.message || ''}`;
      setModelStatus({ type: 'error', message });
    }
  };

  const handleRunSmokeTest = useCallback(async () => {
    if (auth.connectionStatus !== 'connected' || !auth.apiBase) {
      const message = t('notification.connection_required');
      setSmokeTestStatus({ type: 'warning', message });
      showNotification(message, 'warning');
      return;
    }

    const modelName = buildSmokeTestModel(smokeTestModel, smokeTestVariant);
    if (!modelName) {
      const message = t('system_info.smoke_test_model_required');
      setSmokeTestStatus({ type: 'error', message });
      showNotification(message, 'error');
      return;
    }

    const prompt = smokeTestPrompt.trim();
    if (!prompt) {
      const message = t('system_info.smoke_test_prompt_required');
      setSmokeTestStatus({ type: 'error', message });
      showNotification(message, 'error');
      return;
    }

    const endpoint = buildProxyChatCompletionsEndpoint(auth.apiBase);
    if (!endpoint) {
      const message = t('notification.connection_required');
      setSmokeTestStatus({ type: 'error', message });
      showNotification(message, 'error');
      return;
    }

    setSmokeTestRunning(true);
    setSmokeTestResult(null);
    setSmokeTestStatus({ type: 'muted', message: t('system_info.smoke_test_running') });

    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      if (!primaryKey) {
        const message = t('system_info.smoke_test_key_missing');
        setSmokeTestStatus({ type: 'error', message });
        showNotification(message, 'error');
        return;
      }

      const result = await apiCallApi.request(
        {
          method: 'POST',
          url: endpoint,
          header: {
            Authorization: `Bearer ${primaryKey}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
          }),
        },
        { timeout: SYSTEM_MODEL_TEST_TIMEOUT_MS }
      );

      const payload = result.body && typeof result.body === 'object' ? result.body : null;
      const responseText = extractChatResponseText(payload);
      const content = responseText || result.bodyText || t('system_info.smoke_test_empty_result');
      const resolvedModel = String((payload as { model?: unknown } | null)?.model || modelName);

      setSmokeTestResult({
        statusCode: result.statusCode,
        resolvedModel,
        content,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        setSmokeTestStatus({
          type: 'error',
          message: `${t('system_info.smoke_test_failed')}: ${getApiCallErrorMessage(result)}`,
        });
        return;
      }

      setSmokeTestStatus({ type: 'success', message: t('system_info.smoke_test_success') });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || '');
      const errorCode =
        typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: string }).code) : '';
      const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
      setSmokeTestStatus({
        type: 'error',
        message: isTimeout
          ? t('system_info.smoke_test_timeout', { seconds: SYSTEM_MODEL_TEST_TIMEOUT_MS / 1000 })
          : `${t('system_info.smoke_test_failed')}: ${message}`,
      });
      setSmokeTestResult(null);
    } finally {
      setSmokeTestRunning(false);
    }
  }, [
    auth.apiBase,
    auth.connectionStatus,
    resolveApiKeysForModels,
    showNotification,
    smokeTestModel,
    smokeTestPrompt,
    smokeTestVariant,
    t,
  ]);

  const handleClearLoginStorage = () => {
    showConfirmation({
      title: t('system_info.clear_login_title', { defaultValue: 'Clear Login Storage' }),
      message: t('system_info.clear_login_confirm'),
      details: [
        t('system_info.clear_login_detail_credentials'),
        t('system_info.clear_login_detail_reconnect'),
      ],
      variant: 'danger',
      confirmText: t('system_info.clear_login_button'),
      onConfirm: () => {
        auth.logout();
        if (typeof localStorage === 'undefined') return;
        const keysToRemove = [STORAGE_KEY_AUTH, 'isLoggedIn', 'apiBase', 'apiUrl', 'managementKey'];
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        showNotification(t('notification.login_storage_cleared'), 'success');
      },
    });
  };

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore
    });
  }, [fetchConfig]);

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.connectionStatus, auth.apiBase]);

  useHeaderRefresh(async () => {
    await fetchConfig(undefined, true);
    await fetchModels({ forceRefresh: true });
  });

  useEffect(() => {
    if (smokeTestModel.trim()) {
      return;
    }
    if (preferredSmokeTestModel) {
      const parsed = splitSmokeTestModel(preferredSmokeTestModel);
      setSmokeTestModel(parsed.model);
      setSmokeTestVariant(parsed.variant);
    }
  }, [preferredSmokeTestModel, smokeTestModel]);

  return (
    <div className={`page-shell ${styles.container}`}>
      <div className="page-header">
        <div className="page-heading">
          <h1 className="page-title">{t('system_info.title')}</h1>
          <p className="page-description">{t('system_info.description')}</p>
        </div>
      </div>
      <div className={styles.content}>
      <Card
        title={t('system_info.connection_status_title')}
        extra={
          <Button variant="secondary" size="sm" onClick={() => fetchConfig(undefined, true)}>
            {t('common.refresh')}
          </Button>
        }
      >
        <div className="grid cols-2">
          <div className="stat-card">
            <div className="stat-label">{t('connection.server_address')}</div>
            <div className="stat-value">{auth.apiBase || '-'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('footer.api_version')}</div>
            <div className="stat-value">{auth.serverVersion || t('system_info.version_unknown')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('footer.build_date')}</div>
            <div className="stat-value">
              {auth.serverBuildDate ? new Date(auth.serverBuildDate).toLocaleString() : t('system_info.version_unknown')}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('connection.status')}</div>
            <div className="stat-value">{t(`common.${auth.connectionStatus}_status` as any)}</div>
          </div>
        </div>
      </Card>

      <Card title={t('system_info.quick_links_title')}>
        <p className={styles.sectionDescription}>{t('system_info.quick_links_desc')}</p>
        <div className={styles.quickLinks}>
          <a
            href="https://github.com/router-for-me/CLIProxyAPI"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.linkCard}
          >
            <div className={`${styles.linkIcon} ${styles.github}`}>
              <IconGithub size={22} />
            </div>
            <div className={styles.linkContent}>
              <div className={styles.linkTitle}>
                {t('system_info.link_main_repo')}
                <IconExternalLink size={14} />
              </div>
              <div className={styles.linkDesc}>{t('system_info.link_main_repo_desc')}</div>
            </div>
          </a>

          <a
            href="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.linkCard}
          >
            <div className={`${styles.linkIcon} ${styles.github}`}>
              <IconCode size={22} />
            </div>
            <div className={styles.linkContent}>
              <div className={styles.linkTitle}>
                {t('system_info.link_webui_repo')}
                <IconExternalLink size={14} />
              </div>
              <div className={styles.linkDesc}>{t('system_info.link_webui_repo_desc')}</div>
            </div>
          </a>

          <a
            href="https://help.router-for.me/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.linkCard}
          >
            <div className={`${styles.linkIcon} ${styles.docs}`}>
              <IconBookOpen size={22} />
            </div>
            <div className={styles.linkContent}>
              <div className={styles.linkTitle}>
                {t('system_info.link_docs')}
                <IconExternalLink size={14} />
              </div>
              <div className={styles.linkDesc}>{t('system_info.link_docs_desc')}</div>
            </div>
          </a>
        </div>
      </Card>

      <Card
        title={t('system_info.models_title')}
        extra={
          <Button variant="secondary" size="sm" onClick={() => fetchModels({ forceRefresh: true })} loading={modelsLoading}>
            {t('common.refresh')}
          </Button>
        }
      >
        <p className={styles.sectionDescription}>{t('system_info.models_desc')}</p>
        {modelStatus && <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>}
        {modelsError && <div className="error-box">{modelsError}</div>}
        {modelsLoading ? (
          <div className="hint">{t('common.loading')}</div>
        ) : models.length === 0 ? (
          <div className="hint">{t('system_info.models_empty')}</div>
        ) : (
          <div className="item-list">
            {groupedModels.map((group) => {
              const collapsible = group.items.length > MODEL_GROUP_COLLAPSE_THRESHOLD;
              const open = !collapsible || expandedGroups.has(group.id);
              return (
                <ModelGroupRow
                  key={group.id}
                  group={group}
                  modelsCountLabel={t('system_info.models_count', { count: group.items.length })}
                  open={open}
                  onToggle={() => toggleGroup(group.id)}
                />
              );
            })}
          </div>
        )}
      </Card>

      <Card title={t('system_info.smoke_test_title')}>
        <p className={styles.sectionDescription}>{t('system_info.smoke_test_desc')}</p>
        <div className={styles.smokeTestGrid}>
          <div className={styles.smokeTestModelRow}>
            <AutocompleteInput
              label={t('system_info.smoke_test_model_label')}
              value={smokeTestModel}
              onChange={setSmokeTestModel}
              options={modelOptions}
              placeholder={t('system_info.smoke_test_model_placeholder')}
              hint={t('system_info.smoke_test_model_hint')}
              wrapperClassName={styles.smokeTestModelInput}
            />
            <div className={`form-group ${styles.smokeTestVariantField}`}>
              <label>{t('system_info.smoke_test_variant_label')}</label>
              <select
                className={styles.smokeTestVariantSelect}
                value={smokeTestVariant}
                onChange={(event) => setSmokeTestVariant(event.target.value)}
              >
                <option value="">{t('system_info.smoke_test_variant_default')}</option>
                {SMOKE_TEST_VARIANTS.filter((variant) => variant).map((variant) => (
                  <option key={variant} value={variant}>
                    {variant}
                  </option>
                ))}
              </select>
              <div className="hint">{t('system_info.smoke_test_variant_hint')}</div>
            </div>
          </div>
          <div className="form-group">
            <label>{t('system_info.smoke_test_prompt_label')}</label>
            <textarea
              className={styles.smokeTestTextarea}
              rows={4}
              value={smokeTestPrompt}
              onChange={(event) => setSmokeTestPrompt(event.target.value)}
              placeholder={t('system_info.smoke_test_prompt_placeholder')}
            />
            <div className="hint">{t('system_info.smoke_test_prompt_hint')}</div>
          </div>
        </div>
        <div className={styles.smokeTestActions}>
          <div className="hint">{t('system_info.smoke_test_auth_hint')}</div>
          <Button onClick={() => void handleRunSmokeTest()} loading={smokeTestRunning}>
            {t('system_info.smoke_test_action')}
          </Button>
        </div>
        {smokeTestStatus && <div className={`status-badge ${smokeTestStatus.type}`}>{smokeTestStatus.message}</div>}
        {smokeTestResult && (
          <div className={styles.smokeTestResult}>
            <div className={styles.smokeTestMeta}>
              <span>{t('system_info.smoke_test_status_code', { status: smokeTestResult.statusCode })}</span>
              <span>{t('system_info.smoke_test_resolved_model', { model: smokeTestResult.resolvedModel })}</span>
            </div>
            <pre className={styles.smokeTestOutput}>{smokeTestResult.content}</pre>
          </div>
        )}
      </Card>

      <Card title={t('system_info.clear_login_title')}>
        <p className={styles.sectionDescription}>{t('system_info.clear_login_desc')}</p>
        <div className={styles.clearLoginActions}>
          <Button variant="danger" onClick={handleClearLoginStorage}>
            {t('system_info.clear_login_button')}
          </Button>
        </div>
      </Card>
      </div>
    </div>
  );
}
