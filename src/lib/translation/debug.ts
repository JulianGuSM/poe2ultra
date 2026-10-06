import type { Settings } from './settings';
import type { Segment } from './plan';

export const DEBUG_LIMIT = 500;
const REDACTED = '[REDACTED]';
const secretKey = /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[_-]?secret|api[_-]?key|tavilyApiKey|access[_-]?token|refresh[_-]?token|token|credential[s]?|x-api-key)$/i;
const publicHeader = /^(content-type|accept|accept-language|user-agent)$/i;
type Credentials = Pick<Settings, 'apiKey' | 'tavilyApiKey' | 'extraHeaders'> & Partial<Pick<Settings, 'customBody' | 'baseUrl'>>;
/** Full content is retained; known credentials and credential-bearing fields are removed before storage or console output. */
export function redactDebug(value: unknown, settings: Credentials, context?: unknown): unknown {
  const secrets = [settings.apiKey, settings.tavilyApiKey].filter(Boolean);
  try { for (const [key, val] of Object.entries(JSON.parse(settings.extraHeaders || '{}'))) if (!publicHeader.test(key) && typeof val === 'string' && val) secrets.push(val); } catch { /* Settings validation reports malformed JSON separately. */ }
  const collect = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    for (const [key, val] of Object.entries(item)) {
      if (secretKey.test(key) && typeof val === 'string' && val) secrets.push(val);
      else collect(val);
    }
  };
  collect(value);
  collect(context);
  try { collect(JSON.parse(settings.customBody || '{}')); } catch { /* Invalid custom JSON is reported by validation. */ }
  try { for (const [key, val] of new URL(settings.baseUrl || 'https://example.com').searchParams) if (secretKey.test(key) && val) secrets.push(val); } catch { /* Invalid endpoints are reported elsewhere. */ }
  const variants = [...new Set(secrets.flatMap(secret => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]))].filter(Boolean).sort((a, b) => b.length - a.length);
  const cleanString = (text: string) => {
    for (const secret of variants) text = text.replaceAll(secret, REDACTED);
    return text.replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|signature|password)=)[^&#\s"']*/gi, `$1${REDACTED}`)
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, `Bearer ${REDACTED}`);
  };
  const walk = (item: unknown, parent = ''): unknown => {
    if (typeof item === 'string') return cleanString(item);
    if (Array.isArray(item)) return item.map(v => walk(v));
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).map(([key, val]) => [key,
      secretKey.test(key) || (/headers/i.test(parent) && !publicHeader.test(key)) ? REDACTED : walk(val, key)]));
  };
  return walk(value);
}
export interface DebugRecord {
  id: string; runId: string; schemaVersion: 1; startedAt: string; updatedAt: string;
  batch: number; batches: number; status: 'running' | 'success' | 'error' | 'cancelled';
  context: Record<string, unknown>; data: Record<string, unknown>;
  stream: { text: string; reasoning: string; http: string };
  events: { at: string; elapsedMs: number; name: string; details?: unknown }[];
  error?: { name: string; message: string; stack?: string; details?: unknown };
}
export class DebugStore {
  private database?: Promise<IDBDatabase>;
  constructor(private name = 'poe2ultra-translation-debug', readonly limit = DEBUG_LIMIT) {}
  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('batches', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => () => T) {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('batches', mode);
      const result = operation(tx.objectStore('batches'));
      tx.oncomplete = () => resolve(result());
      tx.onabort = () => reject(tx.error ?? new Error('调试日志存储事务已中断'));
      tx.onerror = () => reject(tx.error ?? new Error('调试日志存储不可用'));
    });
  }
  async put(record: DebugRecord) {
    await this.transaction('readwrite', store => {
      store.put(record);
      const count = store.count();
      count.onsuccess = () => {
        let remaining = count.result - this.limit;
        if (remaining <= 0) return;
        const cursor = store.index('startedAt').openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result || remaining-- <= 0) return;
          cursor.result.delete(); cursor.result.continue();
        };
      };
      return () => undefined;
    });
  }
  async list(): Promise<DebugRecord[]> { return this.transaction('readonly', s => { const r = s.index('startedAt').getAll(); return () => r.result; }); }
  async count() { return this.transaction('readonly', s => { const r = s.count(); return () => r.result; }); }
  async clear() { await this.transaction('readwrite', s => { s.clear(); return () => undefined; }); }
}
export class BatchDebug {
  private pending = Promise.resolve();
  private lastCheckpoint = Date.now();
  private lastEvent = '';
  private lastEventAt = 0;
  constructor(private store: DebugStore, readonly record: DebugRecord, private settings: Credentials, private onError: () => void) {}
  event(name: string, details?: unknown) {
    const now = Date.now();
    if (name === this.lastEvent && now - this.lastEventAt < 1000) return;
    this.lastEvent = name; this.lastEventAt = now;
    this.record.events.push({ at: new Date(now).toISOString(), elapsedMs: now - Date.parse(this.record.startedAt), name, details });
    console.info('[poe2ultra debug]', this.record.id, name, redactDebug(details, this.settings, this.record.data));
  }
  async data(name: string, value: unknown) {
    this.record.data[name] = value;
    console.info('[poe2ultra debug]', this.record.id, name, redactDebug(value, this.settings, this.record.data));
    await this.flush();
  }
  chunk(kind: 'text' | 'reasoning' | 'http', delta: string) {
    this.record.stream[kind] += delta;
    if (Date.now() - this.lastCheckpoint >= 2000) void this.flush();
  }
  async flush() {
    this.lastCheckpoint = Date.now(); this.record.updatedAt = new Date().toISOString();
    const snapshot = redactDebug(this.record, this.settings) as DebugRecord;
    this.pending = this.pending.then(() => this.store.put(snapshot)).catch(() => this.onError());
    await this.pending;
  }
  async finish(status: DebugRecord['status'], error?: unknown) {
    this.record.status = status;
    if (error) {
      const e = error as Error & { details?: unknown };
      this.record.error = { name: e.name ?? 'Error', message: e.message ?? String(error), stack: e.stack, details: e.details };
    }
    this.event(status, this.record.error);
    await this.flush();
  }
}
export class DebugSession {
  readonly id = `${Date.now()}-${crypto.randomUUID()}`;
  private warned = false;
  constructor(private store: DebugStore, private settings: Credentials, private context: Record<string, unknown> = {}, private onError: () => void = () => {}) {}
  async start(input: { batch: number; batches: number; segments: Segment[] }) {
    const now = new Date().toISOString();
    const trace = new BatchDebug(this.store, {
      id: `${this.id}-${String(input.batch).padStart(6, '0')}`, runId: this.id, schemaVersion: 1,
      startedAt: now, updatedAt: now, batch: input.batch, batches: input.batches, status: 'running',
      context: this.context, data: { sourceSegments: input.segments }, stream: { text: '', reasoning: '', http: '' }, events: [],
    }, this.settings, () => { if (!this.warned) { this.warned = true; this.onError(); } });
    trace.event('batch-start');
    await trace.flush();
    return trace;
  }
}
