import { describe, expect, it, vi } from 'vitest';
import { TranslationEngine, type TranslationStore } from './engine';
import type { CachedTranslation, Segment, Translation } from './plan';
import { parseBatch } from './protocol';

const a: Segment = { kind: 'prose', texts: ['Use a skill.'], protected: [] };
const b: Segment = { kind: 'prose', texts: ['Use another skill.'], protected: [] };
const result: Translation = { cn: ['使用技能。'], tw: ['使用技能。'] };
function setup(translate = vi.fn(async (_batch: Segment[]) => [result])) {
  const saved = new Map<string, CachedTranslation>();
  const store: TranslationStore = { get: async key => saved.get(key), put: async (key, value) => { saved.set(key, value); } };
  return { saved, store, translate, engine: new TranslationEngine(store, translate) };
}
describe('persistent dual translation cache', () => {
  it('reopens a whole-paragraph translation even when the original had several formatting spans', async () => {
    const { engine, store, translate } = setup();
    const paragraph: Segment = { kind: 'prose', texts: ['Our defenses ', 'improved in ', '0.5.'], protected: [2] };
    await engine.run([paragraph], 'profile', new AbortController().signal, () => {});
    const reopened = new TranslationEngine(store, translate);
    await reopened.run([paragraph], 'profile', new AbortController().signal, () => {});
    expect(translate).toHaveBeenCalledTimes(1);
    expect((await reopened.inspect([paragraph], 'profile')).completed).toBe(1);
  });
  it('reuses both locales after reopening and across guides without another API request', async () => {
    const { engine, store, translate, saved } = setup();
    await engine.run([a, a], 'profile', new AbortController().signal, () => {});
    const reopened = new TranslationEngine(store, translate);
    await reopened.run([a], 'profile', new AbortController().signal, () => {});
    expect(translate).toHaveBeenCalledTimes(1);
    expect(Object.values((await reopened.inspect([a], 'profile')).records)[0]).toEqual(result);
    expect([...saved.values()][0]).toEqual({ ...result, source: a.texts.join('') });
  });
  it('fills in the English source of an older cached translation without another provider call', async () => {
    const { engine, saved, store, translate } = setup();
    const key = await (engine as any).key(a, 'profile');
    saved.set(key, result);
    store.annotate = vi.fn(async (storedKey, source) => {
      saved.set(storedKey, { ...saved.get(storedKey)!, source });
    });
    expect((await engine.inspect([a], 'profile')).cached).toBe(1);
    expect(saved.get(key)).toEqual({ ...result, source: a.texts.join('') });
    expect(store.annotate).toHaveBeenCalledOnce();
    expect(translate).not.toHaveBeenCalled();
  });
  it('keeps completed batches after a failure and resumes only missing content', async () => {
    const { engine, translate, saved } = setup();
    translate.mockRejectedValueOnce(new Error('network'));
    await expect(engine.run([a], 'profile', new AbortController().signal, () => {})).rejects.toThrow('network');
    expect(saved.size).toBe(0);
    await engine.run([a], 'profile', new AbortController().signal, () => {});
    translate.mockRejectedValueOnce(new Error('network'));
    await expect(engine.run([a, b], 'profile', new AbortController().signal, () => {})).rejects.toThrow('network');
    expect(saved.size).toBe(1);
    await engine.run([a, b], 'profile', new AbortController().signal, () => {});
    expect(translate.mock.calls.at(-1)?.[0]).toEqual([b]);
  });
  it('skips one malformed model batch without Debug, translates later batches and retries only the missing one', async () => {
    const first: Segment = { kind: 'prose', texts: ['A'.repeat(3400)], protected: [] };
    const later: Segment = { kind: 'prose', texts: ['B'.repeat(3400)], protected: [] };
    const { engine, translate } = setup();
    const failed = vi.fn();
    translate.mockRejectedValueOnce(Object.assign(new Error('模型返回的 JSON 格式无效'), { recoverableBatch: true }));
    const summary = await engine.run([first, later], 'p', new AbortController().signal, () => {}, () => {}, undefined, failed);
    expect(summary.failedBatches).toBe(1);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ batch: 1, batches: 2 }));
    expect((await engine.inspect([first, later], 'p')).completed).toBe(1);
    expect(translate).toHaveBeenCalledTimes(2);
    const retried = await engine.run([first, later], 'p', new AbortController().signal, () => {});
    expect(retried.failedBatches).toBe(0);
    expect(translate.mock.calls.at(-1)?.[0]).toEqual([first]);
    expect((await engine.inspect([first, later], 'p')).completed).toBe(2);
  });
  it('pauses after three consecutive malformed batches to avoid an expensive error cascade', async () => {
    const segments: Segment[] = ['A', 'B', 'C', 'D'].map(letter => ({ kind: 'prose', texts: [letter.repeat(3400)], protected: [] }));
    const translate = vi.fn(async () => { throw Object.assign(new Error('bad JSON'), { recoverableBatch: true }); });
    const { store } = setup();
    const engine = new TranslationEngine(store, translate);
    await expect(engine.run(segments, 'p', new AbortController().signal, () => {})).rejects.toThrow('连续 3 批');
    expect(translate).toHaveBeenCalledTimes(3);
  });
  it('coalesces concurrent requests and separates changed prompt profiles', async () => {
    const { engine, translate } = setup();
    await Promise.all([1, 2].map(() => engine.run([a], 'p1', new AbortController().signal, () => {})));
    expect(translate).toHaveBeenCalledTimes(1);
    await engine.run([a], 'p2', new AbortController().signal, () => {});
    expect(translate).toHaveBeenCalledTimes(2);
  });
  it('does not call the provider on a cancelled job', async () => {
    const { engine, translate } = setup();
    const abort = new AbortController(); abort.abort();
    await expect(engine.run([a], 'p', abort.signal, () => {})).rejects.toThrow();
    expect(translate).not.toHaveBeenCalled();
  });
  it('reports batch activity while awaiting the provider, and counts progress only after saving', async () => {
    const activity = vi.fn(), progress = vi.fn();
    const { store } = setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const engine = new TranslationEngine(store, async (_batch, _signal, report) => {
      report({ stage: 'receiving', receivedChars: 45 });
      await gate;
      return [result];
    });
    const job = engine.run([a], 'p', new AbortController().signal, progress, activity);
    await vi.waitFor(() => expect(activity).toHaveBeenCalledWith({ stage: 'receiving', receivedChars: 45, batch: 1, batches: 1 }));
    expect(progress.mock.calls.at(-1)![0].completed).toBe(0);
    release(); await job;
    expect(activity.mock.calls.map(([event]) => event.stage)).toEqual(['checking', 'queued', 'checking', 'receiving', 'saving']);
    expect(progress.mock.calls.at(-1)![0].completed).toBe(1);
  });
});
describe('provider output validation', () => {
  it('requires both complete locales and the exact segment IDs', () => {
    expect(() => parseBatch('{"translations":[{"id":0,"cn":["译文"]}]}', [a])).toThrow();
    expect(() => parseBatch('{"translations":[{"id":8,"cn":["译文"],"tw":["譯文"]}]}', [a])).toThrow();
    expect(parseBatch('```json\n{"translations":[{"id":0,"cn":["译文"],"tw":["譯文"]}]}\n```', [a])).toEqual([{ cn: ['译文'], tw: ['譯文'] }]);
  });
  it('does not constrain numeric wording or original formatting spans', () => {
    const segment: Segment = { kind: 'prose', texts: ['Gain 25% damage.', '/command'], protected: [1] };
    expect(parseBatch(JSON.stringify({ translations: [{ id: 0, cn: ['获得50%伤害。', '/command'], tw: ['獲得25%傷害。', '/command'] }] }), [segment])).toHaveLength(1);
    expect(parseBatch(JSON.stringify({ translations: [{ id: 0, cn: ['获得25%伤害。', '/changed'], tw: ['獲得25%傷害。', '/command'] }] }), [segment])).toHaveLength(1);
  });
});
