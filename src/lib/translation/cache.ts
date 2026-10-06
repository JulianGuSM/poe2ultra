import type { TranslationStore } from './engine';
import type { Translation } from './plan';

/** Extension-origin IndexedDB: survives closing the guide, service worker and browser. No TTL. */
export class PersistentCache implements TranslationStore {
  private database?: Promise<IDBDatabase>;
  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('poe2ultra-translations', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('segments');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
    });
  }
  private async request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('segments', mode);
      const request = operation(tx.objectStore('segments'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(new Error(`Translation cache could not be saved: ${tx.error?.message ?? 'storage unavailable'}`));
      tx.onerror = () => reject(tx.error);
    });
  }
  get(key: string) { return this.request<Translation | undefined>('readonly', s => s.get(key)); }
  async put(key: string, value: Translation) { await this.request('readwrite', s => s.put(value, key)); }
  async clear() { await this.request('readwrite', s => s.clear()); }
  count() { return this.request('readonly', s => s.count()); }
}
