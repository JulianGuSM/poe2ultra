import { segmentKey, type Records, type Segment, type Translation } from './plan';
import { batches } from './protocol';
import type { ReportActivity } from './activity';
import type { BatchDebug, DebugSession } from './debug';

export interface TranslationStore { get(key: string): Promise<Translation | undefined>; put(key: string, value: Translation): Promise<void> }
export interface Progress { records: Records; completed: number; total: number; cached: number }
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
    await Promise.all(unique.map(async segment => {
      const value = await this.store.get(await this.key(segment, profile));
      if (value && [value.cn, value.tw].every(texts => Array.isArray(texts) && texts.every(text => typeof text === 'string') && texts.join('').trim())) records[segmentKey(segment)] = value;
    }));
    const count = Object.keys(records).length;
    return { records, total: unique.length, completed: count, cached: count };
  }
  async run(segments: Segment[], profile: string, signal: AbortSignal, onProgress: (progress: Progress) => void, onActivity: ReportActivity = () => {}, debug?: DebugSession): Promise<void> {
    const unique = [...new Map(segments.map(s => [segmentKey(s), s])).values()];
    onActivity({ stage: 'checking' });
    const state = await this.inspect(unique, profile);
    onProgress(state);
    const pending = batches(unique.filter(s => !state.records[segmentKey(s)]));
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
              await this.store.put(await this.key(segment, profile), translated[i]!);
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
      await task;
    }
  }
}
