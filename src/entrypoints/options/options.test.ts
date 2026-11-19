import { afterEach, expect, it, vi } from 'vitest';
import { waitFor, fireEvent } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { defaultSettings } from '@/lib/translation/settings';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it('loads the original Chinese form with existing settings and saves all advanced and selection preferences', async () => {
  document.body.innerHTML = readFileSync('src/entrypoints/options/index.html', 'utf8').match(/<body>([\s\S]*)<\/body>/)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === 'translation-settings') return { settings: defaultSettings, count: 42 };
    if (message.type === 'get-settings') return { ok: true, data: { ...defaultSettings, apiKey: 'existing-test-key' } };
    if (message.type === 'save-settings') return { ok: true, data: message.patch };
    if (message.type === 'glossary-stats') return { ok: true, data: { indexSize: 4324, categories: [], activeSource: 'bundled' } };
    return { ok: true, data: { entries: 0 } };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { contains: async () => true, request: async () => true } });
  await import('./main.js');
  await waitFor(() => expect(document.getElementById('guide-cache-state')!.textContent).toContain('42'));
  expect((document.getElementById('apiKey') as HTMLInputElement).value).toBe('existing-test-key');
  expect(document.querySelector('h1')!.textContent).toBe('poe2ultra 翻译设置');
  expect((document.getElementById('glossaryMaxTerms') as HTMLInputElement).value).toBe('80');
  expect((document.getElementById('chinaTradeLeague') as HTMLInputElement).value).toBe('周年庆巅峰挑战');
  fireEvent.input(document.getElementById('chinaTradeLeague')!, { target: { value: '测试国服赛季' } });
  fireEvent.input(document.getElementById('baseUrl')!, { target: { value: 'https://proxy.example/v1' } });
  fireEvent.input(document.getElementById('panelWidth')!, { target: { value: '520' } });
  fireEvent.input(document.getElementById('extraHeaders')!, { target: { value: '{"X-Test":"value"}' } });
  fireEvent.click(document.getElementById('btn-save')!);
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'save-settings', patch: expect.objectContaining({ baseUrl: 'https://proxy.example/v1', panelWidth: 520, extraHeaders: '{"X-Test":"value"}', showButton: true, dualOutput: true, maxTokens: 16384 }) })));
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'save-settings', patch: expect.objectContaining({ chinaTradeLeague: '测试国服赛季' }) }));
  expect(sendMessage.mock.calls.some(([message]) => message.type === 'test-connection')).toBe(false);
});
