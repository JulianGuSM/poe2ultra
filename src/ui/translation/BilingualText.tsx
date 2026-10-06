import { createContext, type ComponentChildren } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import type { Locale, Records, Segment } from '@/lib/translation/plan';

interface DisplayTranslations { locale: Locale; texts: Map<string, string> }
export const TranslationContext = createContext<DisplayTranslations>({ locale: 'en', texts: new Map() });

export function TranslationProvider({ records, locale, children }: { records: Records; locale: Locale; children: ComponentChildren }) {
  const value = useMemo(() => {
    const texts = new Map<string, string>();
    if (locale !== 'en') for (const [key, record] of Object.entries(records)) {
      const source = JSON.parse(key) as Segment;
      const translated = record[locale]?.join('');
      if (translated?.trim()) texts.set(source.texts.join(''), translated);
    }
    return { locale, texts };
  }, [records, locale]);
  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

/** Plain translated text only: never replace source markup, create links or interpret model HTML. */
export function TranslationText({ source, parts, separator = ' · ' }: { source: string; parts?: string[]; separator?: string }) {
  const { locale, texts } = useContext(TranslationContext);
  const translated = texts.get(source) ?? (parts?.some(part => texts.has(part)) ? parts.map(part => texts.get(part) ?? part).join(separator) : undefined);
  if (locale === 'en' || !translated) return null;
  return <span class="translation-text" lang={locale === 'cn' ? 'zh-Hans' : 'zh-Hant'}>{translated}</span>;
}

export function BilingualText({ text, parts, separator }: { text: string; parts?: string[]; separator?: string }) {
  const { locale, texts } = useContext(TranslationContext);
  if (locale === 'en' || (!texts.has(text) && !parts?.some(part => texts.has(part)))) return <>{text}</>;
  return <span class="bilingual-text">{text}<TranslationText source={text} parts={parts} separator={separator} /></span>;
}
