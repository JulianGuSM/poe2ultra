import { digest } from './engine';
import { defaultSettings, type Settings } from './settings';
import { FORMAT_VERSION, GLOSSARY_VERSION } from './protocol';

export type LegacyCachePrompts = Pick<Settings, 'systemPrompt' | 'userPrompt'>;
export async function translationProfile(s: Settings, override?: { entries?: unknown[] } | null, legacyPrompts: LegacyCachePrompts = defaultSettings): Promise<string> {
  const glossary = s.glossaryEnabled && override?.entries?.length ? await digest(JSON.stringify(override.entries)) : GLOSSARY_VERSION;
  // Frozen pre-separation fields are only a cache namespace, never request instructions.
  // This keeps existing paid work while future selection-prompt edits cannot invalidate guide caches.
  const legacy = { version: FORMAT_VERSION, glossary, apiMode: s.apiMode, model: s.model, systemPrompt: legacyPrompts.systemPrompt, userPrompt: legacyPrompts.userPrompt, thinkingMode: s.thinkingMode, glossaryEnabled: s.glossaryEnabled, poe2dbDirectEnabled: s.poe2dbDirectEnabled, tavilyEnabled: s.tavilyEnabled };
  const advanced: Partial<Settings> = {};
  const keys = ['baseUrl', 'temperature', 'maxTokens', 'reasoningEffort', 'glossaryMaxTerms', 'glossaryCategories', 'glossaryStrict', 'poe2dbLocales', 'poe2dbMaxTerms', 'poe2dbRequestBudget', 'tavilyMaxResults', 'tavilyDomains', 'customBody'] as const;
  for (const key of keys) if (s[key] !== defaultSettings[key]) Object.assign(advanced, { [key]: s[key] });
  return digest(JSON.stringify({ ...legacy, ...(Object.keys(advanced).length ? { advanced } : {}) }));
}
