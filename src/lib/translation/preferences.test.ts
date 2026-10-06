import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, SETTINGS_KEY } from './settings';
import { translationProfile } from './profile';
import { digest } from './engine';
import { FORMAT_VERSION, GLOSSARY_VERSION } from './protocol';

const local = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: {
  get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, local[key]])),
  set: async (values: object) => Object.assign(local, values),
} } } }));
import { guideCachePrompts, saveSettings, resetSettings } from './preferences';

beforeEach(() => { for (const key of Object.keys(local)) delete local[key]; });

it('keeps the old custom-prompt cache namespace across selection edits and resets', async () => {
  const previous = { ...defaultSettings, systemPrompt: 'previous custom system', userPrompt: 'previous custom {{text}}' };
  local[SETTINGS_KEY] = previous;
  const legacyProfile = await digest(JSON.stringify({ version: FORMAT_VERSION, glossary: GLOSSARY_VERSION,
    apiMode: previous.apiMode, model: previous.model, systemPrompt: previous.systemPrompt, userPrompt: previous.userPrompt,
    thinkingMode: previous.thinkingMode, glossaryEnabled: previous.glossaryEnabled,
    poe2dbDirectEnabled: previous.poe2dbDirectEnabled, tavilyEnabled: previous.tavilyEnabled }));
  const updated = await saveSettings({ systemPrompt: 'new selection system', userPrompt: 'new selection {{text}}' });
  expect(await guideCachePrompts()).toEqual({ systemPrompt: previous.systemPrompt, userPrompt: previous.userPrompt });
  expect(await translationProfile(updated, null, await guideCachePrompts())).toBe(legacyProfile);
  const reset = await resetSettings();
  expect(await translationProfile(reset, null, await guideCachePrompts())).toBe(legacyProfile);
});
