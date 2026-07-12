import { useMemo } from 'react';
import { buildAuthIndexLabels } from '@/utils/usage';
import type { UsagePayload } from './useUsageData';

/**
 * Build a human-readable label for a single auth file entry.
 *
 * Preference order: email > label > account > filename > provider.
 * The raw `auth_index` is an opaque 8-char hash; callers should use this map
 * to present something meaningful in the UI while keeping the hash as the
 * underlying filter value.
 */
export function buildAuthLabel(file: {
  email?: string;
  label?: string;
  account?: string;
  name?: string;
  provider?: string;
  type?: string;
}): string {
  const email = typeof file.email === 'string' ? file.email.trim() : '';
  if (email) return email;

  const label = typeof file.label === 'string' ? file.label.trim() : '';
  if (label) return label;

  const account = typeof file.account === 'string' ? file.account.trim() : '';
  if (account) return account;

  const name = typeof file.name === 'string' ? file.name.trim() : '';
  if (name) {
    // Trim a trailing .json and a leading provider prefix for readability.
    const base = name.replace(/\.json$/i, '');
    return base;
  }

  const provider = typeof file.provider === 'string' ? file.provider.trim() : '';
  if (provider) return provider;

  return '';
}

export interface UseAuthIndexLabelsReturn {
  /** Map of auth_index hash -> friendly label (email/filename). */
  labelsByIndex: Map<string, string>;
}

/**
 * Build a lookup from the opaque `auth_index` hash to a friendly label,
 * derived from the usage payload's own `source`/`auth_id`/`provider` fields.
 *
 * We intentionally read from the usage data rather than `/auth-files` because
 * the live auth_index values can drift from historical ones in the usage
 * records (rotated/renamed credentials produce different seeds), which would
 * leave older requests unlabeled.
 */
export function useAuthIndexLabels(usage: UsagePayload | null): UseAuthIndexLabelsReturn {
  const labelsByIndex = useMemo(() => buildAuthIndexLabels(usage), [usage]);
  return { labelsByIndex };
}
