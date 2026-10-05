/**
 * Cursor 账户用量渲染体：套餐名、三类用量的水位条（剩余量着色）、结算周期与花费。
 */

import { useTranslation } from 'react-i18next';
import type { CursorQuotaState } from '@/types';
import { formatQuotaResetTime } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';

export function CursorQuotaBody({ quota, classes }: QuotaBodyProps<CursorQuotaState>) {
  const { t } = useTranslation();
  const account = quota.summary?.account;
  if (!account) {
    return <div className={classes.quotaMessage}>{t('cursor_quota.account_unavailable')}</div>;
  }
  const usageRows = [
    { id: 'api', label: t('cursor_quota.api_used'), used: account.apiPercentUsed },
    { id: 'auto', label: t('cursor_quota.auto_used'), used: account.autoPercentUsed },
    { id: 'total', label: t('cursor_quota.total_used'), used: account.totalPercentUsed },
  ];

  return (
    <>
      <div className={classes.quotaModel}>{account.plan ?? '--'}</div>
      {usageRows.map((row, index) => (
        <div key={row.id} className={classes.quotaRow}>
          <div>
            {row.label}: {row.used === null ? '--' : `${row.used.toFixed(1)}%`}
          </div>
          <QuotaMeter
            percent={row.used === null ? null : 100 - row.used}
            classes={classes}
            index={index}
          />
        </div>
      ))}
      {account.cycleEnd && (
        <div>
          {t('cursor_quota.cycle_end')}: {formatQuotaResetTime(account.cycleEnd)}
        </div>
      )}
      {account.totalSpendCents !== null && (
        <div>
          {t('cursor_quota.spend')}: ${(account.totalSpendCents / 100).toFixed(2)}
        </div>
      )}
      {account.message && <div className={classes.quotaMessage}>{account.message}</div>}
    </>
  );
}
