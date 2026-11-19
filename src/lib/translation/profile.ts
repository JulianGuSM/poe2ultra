import { digest } from './engine';
import { defaultSettings, type Settings } from './settings';
import { FORMAT_VERSION, GLOSSARY_VERSION } from './protocol';

export type LegacyCachePrompts = Pick<Settings, 'systemPrompt' | 'userPrompt'>;
const LEGACY_BUNDLED_GLOSSARY_VERSIONS = ['2245-884e31a5'] as const;
const advancedKeys = ['baseUrl', 'temperature', 'maxTokens', 'reasoningEffort', 'poe2dbLocales', 'poe2dbMaxTerms', 'poe2dbRequestBudget', 'tavilyMaxResults', 'tavilyDomains', 'customBody'] as const;

async function profileForGlossary(s: Settings, glossaryVersion: string, legacyPrompts: LegacyCachePrompts, includeCustomAliases: boolean): Promise<string> {
  const glossary = glossaryVersion;
  // Frozen pre-separation fields are only a cache namespace, never request instructions.
  // This keeps existing paid work while future selection-prompt edits cannot invalidate guide caches.
  const legacy = { version: FORMAT_VERSION, glossary, apiMode: s.apiMode, model: s.model, systemPrompt: legacyPrompts.systemPrompt, userPrompt: legacyPrompts.userPrompt, thinkingMode: s.thinkingMode, glossaryEnabled: s.glossaryEnabled, poe2dbDirectEnabled: s.poe2dbDirectEnabled, tavilyEnabled: s.tavilyEnabled };
  const advanced: Partial<Settings> = {};
  const keys = includeCustomAliases ? [...advancedKeys, 'customTermAliases' as const] : advancedKeys;
  for (const key of keys) if (s[key] !== defaultSettings[key]) Object.assign(advanced, { [key]: s[key] });
  return digest(JSON.stringify({ ...legacy, ...(Object.keys(advanced).length ? { advanced } : {}) }));
}

export async function translationProfile(s: Settings, override?: { entries?: unknown[] } | null, legacyPrompts: LegacyCachePrompts = defaultSettings): Promise<string> {
  const glossary = s.glossaryEnabled && override?.entries?.length ? await digest(JSON.stringify(override.entries)) : GLOSSARY_VERSION;
  return profileForGlossary(s, glossary, legacyPrompts, true);
}

/** Cache namespaces written before the bundled terminology update. */
export async function legacyTranslationProfiles(s: Settings, override?: { entries?: unknown[] } | null, legacyPrompts: LegacyCachePrompts = defaultSettings): Promise<string[]> {
  if (s.glossaryEnabled && override?.entries?.length) return [];
  if (s.customTermAliases !== defaultSettings.customTermAliases) return [];
  return Promise.all(LEGACY_BUNDLED_GLOSSARY_VERSIONS.map(version => profileForGlossary(s, version, legacyPrompts, false)));
}
