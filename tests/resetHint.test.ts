import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { formatResetHintFromMessage } from '../src/utils/quota/resetHint';

// 1793973920 is 2026-11-06T14:05:20Z, i.e. 09:05 EST in America/Toronto.
const CODEX_BODY =
  '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1793973920,"resets_in_seconds":252096}}';

describe('formatResetHintFromMessage', () => {
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

  test('formats resets_at from a nested Codex error body in local time', () => {
    const result = formatResetHintFromMessage(CODEX_BODY);

    expect(result).toBe('11/06, 09:05');
  });

  test('treats epoch values above 1e12 as milliseconds', () => {
    const result = formatResetHintFromMessage('{"resets_at":1793973920000}');

    expect(result).toBe('11/06, 09:05');
  });

  test('reads resets_at, reset_at and resetsAt at the top level', () => {
    expect(formatResetHintFromMessage('{"resets_at":1793973920}')).toBe('11/06, 09:05');
    expect(formatResetHintFromMessage('{"reset_at":1793973920}')).toBe('11/06, 09:05');
    expect(formatResetHintFromMessage('{"resetsAt":1793973920}')).toBe('11/06, 09:05');
  });

  test('reads resets_at nested under error', () => {
    const result = formatResetHintFromMessage('{"error":{"resetsAt":1793973920}}');

    expect(result).toBe('11/06, 09:05');
  });

  test('returns null for non-JSON text', () => {
    expect(formatResetHintFromMessage('quota exceeded, try later')).toBeNull();
    expect(formatResetHintFromMessage('{"error":')).toBeNull();
    expect(formatResetHintFromMessage('')).toBeNull();
  });

  test('returns null when no reset field is present', () => {
    expect(
      formatResetHintFromMessage('{"error":{"type":"usage_limit_reached","message":"limit"}}')
    ).toBeNull();
    expect(formatResetHintFromMessage('[1793973920]')).toBeNull();
    expect(formatResetHintFromMessage('1793973920')).toBeNull();
  });
});
