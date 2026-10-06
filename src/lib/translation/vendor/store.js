/**
 * 配置读写。除 apiKey（只存本地，不同步到 Google 账号）外，其余配置走 storage.sync。
 */
import { DEFAULTS, LOCAL_ONLY_KEYS, SETTING_KEYS } from './defaults.js';

function pickDefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** 读取完整配置（含默认值兜底）。 */
export async function getSettings() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(SETTING_KEYS),
    chrome.storage.local.get(LOCAL_ONLY_KEYS),
  ]);
  return { ...DEFAULTS, ...pickDefined(syncData), ...pickDefined(localData) };
}

/** 只写传入的字段，其余保持不变。 */
export async function saveSettings(patch) {
  const clean = pickDefined(patch);
  const syncPatch = {};
  const localPatch = {};

  for (const [k, v] of Object.entries(clean)) {
    if (!(k in DEFAULTS)) continue; // 丢弃未知字段
    if (LOCAL_ONLY_KEYS.includes(k)) localPatch[k] = v;
    else syncPatch[k] = v;
  }

  try {
    if (Object.keys(syncPatch).length) await chrome.storage.sync.set(syncPatch);
    if (Object.keys(localPatch).length) await chrome.storage.local.set(localPatch);
  } catch (err) {
    throw new Error(`保存失败：${err?.message || err}`);
  }
  return getSettings();
}

export async function resetSettings() {
  await Promise.all([
    chrome.storage.sync.remove(SETTING_KEYS),
    chrome.storage.local.remove(LOCAL_ONLY_KEYS),
  ]);
  return getSettings();
}

/** 配置变化订阅，返回取消订阅函数。 */
export function onSettingsChanged(callback) {
  const listener = (changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    const touched = Object.keys(changes).filter((k) => k in DEFAULTS);
    if (touched.length) callback(touched);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** sk-abcdef...wxyz，用于界面展示。 */
export function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 12) return `${k.slice(0, 3)}****`;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}
