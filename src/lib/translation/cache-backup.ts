import type { CachedTranslation } from './plan';
import type { GuideCostEvent } from './cache';
import { getBuildSlug } from '@/lib/build-url';
import { defaultSettings, normalizeSettings, type Settings, validateSettings } from './settings';
import type { LegacyCachePrompts } from './profile';

export const CACHE_BACKUP_KIND = 'poe2ultra-translation-cache';
export const CACHE_BACKUP_VERSION = 1;
export const CACHE_BACKUP_MAX_BYTES = 50 * 1024 * 1024;
const SETTINGS_KEYS = ['apiMode', 'model', 'thinkingMode', 'glossaryEnabled', 'poe2dbDirectEnabled', 'tavilyEnabled',
  'baseUrl', 'temperature', 'maxTokens', 'reasoningEffort',
  'poe2dbLocales', 'poe2dbMaxTerms', 'poe2dbRequestBudget', 'tavilyMaxResults', 'tavilyDomains', 'customBody', 'customTermAliases'] as const;
type BackupSettings = Pick<Settings, typeof SETTINGS_KEYS[number]>;
type GlossaryOverride = { entries: unknown[]; meta?: object } | null;
export interface CacheBackup {
  kind: typeof CACHE_BACKUP_KIND;
  schemaVersion: typeof CACHE_BACKUP_VERSION;
  exportedAt: string;
  settings: BackupSettings;
  legacyCachePrompts: LegacyCachePrompts;
  glossaryOverride: GlossaryOverride;
  records: [string, CachedTranslation][];
  /** Optional so backups created before cost tracking remain importable. */
  guideCosts?: GuideCostEvent[];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Keys are opaque hashes; matching settings and imported terminology must travel with them. */
export function createCacheBackup(records: [string, CachedTranslation][], settings: Settings,
  legacyCachePrompts: LegacyCachePrompts, glossaryOverride: GlossaryOverride, guideCosts: GuideCostEvent[] = []): CacheBackup {
  const selected = Object.fromEntries(SETTINGS_KEYS.map(key => [key, settings[key]])) as BackupSettings;
  return { kind: CACHE_BACKUP_KIND, schemaVersion: CACHE_BACKUP_VERSION, exportedAt: new Date().toISOString(),
    settings: selected, legacyCachePrompts, glossaryOverride, records, guideCosts };
}

/** Validate the whole file before any IndexedDB or settings writes. */
export function validateCacheBackup(value: unknown): CacheBackup {
  if (!object(value) || value.kind !== CACHE_BACKUP_KIND || value.schemaVersion !== CACHE_BACKUP_VERSION ||
    typeof value.exportedAt !== 'string') throw new Error('不是受支持的 poe2ultra 译文缓存备份。');
  if (!object(value.settings) || !object(value.legacyCachePrompts)) throw new Error('备份缺少匹配缓存所需的翻译参数。');
  for (const key of SETTINGS_KEYS) {
    const item = value.settings[key];
    if (typeof item !== typeof defaultSettings[key] ||
      (typeof item === 'number' && !Number.isFinite(item))) throw new Error(`备份中的 ${key} 配置无效。`);
  }
  const settings = normalizeSettings({ ...defaultSettings, ...value.settings });
  validateSettings(settings);
  const prompts = value.legacyCachePrompts;
  if (typeof prompts.systemPrompt !== 'string' || typeof prompts.userPrompt !== 'string' ||
    prompts.systemPrompt.length > 20000 || prompts.userPrompt.length > 20000) throw new Error('备份的历史提示词配置无效。');
  const glossary = value.glossaryOverride;
  if (glossary !== null && (!object(glossary) || !Array.isArray(glossary.entries) || glossary.entries.length > 100000 ||
    !glossary.entries.every(object) || (glossary.meta !== undefined && !object(glossary.meta)))) throw new Error('备份的术语表无效。');
  if (!Array.isArray(value.records) || value.records.length > 100000) throw new Error('备份的译文条目数量无效。');
  const seen = new Set<string>();
  for (const entry of value.records) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !/^[a-f0-9]{64}$/.test(entry[0]) ||
      seen.has(entry[0]) || !object(entry[1])) throw new Error('备份包含无效或重复的缓存键。');
    seen.add(entry[0]);
    const translation = entry[1];
    if (!['cn', 'tw'].every(locale => Array.isArray(translation[locale]) && translation[locale].length > 0 &&
      translation[locale].every((part: unknown) => typeof part === 'string') && translation[locale].join('').trim())) {
      throw new Error('备份包含不完整的简中或繁中译文。');
    }
    if (translation.widgetLabels !== undefined && (!Array.isArray(translation.widgetLabels) || translation.widgetLabels.length > 200 ||
      !translation.widgetLabels.every((item: unknown) => object(item) && typeof item.index === 'number' && Number.isInteger(item.index) && item.index >= 0 &&
        typeof item.cn === 'string' && !!item.cn.trim() && item.cn.length <= 500 &&
        typeof item.tw === 'string' && !!item.tw.trim() && item.tw.length <= 500))) {
      throw new Error('备份包含无效的富文本实体译名。');
    }
    if (translation.source !== undefined && (typeof translation.source !== 'string' || !translation.source.trim() || translation.source.length > 100000)) {
      throw new Error('备份包含无效的英文原文。');
    }
    const invalidCacheMetadata =
      (translation.sourceHash !== undefined && (typeof translation.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(translation.sourceHash))) ||
      (translation.configHash !== undefined && (typeof translation.configHash !== 'string' || !/^[a-f0-9]{64}$/.test(translation.configHash))) ||
      (translation.translatedAt !== undefined && (typeof translation.translatedAt !== 'string' || !Number.isFinite(Date.parse(translation.translatedAt))));
    if (invalidCacheMetadata) {
      throw new Error('备份包含无效的缓存哈希或译文时间。');
    }
  }
  if (value.guideCosts !== undefined) {
    if (!Array.isArray(value.guideCosts) || value.guideCosts.length > 100000) throw new Error('备份的费用记录数量无效。');
    const ids = new Set<string>();
    for (const event of value.guideCosts) {
      if (!object(event) || typeof event.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(event.id) || ids.has(event.id) ||
        typeof event.guideKey !== 'string' || !getBuildSlug(event.guideKey) || event.guideKey.length > 1000 ||
        (event.cny !== null && (typeof event.cny !== 'number' || !Number.isFinite(event.cny) || event.cny < 0)) ||
        typeof event.at !== 'string' || event.at.length > 50 || !Number.isFinite(Date.parse(event.at))) {
        throw new Error('备份包含无效或重复的费用记录。');
      }
      ids.add(event.id);
    }
  }
  return value as unknown as CacheBackup;
}
