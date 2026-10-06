import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebugStore, DebugSession, redactDebug } from './debug';
import { defaultSettings } from './settings';
import { TranslationEngine } from './engine';
import { parseBatch } from './protocol';

afterEach(() => vi.restoreAllMocks());
const settings = { ...defaultSettings, apiKey: 'sk-secret-example', tavilyApiKey: 'tavily-secret', extraHeaders: '{"X-Custom":"private-header"}' };
const segment = { kind: 'prose' as const, texts: ['Use ', 'this skill.'], protected: [] };
describe('persistent batch debugging', () => {
  it('redacts credentials wherever echoed, without truncating prompts or translation arrays', () => {
    const text = 'Complete guide text. '.repeat(1000);
    const clean = redactDebug({ body: { input: text, client_secret: 'body-secret' }, headers: { Authorization: 'Bearer unknown-key', 'X-Custom': 'private-header' }, output: 'sk-secret-example tavily-secret private-header', endpoint: 'https://proxy.example/api?api_key=url-secret&lang=cn' }, settings);
    expect((clean as any).body.input).toBe(text);
    expect(JSON.stringify(clean)).not.toMatch(/sk-secret-example|tavily-secret|private-header|unknown-key|body-secret|url-secret/);
  });
  it('also redacts JSON-escaped and URL-encoded credentials echoed in HTTP or console diagnostics', () => {
    const secret = 'sk-"quoted/secret"';
    const configured = { ...settings, apiKey: secret, customBody: '{"client_secret":"extra-secret"}', baseUrl: 'https://proxy.example?token=query-secret' };
    const raw = JSON.stringify({ value: secret }) + encodeURIComponent(secret) + ' extra-secret query-secret';
    const clean = redactDebug(raw, configured) as string;
    expect(clean).not.toMatch(/quoted|extra-secret|query-secret/);
  });
  it('keeps request, response, timeline and validation error after reopening, without caching the failed translation', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const store = new DebugStore('debug-failure-test');
    const saved = new Map();
    const engine = new TranslationEngine({ get: async key => saved.get(key), put: async (key, val) => { saved.set(key, val); } }, async (batch, _signal, report, trace) => {
      await trace!.data('request', { body: { messages: [{ role: 'user', content: JSON.stringify(batch) }] }, headers: { Authorization: 'Bearer sk-secret-example' } });
      trace!.chunk('text', 'partial');
      report({ stage: 'receiving', receivedChars: 7 });
      const response = { text: '{"translations":[{"id":0,"cn":null,"tw":"使用技能"}]}', finishReason: 'stop' };
      await trace!.data('response', response);
      return parseBatch(response.text, batch);
    });
    await expect(engine.run([segment], 'profile', new AbortController().signal, () => {}, () => {}, new DebugSession(store, settings, { guideUrl: 'https://mobalytics.gg/poe-2/builds/test' }))).rejects.toThrow('未返回有效译文');
    expect(saved.size).toBe(0);
    const records = await new DebugStore('debug-failure-test').list();
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.status).toBe('error');
    expect(record.batch).toBe(1);
    expect(record.data.response).toMatchObject({ finishReason: 'stop' });
    expect(record.error?.details).toMatchObject({ code: 'block_translation', locale: 'cn', segmentId: 0, sourceText: 'Use this skill.' });
    expect(record.stream.text).toBe('partial');
    expect(record.events.some(e => e.name === 'receiving')).toBe(true);
    expect(JSON.stringify(records)).not.toContain('sk-secret-example');
  });
  it('bounds retention and clears only debug records', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const store = new DebugStore('debug-retention-test', 2);
    const session = new DebugSession(store, settings);
    for (let i = 1; i <= 3; i++) { const trace = await session.start({ batch: i, batches: 3, segments: [segment] }); await trace.finish('success'); }
    expect((await store.list()).map(r => r.batch)).toEqual([2, 3]);
    await store.clear(); expect(await store.count()).toBe(0);
  });
  it('does not let debug storage failure break a paid translation', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const warning = vi.fn();
    const store = new DebugStore('debug-unavailable-test');
    vi.spyOn(store, 'put').mockRejectedValue(new Error('disk full'));
    const session = new DebugSession(store, settings, {}, warning);
    const trace = await session.start({ batch: 1, batches: 1, segments: [segment] });
    await trace.data('request', { body: 'all input' });
    await trace.finish('success');
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
