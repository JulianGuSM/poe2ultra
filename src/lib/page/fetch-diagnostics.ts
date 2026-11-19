import type { FetchAttemptLog } from './fetch-html';

export const FETCH_DIAGNOSTICS_LIMIT = 100;

export interface FetchDiagnosticSession {
  id: string;
  startedAt: string;
  updatedAt: string;
  url: string;
  attempts: FetchAttemptLog[];
}

/** Stores bounded, credential-free page-fetch metadata in the extension's IndexedDB. */
export class FetchDiagnosticsStore {
  private database?: Promise<IDBDatabase>;
  constructor(private name = 'poe2ultra-fetch-diagnostics', readonly limit = FETCH_DIAGNOSTICS_LIMIT) {}

  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => () => T) {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('sessions', mode);
      const result = action(tx.objectStore('sessions'));
      tx.oncomplete = () => resolve(result());
      tx.onabort = () => reject(tx.error ?? new Error('页面请求日志存储事务已中断'));
      tx.onerror = () => reject(tx.error ?? new Error('页面请求日志存储不可用'));
    });
  }

  async append(sessionId: string, url: string, attempt: FetchAttemptLog) {
    const now = new Date().toISOString();
    await this.transaction('readwrite', (store) => {
      const request = store.get(sessionId);
      request.onsuccess = () => {
        const session: FetchDiagnosticSession = request.result ?? {
          id: sessionId, startedAt: now, updatedAt: now, url: safePageUrl(url), attempts: [],
        };
        session.updatedAt = now;
        session.attempts.push(attempt);
        store.put(session);
        const count = store.count();
        count.onsuccess = () => {
          let remove = count.result - this.limit;
          if (remove <= 0) return;
          const cursor = store.index('startedAt').openCursor();
          cursor.onsuccess = () => {
            if (!cursor.result || remove-- <= 0) return;
            cursor.result.delete(); cursor.result.continue();
          };
        };
      };
      return () => undefined;
    });
  }

  async list(): Promise<FetchDiagnosticSession[]> {
    return this.transaction('readonly', (store) => {
      const request = store.index('startedAt').getAll();
      return () => request.result;
    });
  }

  async clear() { await this.transaction('readwrite', (store) => { store.clear(); return () => undefined; }); }
}

function safePageUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid URL]';
  }
}
