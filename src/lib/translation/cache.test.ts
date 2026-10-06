import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PersistentCache } from './cache';

describe('extension translation database', () => {
  it('commits both languages durably before success and can reopen them without a TTL', async () => {
    const cache = new PersistentCache();
    await cache.clear();
    const value = { cn: ['深渊巫妖'], tw: ['深淵妖巫'] };
    await cache.put('test', value);
    const reopened = new PersistentCache();
    expect(await reopened.get('test')).toEqual(value);
    expect(await reopened.count()).toBe(1);
    await reopened.clear();
    expect(await cache.get('test')).toBeUndefined();
  });
});
