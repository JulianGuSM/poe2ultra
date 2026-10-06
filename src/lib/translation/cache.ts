import type { TranslationStore } from './engine';
import { digest } from './engine';
import type { CachedTranslation } from './plan';

export interface SelectionTranslation { source: string; cn: string; tw: string }
export interface GuideCostEvent { id: string; guideKey: string; cny: number | null; at: string }
export interface GuideCostSummary { cny: number; requests: number; priced: number }

export function summarizeGuideCosts(events: GuideCostEvent[]): GuideCostSummary {
  return events.reduce((sum, event) => ({
    cny: sum.cny + (event.cny ?? 0), requests: sum.requests + 1, priced: sum.priced + Number(event.cny !== null),
  }), { cny: 0, requests: 0, priced: 0 });
}

/** Extension-origin IndexedDB: survives closing the guide, service worker and browser. No TTL. */
export class PersistentCache implements TranslationStore {
  private database?: Promise<IDBDatabase>;
  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('poe2ultra-translations', 3);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('segments')) request.result.createObjectStore('segments');
        if (!request.result.objectStoreNames.contains('selections')) request.result.createObjectStore('selections');
        if (!request.result.objectStoreNames.contains('guide-costs')) {
          request.result.createObjectStore('guide-costs', { keyPath: 'id' }).createIndex('guideKey', 'guideKey');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
    });
  }
  private async request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, name = 'segments'): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const request = operation(tx.objectStore(name));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(new Error(`Translation cache could not be saved: ${tx.error?.message ?? 'storage unavailable'}`));
      tx.onerror = () => reject(tx.error);
    });
  }
  get(key: string) { return this.request<CachedTranslation | undefined>('readonly', s => s.get(key)); }
  async put(key: string, value: CachedTranslation) { await this.request('readwrite', s => s.put(value, key)); }
  async annotate(key: string, source: string): Promise<void> {
    await this.annotateMany([[key, source]]);
  }
  async annotateMany(entries: [string, string][]): Promise<void> {
    if (!entries.length) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('segments', 'readwrite');
      const store = tx.objectStore('segments');
      for (const [key, source] of entries) {
        const read = store.get(key);
        read.onsuccess = () => {
          const value = read.result as CachedTranslation | undefined;
          if (value && !value.source) store.put({ ...value, source }, key);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('无法补记译文原文。'));
      tx.onerror = () => reject(tx.error);
    });
  }
  async clear() { await this.request('readwrite', s => s.clear()); }
  count() { return this.request('readonly', s => s.count()); }
  async entries(): Promise<[string, CachedTranslation][]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('segments', 'readonly');
      const store = tx.objectStore('segments');
      const keys = store.getAllKeys(), values = store.getAll();
      tx.oncomplete = () => resolve(keys.result.map((key, i) => [String(key), values.result[i] as CachedTranslation]));
      tx.onabort = () => reject(tx.error ?? new Error('无法读取译文缓存。'));
      tx.onerror = () => reject(tx.error);
    });
  }
  async merge(entries: [string, CachedTranslation][]): Promise<{ added: number; kept: number }> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('segments', 'readwrite');
      const store = tx.objectStore('segments');
      let added = 0, kept = 0;
      for (const [key, value] of entries) {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result !== undefined) {
            kept++;
            const existing = request.result as CachedTranslation;
            if (!existing.source && value.source) store.put({ ...existing, source: value.source }, key);
          }
          else { store.put(value, key); added++; }
        };
      }
      tx.oncomplete = () => resolve({ added, kept });
      tx.onabort = () => reject(tx.error ?? new Error('无法合并译文缓存。'));
      tx.onerror = () => reject(tx.error);
    });
  }
  async saveSelection(source: string, cn: string, tw: string): Promise<void> {
    if (![source, cn, tw].every(value => typeof value === 'string' && value.trim())) return;
    const value = { source, cn, tw };
    const key = await digest(JSON.stringify([source, cn, tw]));
    await this.request('readwrite', store => store.put(value, key), 'selections');
  }
  selectionEntries(): Promise<SelectionTranslation[]> {
    return this.request('readonly', store => store.getAll(), 'selections');
  }
  async clearSelection(): Promise<void> { await this.request('readwrite', store => store.clear(), 'selections'); }
  async appendGuideCost(guideKey: string, cny: number | null): Promise<GuideCostEvent> {
    const event = { id: crypto.randomUUID(), guideKey, cny, at: new Date().toISOString() };
    await this.request('readwrite', store => store.add(event), 'guide-costs');
    return event;
  }
  async guideCost(guideKey: string): Promise<GuideCostSummary> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('guide-costs', 'readonly');
      const request = tx.objectStore('guide-costs').index('guideKey').getAll(guideKey);
      tx.oncomplete = () => resolve(summarizeGuideCosts(request.result as GuideCostEvent[]));
      tx.onabort = () => reject(tx.error ?? new Error('无法读取攻略费用记录。'));
      tx.onerror = () => reject(tx.error);
    });
  }
  costEntries(): Promise<GuideCostEvent[]> { return this.request('readonly', store => store.getAll(), 'guide-costs'); }
  async mergeGuideCosts(events: GuideCostEvent[]): Promise<{ added: number; kept: number }> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('guide-costs', 'readwrite');
      const store = tx.objectStore('guide-costs');
      let added = 0, kept = 0;
      const seen = new Set<string>();
      for (const event of events) {
        if (seen.has(event.id)) { kept++; continue; }
        seen.add(event.id);
        const request = store.get(event.id);
        request.onsuccess = () => { if (request.result) kept++; else { store.add(event); added++; } };
      }
      tx.oncomplete = () => resolve({ added, kept });
      tx.onabort = () => reject(tx.error ?? new Error('无法导入攻略费用记录。'));
      tx.onerror = () => reject(tx.error);
    });
  }
  async clearGuideCosts(): Promise<void> { await this.request('readwrite', store => store.clear(), 'guide-costs'); }
}
