// Options use the trusted worker API; web-page content scripts receive UI preferences only.
async function request(type, patch) {
  const response = await chrome.runtime.sendMessage({ type, patch });
  if (!response?.ok) throw new Error(response?.error || '扩展后台没有响应，请重新加载扩展。');
  return response.data;
}
export const getSettings = () => request('get-settings');
export const saveSettings = patch => request('save-settings', patch);
export const resetSettings = () => request('reset-settings');
export { maskKey } from '../../lib/translation/vendor/store.js';
