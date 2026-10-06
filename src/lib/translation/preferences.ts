import { browser } from 'wxt/browser';
import { defaultSettings, normalizeSettings, SETTINGS_KEY, validateSettings } from './settings';
import { endpointOrigin } from './vendor/api-base.js';

export async function getSettings() {
  const saved = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(saved[SETTINGS_KEY]);
}
export async function saveSettings(patch: object) {
  const clean = normalizeSettings({ ...await getSettings(), ...patch });
  validateSettings(clean);
  await browser.storage.local.set({ [SETTINGS_KEY]: clean });
  return clean;
}
export async function resetSettings() {
  await browser.storage.local.set({ [SETTINGS_KEY]: defaultSettings });
  return { ...defaultSettings };
}
export async function requireEndpointPermission(baseUrl: string) {
  const origin = endpointOrigin(baseUrl);
  if (!origin || !await browser.permissions.contains({ origins: [origin] })) throw new Error('尚未授权访问该接口，请打开“翻译设置”并点击“保存设置”授权。');
}
