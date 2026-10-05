import { expect, test } from 'bun:test';
import { normalizeCursorAccountUsage } from '../src/utils/quota/cursorAccount';
test('uses independent provider pool percentages instead of dividing bonus spend by the plan limit', () => {
  const report = normalizeCursorAccountUsage(
    {
      billingCycleEnd: '1791841842000',
      planUsage: {
        totalSpend: 3064,
        limit: 2000,
        apiPercentUsed: 92,
        autoPercentUsed: 2,
        totalPercentUsed: 6,
      },
    },
    { planInfo: { planName: 'Pro' } }
  );
  expect(report.apiPercentUsed).toBe(92);
  expect(report.totalPercentUsed).toBe(6);
  expect(report.totalSpendCents).toBe(3064);
  expect(report.cycleEnd).toBe('2026-10-12T21:50:42.000Z');
});
test('does not invent quota for missing account responses', () => {
  expect(() => normalizeCursorAccountUsage({}, {})).toThrow('no account usage');
});
