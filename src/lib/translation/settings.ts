import { DEFAULTS } from './vendor/defaults.js';
import { buildEndpoint, parseJsonObject } from './vendor/api-base.js';
import { DEFAULT_CHINA_LEAGUE } from '@/lib/trade/china';
import { parseSiteMatchPatterns } from '@/lib/selection/site-patterns';

export const SETTINGS_KEY = 'poe2ultra.translation.settings';
export type Settings = Omit<typeof DEFAULTS, 'apiMode' | 'thinkingMode' | 'reasoningEffort' | 'theme' | 'costModel'> & {
  apiMode: 'responses' | 'chat';
  thinkingMode: 'default' | 'disabled' | 'enabled';
  reasoningEffort: 'low' | 'high' | 'max';
  theme: 'auto' | 'light' | 'dark';
  costModel: 'auto' | 'deepseek-flash' | 'deepseek-v4-pro' | 'custom';
  debugEnabled: boolean;
  chinaTradeLeague: string;
  customTermAliases: string;
  selectionMatchPatterns: string;
  advancedSettingsEnabled: boolean;
};
// Preserve the effective guide defaults from 1.3.2 while adding all original selection options.
export const defaultSettings: Settings = { ...DEFAULTS, apiMode: 'responses', thinkingMode: 'disabled', reasoningEffort: 'high', theme: 'auto', costModel: 'auto',
  maxTokens: 16384, timeoutMs: 120000, tavilyEnabled: false, showContext: false, debugEnabled: false, chinaTradeLeague: DEFAULT_CHINA_LEAGUE, customTermAliases: '[]', selectionMatchPatterns: '', advancedSettingsEnabled: false };

const advancedSettingKeys = ['poe2dbDirectEnabled', 'poe2dbLocales', 'poe2dbMaxTerms', 'poe2dbRequestBudget', 'tavilyEnabled', 'tavilyMaxResults', 'tavilyDomains', 'tavilyApiKey', 'customTermAliases', 'debugEnabled', 'chinaTradeLeague'] as const;
export function effectiveSettings(settings: Settings): Settings {
  const normalized = { ...settings, glossaryEnabled: true };
  if (settings.advancedSettingsEnabled) return normalized;
  const effective = { ...normalized, poe2dbDirectEnabled: false, tavilyEnabled: false };
  for (const key of advancedSettingKeys) effective[key] = defaultSettings[key] as never;
  return effective;
}

export function normalizeSettings(value: unknown): Settings {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(defaultSettings).map(([key, fallback]) => [key, saved[key] ?? fallback])) as Settings;
}
export function validateSettings(value: unknown): asserts value is Settings {
  if (!value || typeof value !== 'object') throw new Error('设置格式无效。');
  const s = value as Settings;
  for (const [key, fallback] of Object.entries(defaultSettings)) {
    const v = s[key as keyof Settings];
    if (typeof v !== typeof fallback || (typeof v === 'number' && !Number.isFinite(v)) || (typeof v === 'string' && v.length > 20000)) throw new Error(`配置项 ${key} 的格式无效。`);
  }
  const enums = { apiMode: ['responses', 'chat'], thinkingMode: ['default', 'disabled', 'enabled'], reasoningEffort: ['low', 'high', 'max'], theme: ['auto', 'light', 'dark'], costModel: ['auto', 'deepseek-flash', 'deepseek-v4-pro', 'custom'] };
  for (const [key, allowed] of Object.entries(enums)) if (!allowed.includes(String(s[key as keyof Settings]))) throw new Error(`配置项 ${key} 的选项无效。`);
  let aliases: unknown;
  try { aliases = JSON.parse(s.customTermAliases); } catch { throw new Error('自定义术语别名必须是合法 JSON。'); }
  if (!Array.isArray(aliases) || aliases.length > 1000 || aliases.some(item => !item || typeof item !== 'object' ||
    typeof item.alias !== 'string' || !item.alias.trim() || item.alias.length > 200 ||
    typeof item.canonical !== 'string' || !item.canonical.trim() || item.canonical.length > 200 ||
    (item.cn !== undefined && (typeof item.cn !== 'string' || item.cn.length > 200)) ||
    (item.tw !== undefined && (typeof item.tw !== 'string' || item.tw.length > 200)))) {
    throw new Error('自定义术语映射格式无效：每项需要 alias 和 canonical；cn、tw 如填写须为短文本，最多 1000 项。');
  }
  // Imported backups and direct storage writes must follow the same URL rules as the options form.
  parseSiteMatchPatterns(s.selectionMatchPatterns);
  if (!s.model.trim()) throw new Error('请填写模型名称。');
  if (!s.chinaTradeLeague.trim() || s.chinaTradeLeague.length > 120) throw new Error('请填写有效的国服市集赛季（最多 120 个字符）。');
  buildEndpoint(s.baseUrl, s.apiMode);
  if (new URL(s.baseUrl).username || new URL(s.baseUrl).password) throw new Error('接口地址不能包含用户名或密码，请使用 API Key 或额外请求头。');
  for (const key of ['extraHeaders', 'customBody'] as const) parseJsonObject(s[key], key === 'extraHeaders' ? '额外请求头' : '额外请求体');
  const limits: Partial<Record<keyof Settings, [number, number]>> = {
    temperature: [0, 2], maxTokens: [64, 384000], timeoutMs: [5000, 600000], panelWidth: [280, 900], maxChars: [500, 100000],
    poe2dbMaxTerms: [1, 10], poe2dbRequestBudget: [1, 20], tavilyMaxResults: [1, 10],
    priceCacheHit: [0, 1e6], priceCacheMiss: [0, 1e6], priceOutput: [0, 1e6],
  };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const n = Number(s[key as keyof Settings]);
    if (n < min || n > max) throw new Error(`配置项 ${key} 应在 ${min}～${max} 之间。`);
  }
}
export function selectionSettings(s: Settings) {
  return Object.fromEntries(['autoTranslate', 'showButton', 'keepSource', 'autoClosePanel', 'theme', 'panelWidth', 'maxChars', 'targetLang', 'dualOutput'].map(key => [key, s[key as keyof Settings]]));
}
