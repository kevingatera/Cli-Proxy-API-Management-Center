/**
 * OpenCode Zen 用量渲染体：成功率水位条、计数，以及按模型的 Go 估算限额。
 */

import { useTranslation } from 'react-i18next';
import type { ZenQuotaState } from '@/types';
import { formatQuotaResetTime } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';
import { emptyUsageSummary, isUsageEndpointUnavailable } from '../telemetry/usageIndex';
import { ZEN_GO_MODEL_LIMITS, normalizeZenGoModelId } from './data';

export function ZenQuotaBody({ quota, classes }: QuotaBodyProps<ZenQuotaState>) {
  const { t } = useTranslation();
  const summary = quota.summary ?? emptyUsageSummary();
  const hasTelemetry = summary.requests > 0;
  const hasTokenTelemetry = (summary.tokenTelemetryCount ?? 0) > 0;
  const successPct = hasTelemetry
    ? Math.round((summary.successCount / summary.requests) * 100)
    : null;
  const lastSeenLabel = summary.lastSeenAt
    ? formatQuotaResetTime(summary.lastSeenAt)
    : t('zen_quota.last_seen_never');
  const emptyHint = isUsageEndpointUnavailable()
    ? t('zen_quota.fetcher_pending')
    : t('zen_quota.empty_usage');
  const modelBreakdown = (summary.models ?? []).slice(0, 6);

  return (
    <>
      <div className={classes.quotaRow}>
        <div className={classes.quotaRowHeader}>
          <span className={classes.quotaModel}>{t('zen_quota.health_label')}</span>
          <div className={classes.quotaMeta}>
            <span className={classes.quotaPercent}>
              {successPct === null ? '--' : `${successPct}%`}
            </span>
            <span className={classes.quotaReset}>{lastSeenLabel}</span>
          </div>
        </div>
        <QuotaMeter percent={successPct} classes={classes} />
      </div>
      {hasTelemetry && (
        <div className={classes.quotaMeta} style={{ marginTop: '0.5rem' }}>
          <span className={classes.quotaAmount}>
            {t('zen_quota.requests_value', { count: summary.requests })}
          </span>
          <span className={classes.quotaAmount}>
            {t('zen_quota.failures_value', { count: summary.failureCount })}
          </span>
          <span className={classes.quotaAmount}>
            {hasTokenTelemetry
              ? t('zen_quota.tokens_value', { count: summary.totalTokens })
              : t('zen_quota.tokens_unavailable')}
          </span>
          <span className={classes.quotaAmount}>
            {t('zen_quota.models_value', { count: summary.modelCount })}
          </span>
        </div>
      )}
      <div className={classes.quotaMessage} style={{ marginTop: '0.5rem' }}>
        {hasTelemetry ? t('zen_quota.telemetry_note') : emptyHint}
      </div>
      {modelBreakdown.length > 0 && (
        <div className={classes.quotaMessage} style={{ marginTop: '0.75rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            {t('zen_quota.model_breakdown_title')}
          </div>
          {modelBreakdown.map((model) => {
            const limits = ZEN_GO_MODEL_LIMITS[normalizeZenGoModelId(model.model)];
            const label = limits?.label ?? model.model;
            const tokenText =
              (model.tokenTelemetryCount ?? 0) > 0
                ? t('zen_quota.tokens_value', { count: model.totalTokens })
                : t('zen_quota.tokens_unavailable');
            const limitText = limits
              ? t('zen_quota.model_limits_value', {
                  fiveHour: limits.fiveHour.toLocaleString(),
                  weekly: limits.weekly.toLocaleString(),
                  monthly: limits.monthly.toLocaleString(),
                })
              : t('zen_quota.model_limits_unknown');
            return (
              <div
                key={model.model}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.3rem 0',
                  borderTop: '1px solid var(--border-color)',
                }}
              >
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{label}</span>
                <span style={{ textAlign: 'right' }}>
                  {t('zen_quota.model_usage_value', {
                    requests: model.requests,
                    failures: model.failureCount,
                    tokens: tokenText,
                    limits: limitText,
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
