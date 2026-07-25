/**
 * Cursor 用量渲染体：成功率水位条 + 请求 / 失败 / token / 模型计数（本地遥测）。
 */

import { useTranslation } from 'react-i18next';
import type { CursorQuotaState } from '@/types';
import { formatQuotaResetTime } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';
import { emptyUsageSummary, isUsageEndpointUnavailable } from '../telemetry/usageIndex';

export function CursorQuotaBody({ quota, classes }: QuotaBodyProps<CursorQuotaState>) {
  const { t } = useTranslation();
  const summary = quota.summary ?? emptyUsageSummary();
  const hasTelemetry = summary.requests > 0;
  const hasTokenTelemetry = (summary.tokenTelemetryCount ?? 0) > 0;
  const successPct = hasTelemetry
    ? Math.round((summary.successCount / summary.requests) * 100)
    : null;
  const lastSeenLabel = summary.lastSeenAt
    ? formatQuotaResetTime(summary.lastSeenAt)
    : t('cursor_quota.last_seen_never');
  const emptyHint = isUsageEndpointUnavailable()
    ? t('cursor_quota.fetcher_pending')
    : t('cursor_quota.empty_usage');

  return (
    <>
      <div className={classes.quotaRow}>
        <div className={classes.quotaRowHeader}>
          <span className={classes.quotaModel}>{t('cursor_quota.health_label')}</span>
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
            {t('cursor_quota.requests_value', { count: summary.requests })}
          </span>
          <span className={classes.quotaAmount}>
            {t('cursor_quota.failures_value', { count: summary.failureCount })}
          </span>
          <span className={classes.quotaAmount}>
            {hasTokenTelemetry
              ? t('cursor_quota.tokens_value', { count: summary.totalTokens })
              : t('cursor_quota.tokens_unavailable')}
          </span>
          <span className={classes.quotaAmount}>
            {t('cursor_quota.models_value', { count: summary.modelCount })}
          </span>
        </div>
      )}
      <div className={classes.quotaMessage} style={{ marginTop: '0.5rem' }}>
        {hasTelemetry ? t('cursor_quota.telemetry_note') : emptyHint}
      </div>
    </>
  );
}
