import { segmentKey, type CachedTranslation, type Records, type Segment, type Translation } from './plan';
import { batches } from './protocol';
import type { ReportActivity } from './activity';
import type { BatchDebug, DebugSession } from './debug';

export interface TranslationStore {
  get(key: string): Promise<CachedTranslation | undefined>;
  put(key: string, value: CachedTranslation): Promise<void>;
  findBySource?(source: string): Promise<[string, CachedTranslation][]>;
  annotate?(key: string, source: string): Promise<void>;
  annotateMany?(entries: [string, string][]): Promise<void>;
}
export interface Progress { records: Records; completed: number; total: number; cached: number }
export interface BatchFailure { batch: number; batches: number; message: string }
export interface RunSummary { failedBatches: number; failures: BatchFailure[] }
export async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/** Shared by all ports: serialize paid work, then re-check cache inside the lock. */
export class TranslationEngine {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: TranslationStore, private translate: (batch: Segment[], signal: AbortSignal, report: ReportActivity, debug?: BatchDebug) => Promise<Translation[]>) {}
  /** Content identity is independent of the translation settings. */
  private async key(segment: Segment) { return digest(segment.texts.join('')); }
  private async legacyKey(segment: Segment, profile: string) { return digest(`${profile}\n${segmentKey(segment)}`); }
  async inspect(segments: Segment[], profile: string, onProgress?: (checked: number, total: number) => void, fallbackProfiles: string[] = []): Promise<Progress> {
    const unique = [...new Map(segments.map(s => [segmentKey(s), s])).values()];
    const records: Records = {};
    const missingSources: [string, string][] = [];
    let checked = 0;
    let reportedPercent = -1;
    const inspectSegment = async (segment: Segment) => {
      const key = await this.key(segment);
      const source = segment.texts.join('');
      let value = await this.store.get(key);
      const valid = (entry: CachedTranslation | undefined): entry is CachedTranslation => !!entry &&
        [entry.cn, entry.tw].every(texts => Array.isArray(texts) && texts.every(text => typeof text === 'string') && texts.join('').trim()) &&
        (entry.source === undefined || entry.source === source);
      if (!valid(value) && fallbackProfiles.length) {
        const legacySegment = segment.widgetIndices?.length
          ? { kind: segment.kind, texts: segment.texts, protected: segment.protected }
          : segment;
        const candidates = legacySegment === segment ? [segment] : [segment, legacySegment];
        search: for (const fallbackProfile of fallbackProfiles) for (const candidate of candidates) {
          const fallbackKey = await this.legacyKey(candidate, fallbackProfile);
          const fallbackValue = await this.store.get(fallbackKey);
          if (!valid(fallbackValue)) continue;
          value = { ...fallbackValue, source, sourceHash: key, configHash: fallbackProfile };
          try {
            await this.store.put(key, value);
          } catch (error) { console.warn('Legacy translation cache migration failed:', error); }
          break search;
        }
      }
      if (this.store.findBySource) {
        const matches = await this.store.findBySource(source);
        const validMatches = matches.filter(([, entry]) => valid(entry));
        const exact = validMatches.find(([, entry]) => entry.configHash === profile);
        // Prefer a matching configuration if another version exists; otherwise keep
        // the current text match visible without a new request.
        const match = exact ?? (!valid(value) ? validMatches[0] : undefined);
        if (match && (!valid(value) || value.configHash !== profile)) {
          value = { ...match[1], source, sourceHash: key };
          try { await this.store.put(key, value); }
          catch (error) { console.warn('Source-based translation cache migration failed:', error); }
        }
      }
      if (valid(value)) {
        if (!value.source) missingSources.push([key, source]);
        records[segmentKey(segment)] = { cn: value.cn, tw: value.tw, ...(value.widgetLabels ? { widgetLabels: value.widgetLabels } : {}) };
      }
      checked++;
      const percent = unique.length ? Math.floor(checked / unique.length * 100) : 100;
      if (percent !== reportedPercent || checked === unique.length) {
        reportedPercent = percent;
        onProgress?.(checked, unique.length);
      }
    };
    // Keep IndexedDB transaction fan-out bounded. Large guides can contain hundreds or thousands of blocks;
    // opening one transaction per block all at once can stall the browser's cache queue before any progress lands.
    const concurrency = 32;
    for (let offset = 0; offset < unique.length; offset += concurrency) {
      await Promise.all(unique.slice(offset, offset + concurrency).map(inspectSegment));
    }
    // Legacy cache entries used opaque hashes. Backfill their English in one write transaction.
    // A failed optional backfill must never hide an already-paid translation from the guide.
    try {
      if (missingSources.length && this.store.annotateMany) await this.store.annotateMany(missingSources);
      else if (this.store.annotate) await Promise.all(missingSources.map(([key, source]) => this.store.annotate!(key, source)));
    } catch (error) { console.warn('Translation source backfill failed:', error); }
    const count = Object.keys(records).length;
    return { records, total: unique.length, completed: count, cached: count };
  }
  async retranslate(segments: Segment[], profile: string, signal: AbortSignal, onActivity: ReportActivity = () => {}, debug?: DebugSession): Promise<Translation[]> {
    const unique = [...new Map(segments.map(segment => [segmentKey(segment), segment])).values()];
    if (!unique.length) throw new Error('No text blocks to retranslate.');
    const task = this.queue.catch(() => {}).then(async () => {
      signal.throwIfAborted();
      let trace: BatchDebug | undefined;
      const report: ReportActivity = event => { trace?.event(event.stage, event); onActivity(event); };
      report({ stage: 'queued' });
      trace = await debug?.start({ batch: 1, batches: 1, segments: unique });
      try {
        report({ stage: 'checking' });
        const translated = await this.translate(unique, signal, report, trace);
        if (translated.length !== unique.length) throw new Error('Incomplete provider response.');
        for (const [index, segment] of unique.entries()) {
          const source = segment.texts.join('');
          const sourceHash = await this.key(segment);
          await this.store.put(sourceHash, { ...translated[index]!, source, sourceHash, configHash: profile, translatedAt: new Date().toISOString() });
        }
        await trace?.finish('success');
        return translated;
      } catch (error) {
        await trace?.finish(signal.aborted ? 'cancelled' : 'error', error);
        if (trace && error instanceof Error) Object.assign(error, { debugId: trace.record.id });
        throw error;
      }
    });
    this.queue = task;
    return task;
  }
  async run(segments: Segment[], profile: string, signal: AbortSignal, onProgress: (progress: Progress) => void, onActivity: ReportActivity = () => {}, debug?: DebugSession,
    onBatchFailure: (failure: BatchFailure) => void = () => {}, fallbackProfiles: string[] = []): Promise<RunSummary> {
    const unique = [...new Map(segments.map(s => [segmentKey(s), s])).values()];
    onActivity({ stage: 'checking' });
    const state = await this.inspect(unique, profile, undefined, fallbackProfiles);
    onProgress(state);
    const pending = batches(unique.filter(s => !state.records[segmentKey(s)]));
    const failures: BatchFailure[] = [];
    let consecutiveOutputFailures = 0;
    for (const [index, batch] of pending.entries()) {
      let trace: BatchDebug | undefined;
      const report: ReportActivity = activity => { trace?.event(activity.stage, activity); onActivity({ ...activity, batch: index + 1, batches: pending.length }); };
      report({ stage: 'queued' });
      const task = this.queue.catch(() => {}).then(async () => {
        signal.throwIfAborted();
        trace = await debug?.start({ batch: index + 1, batches: pending.length, segments: batch });
        try {
          report({ stage: 'checking' });
          const latest = await this.inspect(batch, profile, undefined, fallbackProfiles);
          const missing = batch.filter(s => !latest.records[segmentKey(s)]);
          const cacheState = { reused: batch.length - missing.length, saved: 0 };
          await trace?.data('cache', cacheState);
          await trace?.data('uncachedSegments', missing);
          if (missing.length) {
            signal.throwIfAborted();
            const translated = await this.translate(missing, signal, report, trace);
            if (translated.length !== missing.length) throw new Error('Incomplete provider response.');
            report({ stage: 'saving' });
            // Commit successful work even if Stop arrived just after the response completed.
            for (const [i, segment] of missing.entries()) {
              const source = segment.texts.join('');
              const sourceHash = await this.key(segment);
              await this.store.put(sourceHash, { ...translated[i]!, source, sourceHash, configHash: profile, translatedAt: new Date().toISOString() });
              latest.records[segmentKey(segment)] = translated[i]!;
              cacheState.saved++;
            }
          }
          Object.assign(state.records, latest.records);
          state.completed = Object.keys(state.records).length;
          onProgress({ ...state, records: { ...state.records } });
          await trace?.finish('success');
        } catch (error) {
          await trace?.finish(signal.aborted ? 'cancelled' : 'error', error);
          if (trace && error instanceof Error) Object.assign(error, { debugId: trace.record.id });
          throw error;
        }
      });
      this.queue = task;
      try { await task; consecutiveOutputFailures = 0; }
      catch (error) {
        if (signal.aborted || !(error as { recoverableBatch?: boolean })?.recoverableBatch) throw error;
        const failure = { batch: index + 1, batches: pending.length,
          message: error instanceof Error ? error.message + ((error as Error & { debugId?: string }).debugId ? `\n调试记录：${(error as Error & { debugId: string }).debugId}` : '') : String(error) };
        failures.push(failure);
        onBatchFailure(failure);
        if (++consecutiveOutputFailures >= 3) {
          throw new Error(`连续 ${consecutiveOutputFailures} 批模型输出无效，已暂停以避免继续产生费用。最后一次错误：${failure.message}`);
        }
      }
    }
    return { failedBatches: failures.length, failures };
  }
}
