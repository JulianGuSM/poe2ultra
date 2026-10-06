import { browser } from 'wxt/browser';
import { defaultSettings, normalizeSettings, SETTINGS_KEY, validateSettings } from './settings';
import { endpointOrigin } from './vendor/api-base.js';
import type { LegacyCachePrompts } from './profile';

export const GUIDE_CACHE_PROMPTS_KEY = 'poe2ultra.translation.legacy-cache-prompts';
export async function guideCachePrompts(): Promise<LegacyCachePrompts> {
  const saved = await browser.storage.local.get([GUIDE_CACHE_PROMPTS_KEY, SETTINGS_KEY]);
  const pinned = saved[GUIDE_CACHE_PROMPTS_KEY] as LegacyCachePrompts | undefined;
  if (pinned && typeof pinned.systemPrompt === 'string' && typeof pinned.userPrompt === 'string') return pinned;
  const settings = normalizeSettings(saved[SETTINGS_KEY]);
  const baseline = { systemPrompt: settings.systemPrompt, userPrompt: settings.userPrompt };
  await browser.storage.local.set({ [GUIDE_CACHE_PROMPTS_KEY]: baseline });
  return baseline;
}

export async function getSettings() {
  const saved = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(saved[SETTINGS_KEY]);
}
export async function saveSettings(patch: object) {
  const clean = normalizeSettings({ ...await getSettings(), ...patch });
  validateSettings(clean);
  await guideCachePrompts();
  await browser.storage.local.set({ [SETTINGS_KEY]: clean });
  return clean;
}
export async function resetSettings() {
  await guideCachePrompts();
  await browser.storage.local.set({ [SETTINGS_KEY]: defaultSettings });
  return { ...defaultSettings };
}
export async function requireEndpointPermission(baseUrl: string) {
  const origin = endpointOrigin(baseUrl);
  if (!origin || !await browser.permissions.contains({ origins: [origin] })) throw new Error('尚未授权访问该接口，请打开“翻译设置”并点击“保存设置”授权。');
}
