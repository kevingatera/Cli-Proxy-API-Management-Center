import { getModelNamesFromUsage, type ModelPrice } from './usage';

const OPENROUTER_LOCAL_URL = '/model-prices/openrouter.json';
const OPENROUTER_REMOTE_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_REMOTE_SYNC_STORAGE_KEY = 'cli-proxy-openrouter-prices-last-sync-v1';

export const OPENROUTER_REMOTE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const uniqueModelNames = (modelNames: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  modelNames.forEach((name) => {
    const trimmed = String(name || '').trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || seen.has(lower)) return;
    seen.add(lower);
    result.push(trimmed);
  });
  return result;
};

export const getUsedModelNames = (usage: unknown): string[] => uniqueModelNames(getModelNamesFromUsage(usage));

export const normalizeModelPricesPayload = (payload: unknown): Record<string, ModelPrice> => {
  const candidate: unknown =
    payload &&
    typeof payload === 'object' &&
    'prices' in (payload as Record<string, unknown>) &&
    typeof (payload as Record<string, unknown>).prices === 'object'
      ? (payload as Record<string, unknown>).prices
      : payload;

  if (!candidate || typeof candidate !== 'object') {
    throw new Error('invalid payload');
  }

  const normalized: Record<string, ModelPrice> = {};
  Object.entries(candidate as Record<string, unknown>).forEach(([model, price]) => {
    if (!model || !price || typeof price !== 'object') return;
    const entry = price as Record<string, unknown>;
    const prompt = Number(entry.prompt);
    const completion = Number(entry.completion);
    const cache = entry.cache === undefined ? prompt : Number(entry.cache);

    normalized[model] = {
      prompt: Number.isFinite(prompt) && prompt >= 0 ? prompt : 0,
      completion: Number.isFinite(completion) && completion >= 0 ? completion : 0,
      cache:
        Number.isFinite(cache) && cache >= 0
          ? cache
          : Number.isFinite(prompt) && prompt >= 0
            ? prompt
            : 0,
    };
  });
  return normalized;
};

export const addShortModelAliases = (prices: Record<string, ModelPrice>): Record<string, ModelPrice> => {
  const merged: Record<string, ModelPrice> = { ...prices };
  Object.entries(prices).forEach(([id, price]) => {
    const parts = id.split('/').filter(Boolean);
    if (parts.length < 2) return;
    const short = parts[parts.length - 1];
    if (!short || merged[short]) return;
    merged[short] = price;
  });
  return merged;
};

const normalizeActiveModelMap = (modelNames: string[]) => {
  const result = new Map<string, string>();
  uniqueModelNames(modelNames).forEach((name) => {
    result.set(name.toLowerCase(), name);
  });
  return result;
};

export const keepOnlyUsedModelPrices = (
  prices: Record<string, ModelPrice>,
  modelNames: string[]
): Record<string, ModelPrice> => {
  const active = normalizeActiveModelMap(modelNames);
  if (!active.size) return { ...prices };

  const result: Record<string, ModelPrice> = {};
  Object.entries(prices).forEach(([model, price]) => {
    const match = active.get(model.toLowerCase());
    if (!match) return;
    result[match] = price;
  });
  return result;
};

export const mergeModelPricesForUsedModels = (
  currentPrices: Record<string, ModelPrice>,
  catalogPrices: Record<string, ModelPrice>,
  modelNames: string[]
) => {
  const active = normalizeActiveModelMap(modelNames);
  const retained = active.size ? keepOnlyUsedModelPrices(currentPrices, modelNames) : { ...currentPrices };
  const catalogWithAliases = addShortModelAliases(catalogPrices);
  const catalogLookup = new Map<string, ModelPrice>();
  Object.entries(catalogWithAliases).forEach(([model, price]) => {
    const lower = model.toLowerCase();
    if (!catalogLookup.has(lower)) {
      catalogLookup.set(lower, price);
    }
  });

  let added = 0;
  let kept = 0;
  const matchedModels: string[] = [];
  const missingModels: string[] = [];

  active.forEach((canonicalName, lower) => {
    if (retained[canonicalName]) {
      kept += 1;
      matchedModels.push(canonicalName);
      return;
    }
    const price = catalogLookup.get(lower);
    if (!price) {
      missingModels.push(canonicalName);
      return;
    }
    retained[canonicalName] = price;
    added += 1;
    matchedModels.push(canonicalName);
  });

  return {
    nextPrices: retained,
    added,
    kept,
    matched: matchedModels.length,
    missingModels,
  };
};

export const fetchBundledOpenRouterPrices = async (): Promise<Record<string, ModelPrice>> => {
  const res = await fetch(OPENROUTER_LOCAL_URL, { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return normalizeModelPricesPayload(await res.json());
};

export const fetchOpenRouterLatestPrices = async (): Promise<Record<string, ModelPrice>> => {
  const res = await fetch(OPENROUTER_REMOTE_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const payload = await res.json() as { data?: Array<Record<string, unknown>> };
  const models = Array.isArray(payload?.data) ? payload.data : [];
  const prices: Record<string, ModelPrice> = {};

  models.forEach((model) => {
    const id = typeof model?.id === 'string' ? model.id : '';
    const pricing = model?.pricing && typeof model.pricing === 'object'
      ? model.pricing as Record<string, unknown>
      : null;
    if (!id || !pricing) return;

    const prompt = Math.max(Number(pricing.prompt) || 0, 0) * 1_000_000;
    const completion = Math.max(Number(pricing.completion) || 0, 0) * 1_000_000;
    const cachedPrompt = Math.max(Number(pricing.input_cache_read) || 0, 0) * 1_000_000;

    prices[id] = {
      prompt,
      completion,
      cache: Number.isFinite(cachedPrompt) && cachedPrompt > 0 ? cachedPrompt : prompt,
    };
  });

  return prices;
};

export const loadLastOpenRouterRemoteSyncAt = (): number => {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = Number(localStorage.getItem(OPENROUTER_REMOTE_SYNC_STORAGE_KEY) || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
};

export const saveLastOpenRouterRemoteSyncAt = (timestamp: number): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(OPENROUTER_REMOTE_SYNC_STORAGE_KEY, String(timestamp));
  } catch {
    console.warn('failed to save OpenRouter pricing sync timestamp');
  }
};
