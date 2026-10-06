import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { translateBatch, defaultSettings } from './provider.js';
import type { Segment } from './plan';

const mocks = vi.hoisted(() => ({ translate: vi.fn(), glossary: vi.fn() }));
vi.mock('./vendor/glossary.js', async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, loadGlossary: mocks.glossary };
});
vi.mock('./vendor/deepseek.js', async importOriginal => ({ ...await importOriginal<object>(), translate: mocks.translate }));
vi.mock('./vendor/responses.js', async importOriginal => ({ ...await importOriginal<object>(), translate: mocks.translate }));

const term = { i: 'lich', e: 'Abyssal Lich', c: '深渊巫妖', t: '深淵妖巫' };
const settings = { ...defaultSettings, apiKey: 'test-placeholder', poe2dbDirectEnabled: false, tavilyEnabled: false };
const signal = () => new AbortController().signal;
const prose: Segment = { kind: 'prose', texts: ['Use Abyssal Lich for damage.'], protected: [] };

beforeEach(() => {
  mocks.translate.mockReset(); mocks.glossary.mockReset();
  mocks.glossary.mockResolvedValue({ index: { en: new Map([['abyssal lich', term]]), maxWords: 2, size: 1 }, source: 'bundled' });
});
describe('existing translator integration', () => {
  it('uses the two independent glossary columns without any paid request for exact names', async () => {
    const out = await translateBatch([{ kind: 'term', texts: ['Abyssal Lich'], protected: [] }], settings, signal());
    expect(out.translations).toEqual([{ cn: ['深渊巫妖'], tw: ['深淵妖巫'] }]);
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it.each(['chat', 'responses'] as const)('injects both terminology columns through the original %s prompt pipeline', async apiMode => {
    mocks.translate.mockResolvedValue({ text: '{"translations":[{"id":0,"cn":["使用深渊巫妖造成伤害。"],"tw":["使用深淵妖巫造成傷害。"]}]}', finishReason: 'stop', usage: { total_tokens: 100 } });
    const out = await translateBatch([prose], { ...settings, apiMode }, signal());
    expect(out.translations[0]?.tw[0]).toContain('深淵妖巫');
    const request = mocks.translate.mock.calls[0]![0];
    expect(request.input.terms[0].zh_cn).toBe('深渊巫妖');
    expect(request.input.terms[0].zh_tw).toBe('深淵妖巫');
    const client = await import('./vendor/deepseek.js');
    const body = client.buildBody(request.settings, request.input);
    expect(body.messages.at(-1).content).toContain('深淵妖巫');
    expect(body.messages.at(-1).content).toContain('深渊巫妖');
    expect(body.messages[0].content).toContain('JSON');
    const modeClient = await import(apiMode === 'chat' ? './vendor/deepseek.js' : './vendor/responses.js');
    const actual = modeClient.buildBody(request.settings, request.input);
    if (apiMode === 'chat') expect(actual.response_format).toEqual({ type: 'json_object' });
    else expect(actual.text).toEqual({ format: { type: 'json_object' } });
  });
  it('does not cache a response cut off by the provider', async () => {
    mocks.translate.mockResolvedValue({ text: '{}', finishReason: 'length' });
    await expect(translateBatch([prose], settings, signal())).rejects.toThrow('已达到输出 token 上限');
    expect(mocks.translate).toHaveBeenCalledTimes(1);
  });
  it.each(['chat', 'responses'] as const)('reports real %s activity before a batch completes and sends original complete blocks without markers', async apiMode => {
    const activity = vi.fn();
    const numbered: Segment = { kind: 'prose', texts: ['Gain ', '25%', ' damage.'], protected: [] };
    mocks.translate.mockImplementation(async ({ input, onChunk, onReasoning }) => {
      const block = JSON.parse(input.text).segments[0];
      expect(block).toEqual({ id: 0, text: 'Gain 25% damage.' });
      expect(input.text).not.toContain('⟦N');
      const texts = block.text;
      onReasoning('working');
      onChunk('partial JSON');
      expect(activity).toHaveBeenCalledWith(expect.objectContaining({ stage: 'receiving', receivedChars: 12 }));
      return { text: JSON.stringify({ translations: [{ id: 0, cn: texts, tw: texts }] }), finishReason: 'stop' };
    });
    const out = await translateBatch([numbered], { ...settings, apiMode }, signal(), activity);
    expect(out.translations[0]!.cn).toEqual([numbered.texts.join('')]);
    expect(activity.mock.calls.map(([event]) => event.stage)).toEqual(['glossary', 'context', 'requesting', 'reasoning', 'receiving', 'validating']);
  });
  it('ships all the original independently sourced terminology entries', () => {
    const data = JSON.parse(readFileSync('public/data/glossary.json', 'utf8'));
    expect(data.entries).toHaveLength(2245);
    expect(data.entries.find((e: { e: string }) => e.e === 'Abyssal Lich')).toMatchObject({ c: '深渊巫妖', t: '深淵妖巫' });
  });
  it('honors advanced request settings while retaining the full-page protocol', async () => {
    mocks.translate.mockResolvedValue({ text: '{"translations":[{"id":0,"cn":["译文"],"tw":["譯文"]}]}', finishReason: 'stop' });
    await translateBatch([prose], { ...settings, baseUrl: 'https://proxy.example/v1', stream: false, temperature: .5, maxTokens: 9000, timeoutMs: 60000, glossaryMaxTerms: 40, customBody: '{"top_p":0.9,"messages":[],"input":"wrong","text":{"format":{"type":"text"}},"response_format":{"type":"text"}}' }, signal());
    const request = mocks.translate.mock.calls[0]![0];
    expect(request.settings).toMatchObject({ baseUrl: 'https://proxy.example/v1', stream: false, temperature: .5, maxTokens: 9000, timeoutMs: 60000, glossaryMaxTerms: 40 });
    expect(JSON.parse(request.settings.customBody)).toEqual({ top_p: .9, text: { format: { type: 'json_object' } } });
    expect(request.settings.systemPrompt).toContain('Return every input id exactly once');
  });
  it('reports malformed output once without automatically charging for a retry', async () => {
    mocks.translate.mockResolvedValue({ text: '{"translations":', finishReason: 'stop' });
    await expect(translateBatch([prose], settings, signal())).rejects.toThrow(/没有完整闭合[\s\S]*返回开头/);
    expect(mocks.translate).toHaveBeenCalledTimes(1);
  });
  it('adds POE2 localization expertise even with an existing user prompt, without changing saved settings', async () => {
    mocks.translate.mockResolvedValue({ text: '{"translations":[{"id":0,"cn":["译文"],"tw":["譯文"]}]}', finishReason: 'stop' });
    const configured = { ...settings, systemPrompt: 'My saved translation preferences.' };
    await translateBatch([prose], configured, signal());
    const prompt = mocks.translate.mock.calls[0]![0].settings.systemPrompt;
    expect(prompt).toContain('POE2');
    expect(prompt).toContain('游戏本地化');
    expect(prompt).toContain('0.5 版本');
    expect(prompt).toContain('6K');
    expect(prompt).toContain('My saved translation preferences.');
    expect(configured.systemPrompt).toBe('My saved translation preferences.');
  });
});
