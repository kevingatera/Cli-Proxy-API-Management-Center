const API_KEY_LABELS_STORAGE_KEY = 'cli-proxy-api-key-labels-v1';

const ADJECTIVES = [
  'Amber', 'Atlas', 'Bright', 'Cinder', 'Cobalt', 'Comet', 'Copper', 'Dawn', 'Drift', 'Ember',
  'Fable', 'Fern', 'Harbor', 'Indigo', 'Juniper', 'Lattice', 'Maple', 'Meadow', 'Mica', 'Nimbus',
  'North', 'Orbit', 'Quartz', 'River', 'Sable', 'Signal', 'Silver', 'Solstice', 'Summit', 'Willow'
];

const NOUNS = [
  'Anchor', 'Beacon', 'Bridge', 'Brook', 'Canyon', 'Cove', 'Falcon', 'Field', 'Forge', 'Garden',
  'Grove', 'Harbor', 'Hearth', 'Hill', 'Jetty', 'Lagoon', 'Lantern', 'Mesa', 'Oak', 'Orchard',
  'Pier', 'Pine', 'Ridge', 'Shore', 'Spruce', 'Star', 'Trail', 'Vale', 'Vista', 'Yard'
];

const fnv1a32 = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const getApiKeyFingerprint = (key: string): string => fnv1a32(String(key || '')).toString(16).padStart(8, '0');

export const loadApiKeyLabels = (): Record<string, string> => {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(API_KEY_LABELS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const result: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([fingerprint, label]) => {
      const trimmed = String(label ?? '').trim();
      if (fingerprint && trimmed) {
        result[fingerprint] = trimmed;
      }
    });
    return result;
  } catch {
    return {};
  }
};

export const saveApiKeyLabels = (labels: Record<string, string>): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(API_KEY_LABELS_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    console.warn('failed to save API key labels');
  }
};

export const clearApiKeyLabels = (): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(API_KEY_LABELS_STORAGE_KEY);
  } catch {
    console.warn('failed to clear API key labels');
  }
};

export const getCustomApiKeyLabel = (key: string, labels: Record<string, string>): string => {
  const fingerprint = getApiKeyFingerprint(key);
  return String(labels[fingerprint] ?? '').trim();
};

export const setCustomApiKeyLabel = (
  labels: Record<string, string>,
  key: string,
  label: string
): Record<string, string> => {
  const next = { ...labels };
  const fingerprint = getApiKeyFingerprint(key);
  const trimmed = String(label || '').trim();
  if (!trimmed) {
    delete next[fingerprint];
    return next;
  }
  next[fingerprint] = trimmed;
  return next;
};

export const removeCustomApiKeyLabel = (labels: Record<string, string>, key: string): Record<string, string> => {
  const next = { ...labels };
  delete next[getApiKeyFingerprint(key)];
  return next;
};

export const getGeneratedApiKeyLabel = (key: string): string => {
  const hash = fnv1a32(String(key || ''));
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const noun = NOUNS[(hash >>> 8) % NOUNS.length];
  const suffix = ((hash >>> 16) % 89) + 11;
  return `${adjective} ${noun} ${suffix}`;
};

export const getApiKeyDisplayLabel = (key: string, labels: Record<string, string>): string => {
  return getCustomApiKeyLabel(key, labels) || getGeneratedApiKeyLabel(key);
};
