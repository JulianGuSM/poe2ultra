import { segmentKey, type CachedTranslation, type Records, type Segment, type Translation } from './plan';
import { batches } from './protocol';
import type { ReportActivity } from './activity';
import type { BatchDebug, DebugSession } from './debug';

export interface TranslationStore {
  get(key: string): Promise<CachedTranslation | undefined>;
  put(key: string, value: CachedTranslation): Promise<void>;
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
  private async key(segment: Segment, profile: string) { return digest(`${profile}\n${segmentKey(segment)}`); }
  async inspect(segments: Segment[], profile: string): Promise<Progress> {
    const unique = [...new Map(segments.map(s => [segmentKey(s), s])).values()];
    const records: Records = {};
    const missingSources: [string, string][] = [];
    await Promise.all(unique.map(async segment => {
      const key = await this.key(segment, profile);
      const value = await this.store.get(key);
      if (value && [value.cn, value.tw].every(texts => Array.isArray(texts) && texts.every(text => typeof text === 'string') && texts.join('').trim())) {
        if (!value.source) missingSources.push([key, segment.texts.join('')]);
        records[segmentKey(segment)] = { cn: value.cn, tw: value.tw };
      }
    }));
    // Legacy cache entries used opaque hashes. Backfill their English in one write transaction.
    // A failed optional backfill must never hide an already-paid translation from the guide.
    try {
      if (missingSources.length && this.store.annotateMany) await this.store.annotateMany(missingSources);
      else if (this.store.annotate) await Promise.all(missingSources.map(([key, source]) => this.store.annotate!(key, source)));
    } catch (error) { console.warn('Translation source backfill failed:', error); }
    const count = Object.keys(records).length;
    return { records, total: unique.length, completed: count, cached: count };
  }
  async run(segments: Segment[], profile: string, signal: AbortSignal, onProgress: (progress: Progress) => void, onActivity: ReportActivity = () => {}, debug?: DebugSession,
    onBatchFailure: (failure: BatchFailure) => void = () => {}): Promise<RunSummary> {
    const unique = [...new Map(segments.map(s => [segmentKey(s), s])).values()];
    onActivity({ stage: 'checking' });
    const state = await this.inspect(unique, profile);
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
          const latest = await this.inspect(batch, profile);
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
              await this.store.put(await this.key(segment, profile), { ...translated[i]!, source: segment.texts.join('') });
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
