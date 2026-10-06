import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './vendor/defaults.js';
import { defaultSettings, normalizeSettings, validateSettings, selectionSettings } from './settings';
import { translationProfile } from './profile';
import { digest } from './engine';
import { FORMAT_VERSION, GLOSSARY_VERSION } from './protocol';

describe('shared full-page and selection settings', () => {
  it('retains every original configuration option and upgrades existing saved keys', () => {
    expect(Object.keys(defaultSettings).sort()).toEqual([...Object.keys(DEFAULTS), 'debugEnabled'].sort());
    const upgraded = normalizeSettings({ apiKey: 'existing-key', thinkingMode: 'enabled', model: 'custom-model' });
    expect(upgraded).toMatchObject({ apiKey: 'existing-key', model: 'custom-model', thinkingMode: 'enabled', showButton: true, autoTranslate: false });
    expect(() => validateSettings(upgraded)).not.toThrow();
  });
  it('rejects invalid API URLs, parameters and JSON objects before saving', () => {
    for (const patch of [{ baseUrl: 'file:///x' }, { temperature: 3 }, { maxTokens: -1 }, { extraHeaders: '[]' }, { customBody: '{' }, { theme: 'pink' }]) {
      expect(() => validateSettings({ ...defaultSettings, ...patch })).toThrow();
    }
    expect(() => validateSettings({ ...defaultSettings, thinkingMode: 'default', baseUrl: 'https://proxy.example/v1', extraHeaders: '{"X-Custom":"test"}' })).not.toThrow();
  });
  it('returns only interaction preferences to content scripts', () => {
    const publicSettings = selectionSettings({ ...defaultSettings, apiKey: 'secret', tavilyApiKey: 'secret2', extraHeaders: '{"Authorization":"private"}' });
    expect(publicSettings).toMatchObject({ showButton: true, dualOutput: true });
    expect(JSON.stringify(publicSettings)).not.toMatch(/secret|private|systemPrompt|baseUrl/);
  });
});
describe('cache profile compatibility', () => {
  it('preserves the exact 1.3.2 profile for existing settings', async () => {
    const s = { ...defaultSettings, apiKey: 'secret', model: 'my-model' };
    const legacy = { version: FORMAT_VERSION, glossary: GLOSSARY_VERSION, apiMode: s.apiMode, model: s.model, systemPrompt: s.systemPrompt, userPrompt: s.userPrompt, thinkingMode: s.thinkingMode, glossaryEnabled: s.glossaryEnabled, poe2dbDirectEnabled: s.poe2dbDirectEnabled, tavilyEnabled: s.tavilyEnabled };
    expect(await translationProfile(s)).toBe(await digest(JSON.stringify(legacy)));
  });
  it('ignores selection UI, credentials, prices and language for full-page caching', async () => {
    expect(await translationProfile({ ...defaultSettings, theme: 'dark', dualOutput: false, targetLang: '日本語', panelWidth: 600, priceOutput: 7, apiKey: 'changed', timeoutMs: 60000, stream: false, debugEnabled: true })).toBe(await translationProfile(defaultSettings));
  });
  it('separates translation parameters and imported terminology, but reuses restored profiles', async () => {
    const original = await translationProfile(defaultSettings);
    expect(await translationProfile({ ...defaultSettings, baseUrl: 'https://proxy.example' })).not.toBe(original);
    expect(await translationProfile({ ...defaultSettings, temperature: .5 })).not.toBe(original);
    expect(await translationProfile(defaultSettings, { entries: [{ e: 'Lich', c: '巫妖', t: '妖巫' }] })).not.toBe(original);
    expect(await translationProfile(defaultSettings)).toBe(original);
  });
});
