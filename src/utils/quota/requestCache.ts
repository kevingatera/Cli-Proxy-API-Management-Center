export function createQuotaRequestCache<T>(now: () => number = Date.now) {
  const cache = new Map<string, { until: number; value?: T; error?: unknown }>();
  const pending = new Map<string, Promise<T>>();
  return (key: string, fetch: () => Promise<T>): Promise<T> => {
    const cached = cache.get(key);
    if (cached && cached.until > now()) {
      return cached.error ? Promise.reject(cached.error) : Promise.resolve(cached.value as T);
    }
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    for (const [id, entry] of cache) if (entry.until <= now()) cache.delete(id);
    const request = fetch()
      .then((value) => {
        cache.set(key, { until: now() + 300_000, value });
        return value;
      })
      .catch((error: unknown) => {
        const status =
          error && typeof error === 'object' && 'status' in error ? error.status : undefined;
        if (status === 429) cache.set(key, { until: now() + 300_000, error });
        throw error;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };
}
