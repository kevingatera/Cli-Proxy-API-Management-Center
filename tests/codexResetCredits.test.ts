import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { formatLocalDateTime } from '../src/utils/quota/resetCredits';

// 2026-11-03T05:00:00Z is 00:00 on the same day in America/Toronto (EST, UTC-5).
const INSTANT = '2026-11-03T05:00:00Z';

describe('Codex reset-credit expiry formatting', () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/Toronto';
  });

  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  test('formats the instant in the viewer local zone with a short zone name', () => {
    const result = formatLocalDateTime(INSTANT);

    expect(result).toBe('2026-11-03 00:00:00 EST');
    expect(result).not.toContain('13:00');
    expect(result).not.toContain('GMT+8');
  });

  test('returns an empty string for invalid or empty input', () => {
    expect(formatLocalDateTime('not-a-date')).toBe('');
    expect(formatLocalDateTime('')).toBe('');
  });
});
