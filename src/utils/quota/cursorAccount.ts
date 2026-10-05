import { isRecord } from '@/utils/helpers';

export interface CursorAccountUsage {
  plan: string | null;
  cycleEnd: string | null;
  apiPercentUsed: number | null;
  autoPercentUsed: number | null;
  totalPercentUsed: number | null;
  totalSpendCents: number | null;
  includedSpendCents: number | null;
  bonusSpendCents: number | null;
  message: string | null;
}
export function normalizeCursorAccountUsage(usage: unknown, plan: unknown): CursorAccountUsage {
  if (!isRecord(usage) || !isRecord(usage.planUsage))
    throw new Error('Cursor returned no account usage');
  const p = usage.planUsage;
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const info = isRecord(plan) && isRecord(plan.planInfo) ? plan.planInfo : {};
  const time = Number(usage.billingCycleEnd);
  return {
    plan: typeof info.planName === 'string' ? info.planName : null,
    cycleEnd: Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null,
    apiPercentUsed: number(p.apiPercentUsed),
    autoPercentUsed: number(p.autoPercentUsed),
    totalPercentUsed: number(p.totalPercentUsed),
    totalSpendCents: number(p.totalSpend),
    includedSpendCents: number(p.includedSpend),
    bonusSpendCents: number(p.bonusSpend),
    message:
      typeof usage.namedModelSelectedDisplayMessage === 'string'
        ? usage.namedModelSelectedDisplayMessage
        : null,
  };
}
