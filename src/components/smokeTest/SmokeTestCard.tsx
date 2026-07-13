import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { IconCopy } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { maskApiKey } from '@/utils/format';
import { copyToClipboard } from '@/utils/clipboard';
import {
  SMOKE_TEST_VARIANTS,
  splitSmokeTestModel,
  buildSmokeTestModel,
  buildProxyChatCompletionsEndpoint,
  extractChatResponseText,
  extractTokens,
  extractFinishReason,
  extractResolvedModel,
  buildCurlCommand,
  type SmokeTestTokens,
} from '@/utils/smokeTest';
import type { ApiCallResult } from '@/services/api/apiCall';
import styles from './SmokeTestCard.module.scss';

const SMOKE_TEST_TIMEOUT_MS = 30_000;
const HISTORY_LIMIT = 20;

export interface SmokeTestCardProps {
  modelOptions: string[];
  authApiBase: string;
  resolveApiKey: () => Promise<string | undefined>;
}

type StatusType = 'success' | 'warning' | 'error' | 'muted';

interface SmokeTestStatus {
  type: StatusType;
  message: string;
}

interface SmokeTestResultData {
  statusCode: number;
  resolvedModel: string;
  content: string;
  tokens: SmokeTestTokens;
  finishReason: string;
  rawBody: unknown;
  headers: Record<string, string[]>;
  latencyMs: number;
  requestModel: string;
  prompt: string;
}

interface HistoryEntry {
  id: string;
  timestamp: number;
  model: string;
  variant: string;
  statusCode: number;
  latencyMs: number;
  tokens: SmokeTestTokens;
  success: boolean;
  contentPreview: string;
}

type TabKey = 'response' | 'raw' | 'headers' | 'curl';

const formatMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTokens = (n: number): string => n.toLocaleString();

const statusBadgeClass = (code: number): string => {
  if (code === 0) return styles.statusError;
  if (code < 200 || code >= 300) return styles.statusError;
  return styles.statusOk;
};

