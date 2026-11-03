/**
 * Extracts a reset time from a raw upstream error body, e.g.
 * {"error":{"type":"usage_limit_reached","resets_at":1793973920}}
 */

import { formatUnixSeconds } from './formatters';
import { normalizeNumberValue } from './parsers';

const RESET_KEYS = ['resets_at', 'reset_at', 'resetsAt'] as const;
const MS_THRESHOLD = 1e12;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const findResetEpoch = (record: Record<string, unknown>): number | null => {
  for (const key of RESET_KEYS) {
    const value = normalizeNumberValue(record[key]);
    if (value !== null && value > 0) return value;
  }
  return null;
};

export const formatResetHintFromMessage = (message: string): string | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }

  const root = asRecord(parsed);
  if (!root) return null;

  for (const candidate of [root, asRecord(root.error)]) {
    if (!candidate) continue;
    const epoch = findResetEpoch(candidate);
    if (epoch === null) continue;
    const seconds = epoch > MS_THRESHOLD ? epoch / 1000 : epoch;
    // Outside 2000..2100 the value is not a reset time; show nothing rather than a bogus date.
    if (seconds < 946684800 || seconds > 4102444800) return null;
    const formatted = formatUnixSeconds(seconds);
    return formatted === '-' ? null : formatted;
  }

  return null;
};
