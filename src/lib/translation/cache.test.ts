import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { PersistentCache } from './cache';

describe('extension translation database', () => {
  it('keeps per-guide model cost receipts across reloads and deduplicates imported receipts', async () => {
    const cache = new PersistentCache();
    const guide = 'https://mobalytics.gg/poe-2/builds/example';
    const other = 'https://mobalytics.gg/poe-2/builds/other';
    const first = await cache.appendGuideCost(guide, 0.0123);
    await cache.appendGuideCost(guide, null);
    await cache.appendGuideCost(other, 0.5);
    expect(await new PersistentCache().guideCost(guide)).toEqual({ cny: 0.0123, requests: 2, priced: 1 });
    const receipts = await cache.costEntries();
    expect(receipts).toHaveLength(3);
    expect(await cache.mergeGuideCosts([first, first])).toEqual({ added: 0, kept: 2 });
    await cache.clearGuideCosts();
    expect(await cache.mergeGuideCosts(receipts)).toEqual({ added: 3, kept: 0 });
    expect(await cache.mergeGuideCosts(receipts)).toEqual({ added: 0, kept: 3 });
    expect(await new PersistentCache().guideCost(guide)).toEqual({ cny: 0.0123, requests: 2, priced: 1 });
    await cache.clear();
    expect(await cache.guideCost(guide)).toEqual({ cny: 0.0123, requests: 2, priced: 1 });
    await cache.clearGuideCosts();
  });
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
  it('exports durable opaque keys and merges missing entries without overwriting existing translations', async () => {
    const cache = new PersistentCache();
    await cache.clear();
    const keyA = 'a'.repeat(64), keyB = 'b'.repeat(64);
    const original = { cn: ['旧简中'], tw: ['舊繁中'] };
    await cache.put(keyA, original);
    expect(await cache.entries()).toEqual([[keyA, original]]);
    const result = await cache.merge([[keyA, { cn: ['新简中'], tw: ['新繁中'] }], [keyB, { cn: ['第二条'], tw: ['第二條'] }]]);
    expect(result).toEqual({ added: 1, kept: 1 });
    expect(await new PersistentCache().get(keyA)).toEqual(original);
    expect(await cache.get(keyB)).toEqual({ cn: ['第二条'], tw: ['第二條'] });
    await cache.clear();
  });
  it('adds English to an old guide entry without changing its translations and persists selection translations separately', async () => {
    const cache = new PersistentCache();
    await cache.clear();
    await cache.clearSelection();
    const value = { cn: ['简中'], tw: ['繁中'] };
    await cache.put('old', value);
    await cache.annotate('old', 'Original');
    expect(await new PersistentCache().get('old')).toEqual({ ...value, source: 'Original' });
    await cache.annotate('old', 'Incorrect');
    expect(await cache.get('old')).toEqual({ ...value, source: 'Original' });
    await cache.saveSelection('Selected', '简中选择', '繁中選擇');
    await cache.saveSelection('Selected', '简中选择', '繁中選擇');
    expect(await new PersistentCache().selectionEntries()).toEqual([{ source: 'Selected', cn: '简中选择', tw: '繁中選擇' }]);
    expect(await cache.count()).toBe(1);
    await cache.clear();
    await cache.clearSelection();
  });
  it('upgrades a version-1 guide cache in place and keeps its paid translations', async () => {
    const original = globalThis.indexedDB;
    const legacy = new IDBFactory();
    globalThis.indexedDB = legacy;
    try {
      await new Promise<void>((resolve, reject) => {
        const open = legacy.open('poe2ultra-translations', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('segments');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('segments', 'readwrite');
          tx.objectStore('segments').put({ cn: ['旧简中'], tw: ['舊繁中'] }, 'legacy');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onabort = () => reject(tx.error);
        };
      });
      const cache = new PersistentCache();
      expect(await cache.get('legacy')).toEqual({ cn: ['旧简中'], tw: ['舊繁中'] });
      await cache.annotateMany([['legacy', 'Legacy source']]);
      expect(await cache.get('legacy')).toEqual({ source: 'Legacy source', cn: ['旧简中'], tw: ['舊繁中'] });
      await cache.saveSelection('Selected', '简中', '繁中');
      expect(await cache.selectionEntries()).toHaveLength(1);
    } finally { globalThis.indexedDB = original; }
  });
});
