/**
 * chrome.storage.local 上的小型缓存，Tavily 检索结果与 poe2db 直查页面共用。
 * 纯函数部分（键、读写裁剪）可在 Node 里直接测。
 */
export const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 200;

/** 稳定且足够短的缓存键（FNV-1a）。数组按逗号拼接，方便直接传域名/语言列表。 */
export function cacheKeyOf(...parts) {
  const input = parts
    .map((p) => (Array.isArray(p) ? p.join(',') : String(p ?? '')))
    .join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `q${hash.toString(16)}`;
}

export function pickCacheEntry(cache, key, now = Date.now(), ttl = CACHE_TTL_MS) {
  const hit = cache?.[key];
  if (!hit) return null;
  if (now - (hit.at || 0) > ttl) return null;
  if (hit.value === undefined) return null;
  return hit.value;
}

/** 写入缓存并裁剪到上限（丢弃最旧的）。 */
export function putCacheEntry(cache, key, value, now = Date.now(), max = CACHE_MAX_ENTRIES) {
  const next = { ...(cache || {}) };
  next[key] = { at: now, value };
  const keys = Object.keys(next);
  if (keys.length > max) {
    keys
      .sort((a, b) => (next[a].at || 0) - (next[b].at || 0))
      .slice(0, keys.length - max)
      .forEach((k) => delete next[k]);
  }
  return next;
}

export async function readCached(storageKey, key) {
  try {
    const data = await chrome.storage.local.get([storageKey]);
    return pickCacheEntry(data?.[storageKey], key);
  } catch {
    return null;
  }
}

export async function writeCached(storageKey, key, value) {
  try {
    const data = await chrome.storage.local.get([storageKey]);
    const next = putCacheEntry(data?.[storageKey], key, value);
    await chrome.storage.local.set({ [storageKey]: next });
  } catch {
    /* 缓存失败不影响本次结果 */
  }
}

export async function clearCache(storageKey) {
  try {
    await chrome.storage.local.remove(storageKey);
    return true;
  } catch {
    return false;
  }
}

export async function cacheSize(storageKey) {
  try {
    const data = await chrome.storage.local.get([storageKey]);
    return Object.keys(data?.[storageKey] || {}).length;
  } catch {
    return 0;
  }
}