export function SmokeTestCard({ modelOptions, authApiBase, resolveApiKey }: SmokeTestCardProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const [model, setModel] = useState('');
  const [variant, setVariant] = useState('');
  const [prompt, setPrompt] = useState(() => 'Reply with OK only.');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<SmokeTestStatus | null>(null);
  const [result, setResult] = useState<SmokeTestResultData | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('response');
  const [history, setHistory] = useLocalStorage<HistoryEntry[]>('cliproxy-smoke-test-history', []);
  const recentModelsRef = useRef<string[]>([]);

  // Recent-first model suggestions: models tested successfully bubble to top.
  const sortedModelOptions = useMemo(() => {
    const recent = recentModelsRef.current;
    const recentSet = new Set(recent);
    const rest = modelOptions.filter((m) => !recentSet.has(m));
    return [...recent, ...rest];
  }, [modelOptions]);

  // Auto-pick a sensible default model on first load.
  const defaultModel = useMemo(() => {
    const names = new Set(modelOptions);
    if (names.has('gpt-5.4')) return 'gpt-5.4/fast';
    if (names.has('gpt-5')) return 'gpt-5/fast';
    return modelOptions[0] || '';
  }, [modelOptions]);

  // Populate the model field once when model options first arrive.
  useEffect(() => {
    if (!model.trim() && defaultModel) {
      const parsed = splitSmokeTestModel(defaultModel);
      setModel(parsed.model);
      if (parsed.variant) setVariant(parsed.variant);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultModel]);

  const runTest = useCallback(
    async (modelArg?: string, variantArg?: string, promptArg?: string) => {
      const useModel = (modelArg ?? model).trim();
      const useVariant = variantArg ?? variant;
      const usePrompt = (promptArg ?? prompt).trim();
      const requestModel = buildSmokeTestModel(useModel, useVariant);

      if (!authApiBase) {
        setStatus({ type: 'warning', message: t('notification.connection_required') });
        return;
      }
      if (!requestModel) {
        setStatus({ type: 'error', message: t('system_info.smoke_test_model_required') });
        return;
      }
      if (!usePrompt) {
        setStatus({ type: 'error', message: t('system_info.smoke_test_prompt_required') });
        return;
      }

      const endpoint = buildProxyChatCompletionsEndpoint(authApiBase);
      if (!endpoint) {
        setStatus({ type: 'error', message: t('notification.connection_required') });
        return;
      }

      setRunning(true);
      setResult(null);
      setActiveTab('response');
      setStatus({ type: 'muted', message: t('system_info.smoke_test_running') });

      try {
        const apiKey = await resolveApiKey();
        if (!apiKey) {
          setStatus({ type: 'error', message: t('system_info.smoke_test_key_missing') });
          return;
        }

        const start = performance.now();
        const response: ApiCallResult = await apiCallApi.request(
          {
            method: 'POST',
            url: endpoint,
            header: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            data: JSON.stringify({
              model: requestModel,
              messages: [{ role: 'user', content: usePrompt }],
              stream: false,
            }),
          },
          { timeout: SMOKE_TEST_TIMEOUT_MS }
        );
        const latencyMs = performance.now() - start;

        const body = response.body && typeof response.body === 'object' ? response.body : null;
        const content = extractChatResponseText(body) || response.bodyText || t('system_info.smoke_test_empty_result');
        const resolvedModel = extractResolvedModel(body, requestModel);
        const tokens = extractTokens(body);
        const finishReason = extractFinishReason(body);
        const success = response.statusCode >= 200 && response.statusCode < 300;

        const resultData: SmokeTestResultData = {
          statusCode: response.statusCode,
          resolvedModel,
          content,
          tokens,
          finishReason,
          rawBody: body ?? response.bodyText,
          headers: response.header ?? {},
          latencyMs,
          requestModel,
          prompt: usePrompt,
        };

        setResult(resultData);
        setStatus(
          success
            ? { type: 'success', message: t('system_info.smoke_test_success') }
            : {
                type: 'error',
                message: `${t('system_info.smoke_test_failed')}: ${getApiCallErrorMessage(response)}`,
              }
        );

        // Track in recent models + history.
        if (success) {
          recentModelsRef.current = [useModel, ...recentModelsRef.current.filter((m) => m !== useModel)].slice(0, 8);
        }

        const entry: HistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          model: requestModel,
          variant: useVariant,
          statusCode: response.statusCode,
          latencyMs,
          tokens,
          success,
          contentPreview: content.slice(0, 120),
        };
        setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err || '');
        const errorCode = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: string }).code) : '';
        const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
        setStatus({
          type: 'error',
          message: isTimeout
            ? t('system_info.smoke_test_timeout', { seconds: SMOKE_TEST_TIMEOUT_MS / 1000 })
            : `${t('system_info.smoke_test_failed')}: ${message}`,
        });
      } finally {
        setRunning(false);
      }
    },
    [authApiBase, model, variant, prompt, resolveApiKey, setHistory, t]
  );

  const handleCopy = useCallback(
    async (text: string) => {
      const ok = await copyToClipboard(text);
      showNotification(ok ? t('logs.copy_success') : t('logs.copy_failed'), ok ? 'success' : 'error');
    },
    [showNotification, t]
  );

  const handleRerun = useCallback(
    (entry: HistoryEntry) => {
      const parsed = splitSmokeTestModel(entry.model);
      setModel(parsed.model);
      setVariant(entry.variant || parsed.variant);
      void runTest(parsed.model, entry.variant || parsed.variant);
    },
    [runTest]
  );

  const clearHistory = useCallback(() => setHistory([]), [setHistory]);

  const curlCommand = useMemo(() => {
    if (!result || !authApiBase) return '';
    const endpoint = buildProxyChatCompletionsEndpoint(authApiBase);
    return buildCurlCommand(endpoint, result.requestModel, result.prompt, maskApiKey('•hidden•'));
  }, [result, authApiBase]);

  const rawJson = useMemo(() => {
    if (!result) return '';
    try {
      return JSON.stringify(result.rawBody, null, 2);
    } catch {
      return String(result.rawBody ?? '');
    }
  }, [result]);

  const headerEntries = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.headers).filter(([, values]) => Array.isArray(values) && values.length > 0);
  }, [result]);

  return (
    <Card title={t('system_info.smoke_test_title')}>
      <p className={styles.description}>{t('system_info.smoke_test_desc')}</p>

      {/* Input row */}
      <div className={styles.inputGrid}>
        <div className={styles.modelRow}>
          <AutocompleteInput
            label={t('system_info.smoke_test_model_label')}
            value={model}
            onChange={(v) => {
              setModel(v);
              // Sync variant if the user typed a model/variant combo.
              const parsed = splitSmokeTestModel(v);
              if (parsed.variant) setVariant(parsed.variant);
            }}
            options={sortedModelOptions}
            placeholder={t('system_info.smoke_test_model_placeholder')}
            hint={t('system_info.smoke_test_model_hint')}
            wrapperClassName={styles.modelInput}
          />
          <div className={`form-group ${styles.variantField}`}>
            <label>{t('system_info.smoke_test_variant_label')}</label>
            <select
              className={styles.variantSelect}
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
            >
              <option value="">{t('system_info.smoke_test_variant_default')}</option>
              {SMOKE_TEST_VARIANTS.filter((v) => v).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <div className="hint">{t('system_info.smoke_test_variant_hint')}</div>
          </div>
        </div>

        <div className="form-group">
          <label>{t('system_info.smoke_test_prompt_label')}</label>
          <textarea
            className={styles.promptTextarea}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('system_info.smoke_test_prompt_placeholder')}
          />
          <div className="hint">{t('system_info.smoke_test_prompt_hint')}</div>
        </div>
      </div>

      <div className={styles.actionsBar}>
        <div className={styles.authHint}>{t('system_info.smoke_test_auth_hint')}</div>
        <Button onClick={() => void runTest()} loading={running}>
          {t('system_info.smoke_test_action')}
        </Button>
      </div>

      {/* Status */}
      {status && (
        <div className={`status-badge ${status.type}`}>{status.message}</div>
      )}

      {/* Result */}
      {result && (
        <div className={styles.result}>
          {/* Header row: status + latency + model */}
          <div className={styles.resultHeader}>
            <span className={`${styles.statusBadge} ${statusBadgeClass(result.statusCode)}`}>
              {t('system_info.smoke_test_status_code', { status: result.statusCode })}
            </span>
            <span className={styles.latencyPill}>{formatMs(result.latencyMs)}</span>
            <span className={styles.resolvedModel}>{result.resolvedModel}</span>
            {result.finishReason && (
              <span className={styles.finishReason}>
                {t('system_info.smoke_test_finish_reason', { defaultValue: 'finish' })}: {result.finishReason}
              </span>
            )}
          </div>

          {/* Token metrics */}
          <div className={styles.tokenGrid}>
            <div className={styles.tokenCell}>
              <span className={styles.tokenLabel}>{t('system_info.smoke_test_prompt_tokens', { defaultValue: 'Prompt' })}</span>
              <span className={styles.tokenValue}>{formatTokens(result.tokens.prompt)}</span>
            </div>
            <div className={styles.tokenCell}>
              <span className={styles.tokenLabel}>{t('system_info.smoke_test_completion_tokens', { defaultValue: 'Completion' })}</span>
              <span className={styles.tokenValue}>{formatTokens(result.tokens.completion)}</span>
            </div>
            <div className={styles.tokenCell}>
              <span className={styles.tokenLabel}>{t('system_info.smoke_test_total_tokens', { defaultValue: 'Total' })}</span>
              <span className={styles.tokenValue}>{formatTokens(result.tokens.total)}</span>
            </div>
            {result.tokens.cached > 0 && (
              <div className={styles.tokenCell}>
                <span className={styles.tokenLabel}>{t('system_info.smoke_test_cached_tokens', { defaultValue: 'Cached' })}</span>
                <span className={styles.tokenValue}>{formatTokens(result.tokens.cached)}</span>
              </div>
            )}
            {result.tokens.reasoning > 0 && (
              <div className={styles.tokenCell}>
                <span className={styles.tokenLabel}>{t('system_info.smoke_test_reasoning_tokens', { defaultValue: 'Reasoning' })}</span>
                <span className={styles.tokenValue}>{formatTokens(result.tokens.reasoning)}</span>
              </div>
            )}
          </div>

          {/* Tab strip */}
          <div className={styles.tabStrip}>
            {(['response', 'raw', 'headers', 'curl'] as TabKey[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {t(`system_info.smoke_test_tab_${tab}`, { defaultValue: tab })}
              </button>
            ))}
            <button
              type="button"
              className={styles.copyBtn}
              onClick={() => {
                const text =
                  activeTab === 'response'
                    ? result.content
                    : activeTab === 'raw'
                      ? rawJson
                      : activeTab === 'headers'
                        ? headerEntries.map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n')
                        : curlCommand;
                void handleCopy(text);
              }}
              title={t('common.copy', { defaultValue: 'Copy' })}
            >
              <IconCopy size={14} />
            </button>
          </div>

          {/* Tab content */}
          <div className={styles.tabContent}>
            {activeTab === 'response' && (
              <pre className={styles.outputText}>{result.content}</pre>
            )}
            {activeTab === 'raw' && (
              <pre className={styles.outputCode}>{rawJson}</pre>
            )}
            {activeTab === 'headers' && (
              <div className={styles.headerList}>
                {headerEntries.length === 0 ? (
                  <span className={styles.mutedText}>{t('system_info.smoke_test_no_headers', { defaultValue: 'No headers.' })}</span>
                ) : (
                  headerEntries.map(([key, values]) => (
                    <div key={key} className={styles.headerRow}>
                      <span className={styles.headerKey}>{key}</span>
                      <span className={styles.headerVal}>{values.join(', ')}</span>
                    </div>
                  ))
                )}
              </div>
            )}
            {activeTab === 'curl' && (
              <pre className={styles.outputCode}>{curlCommand}</pre>
            )}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className={styles.historySection}>
          <div className={styles.historyHeader}>
            <span className={styles.historyTitle}>
              {t('system_info.smoke_test_history_title', { defaultValue: 'Recent runs' })}
            </span>
            <button type="button" className={styles.historyClearBtn} onClick={clearHistory}>
              {t('system_info.smoke_test_history_clear', { defaultValue: 'Clear' })}
            </button>
          </div>
          <div className={styles.historyList}>
            {history.map((entry) => (
              <div
                key={entry.id}
                className={styles.historyRow}
                onClick={() => handleRerun(entry)}
                title={entry.contentPreview}
              >
                <span className={`${styles.historyDot} ${entry.success ? styles.dotOk : styles.dotErr}`} />
                <span className={styles.historyModel}>{entry.model}</span>
                <span className={`${styles.historyPill} ${entry.success ? styles.pillOk : styles.pillErr}`}>
                  {entry.statusCode}
                </span>
                <span className={styles.historyPill}>{formatMs(entry.latencyMs)}</span>
                {entry.tokens.total > 0 && (
                  <span className={styles.historyPill}>{formatTokens(entry.tokens.total)} tok</span>
                )}
                <span className={styles.historyTime}>
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
