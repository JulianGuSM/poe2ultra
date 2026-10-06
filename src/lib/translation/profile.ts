import { digest } from './engine';
import { defaultSettings, type Settings } from './settings';
import { FORMAT_VERSION, GLOSSARY_VERSION } from './protocol';

export async function translationProfile(s: Settings, override?: { entries?: unknown[] } | null): Promise<string> {
  const glossary = s.glossaryEnabled && override?.entries?.length ? await digest(JSON.stringify(override.entries)) : GLOSSARY_VERSION;
  // Field order matches the 1.3.2 JSON exactly; default fields must not invalidate paid work.
  const legacy = { version: FORMAT_VERSION, glossary, apiMode: s.apiMode, model: s.model, systemPrompt: s.systemPrompt, userPrompt: s.userPrompt, thinkingMode: s.thinkingMode, glossaryEnabled: s.glossaryEnabled, poe2dbDirectEnabled: s.poe2dbDirectEnabled, tavilyEnabled: s.tavilyEnabled };
  const advanced: Partial<Settings> = {};
  const keys = ['baseUrl', 'temperature', 'maxTokens', 'reasoningEffort', 'glossaryMaxTerms', 'glossaryCategories', 'glossaryStrict', 'poe2dbLocales', 'poe2dbMaxTerms', 'poe2dbRequestBudget', 'tavilyMaxResults', 'tavilyDomains', 'customBody'] as const;
  for (const key of keys) if (s[key] !== defaultSettings[key]) Object.assign(advanced, { [key]: s[key] });
  return digest(JSON.stringify({ ...legacy, ...(Object.keys(advanced).length ? { advanced } : {}) }));
}
