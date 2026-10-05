import { describe, expect, test } from 'bun:test';
import { createQuotaRequestCache } from '../src/utils/quota/requestCache';

describe('quota request cache', () => {
  test('coalesces concurrent calls while separating credentials and cache generations', async () => {
    let now = 0;
    let calls = 0;
    const cached = createQuotaRequestCache<number>(() => now);
    let finish: (value: number) => void = () => {};
    const fetch = () => {
      calls++;
      return new Promise<number>((resolve) => {
        finish = resolve;
      });
    };
    const first = cached('generation-1:account-a', fetch);
    const second = cached('generation-1:account-a', fetch);
    expect(calls).toBe(1);
    finish(12);
    expect(await first).toBe(12);
    expect(await second).toBe(12);
    expect(await cached('generation-1:account-a', () => Promise.resolve(99))).toBe(12);
    expect(await cached('generation-1:account-b', () => Promise.resolve(30))).toBe(30);
    expect(await cached('generation-2:account-a', () => Promise.resolve(40))).toBe(40);
    now = 300_001;
    expect(await cached('generation-1:account-a', () => Promise.resolve(50))).toBe(50);
  });
  test('blocks repeated 429 polling and allows recovery after backoff', async () => {
    let now = 0;
    let calls = 0;
    const cached = createQuotaRequestCache<number>(() => now);
    const fetch = async () => {
      calls++;
      throw Object.assign(new Error('rate limited'), { status: 429 });
    };
    await expect(cached('account', fetch)).rejects.toThrow('rate limited');
    await expect(cached('account', fetch)).rejects.toThrow('rate limited');
    expect(calls).toBe(1);
    now = 300_001;
    expect(await cached('account', async () => 75)).toBe(75);
  });
});
