import { createContext, type ComponentChildren } from 'preact';
import { useContext, useLayoutEffect, useMemo } from 'preact/hooks';
import { RefreshCw } from 'lucide-preact';
import type { Locale, Records, Segment } from '@/lib/translation/plan';

interface DisplayTranslations {
  locale: Locale;
  texts: Map<string, string>;
  entityTranslations?: Map<string, string>;
  widgetTranslations?: Map<string, Map<number, string>>;
  keys?: Map<string, string>;
  busy?: boolean;
  onRetranslate?: (keys: string[]) => void;
  retryingKeys?: string[];
  retranslateMode?: boolean;
}
export const TranslationContext = createContext<DisplayTranslations>({ locale: 'en', texts: new Map(), keys: new Map(), busy: false, retranslateMode: false });

export const useDisplayLocale = () => useContext(TranslationContext).locale;

export function TranslationProvider({ records, segments = [], locale, busy = false, onRetranslate, retryingKeys, retranslateMode = false, children }: {
  records: Records; segments?: Segment[]; locale: Locale; busy?: boolean; onRetranslate?: (keys: string[]) => void; retryingKeys?: string[]; retranslateMode?: boolean; children: ComponentChildren;
}) {
  const value = useMemo(() => {
    const texts = new Map<string, string>();
    const entityTranslations = new Map<string, string>();
    const widgetTranslations = new Map<string, Map<number, string>>();
    const keys = new Map<string, string>();
    for (const segment of segments) keys.set(segment.texts.join(''), JSON.stringify(segment));
    if (locale !== 'en') for (const [key, record] of Object.entries(records)) {
      const source = JSON.parse(key) as Segment;
      const translated = record[locale]?.join('');
      if (translated?.trim()) {
        const text = source.texts.join('');
        texts.set(text, translated);
        // Standalone term records are a fallback for older entity blocks without label metadata.
        if (source.kind === 'term' && source.texts.length === 1) entityTranslations.set(source.texts[0]!, translated);
        if (source.widgetEntities?.length && record.widgetLabels?.length) {
          const labels = new Map<number, string>();
          for (const item of record.widgetLabels) {
            const label = locale === 'cn' ? item.cn : item.tw;
            if (label?.trim()) labels.set(item.index, label);
          }
          if (labels.size) widgetTranslations.set(text, labels);
        }
      }
    }
    return { locale, texts, entityTranslations, widgetTranslations, keys, busy, onRetranslate, retryingKeys, retranslateMode };
  }, [records, segments, locale, busy, onRetranslate, retryingKeys, retranslateMode]);

  useLayoutEffect(() => {
    if (!retranslateMode) return;
    const controls = document.querySelector('.build-view')?.querySelectorAll<HTMLElement>('.translation-retranslate');
    controls?.forEach((control, index) => control.style.setProperty('--retranslate-delay', `${Math.min(index, 24) * 40}ms`));
  }, [retranslateMode]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

/** Plain translated text only: never replace source markup, create links or interpret model HTML. */
export function TranslationText({ source, parts, separator = ' · ' }: { source: string; parts?: string[]; separator?: string }) {
  const { locale, texts, keys = new Map(), busy = false, onRetranslate, retryingKeys = [], retranslateMode = false } = useContext(TranslationContext);
  const translated = texts.get(source) ?? (parts?.some(part => texts.has(part)) ? parts.map(part => texts.get(part) ?? part).join(separator) : undefined);
  const targetKeys = keys.has(source) ? [keys.get(source)!] : [...new Set((parts ?? []).map(part => keys.get(part)).filter((key): key is string => !!key))];
  const showAction = retranslateMode && targetKeys.length > 0 && !!onRetranslate;
  const isRetrying = targetKeys.some(key => retryingKeys.includes(key));
  if ((locale === 'en' || !translated) && !showAction) return null;
  if (!showAction) return <span class="translation-text" lang={locale === 'cn' ? 'zh-Hans' : 'zh-Hant'}>{translated}</span>;
  return <span class={`translation-text-row${translated && locale !== 'en' ? '' : ' translation-text-row--action-only'}${retranslateMode && translated ? ' translation-text-row--retranslation-mode' : ''}`}>
    <RetranslateControl segmentKeys={targetKeys} />
    {translated && locale !== 'en' && <span class="translation-text" lang={locale === 'cn' ? 'zh-Hans' : 'zh-Hant'}>{translated}</span>}
  </span>;
}

export function RetranslateControl({ source, parts, segmentKeys }: { source?: string; parts?: string[]; segmentKeys?: string[] }) {
  const { keys = new Map(), busy = false, onRetranslate, retryingKeys = [], retranslateMode = false } = useContext(TranslationContext);
  const targetKeys = segmentKeys ?? (source && keys.has(source) ? [keys.get(source)!] : [...new Set((parts ?? []).map(part => keys.get(part)).filter((key): key is string => !!key))]);
  if (!retranslateMode || !targetKeys.length || !onRetranslate) return null;
  const isRetrying = targetKeys.some(key => retryingKeys.includes(key));
  return <span class="translation-retranslate" role="button" tabIndex={busy ? -1 : 0}
    aria-label={isRetrying ? '正在重译此文字块' : '重新翻译此文字块'} aria-disabled={busy} aria-busy={isRetrying} title="重新翻译此文字块，可能会调用模型 API"
    onClick={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onRetranslate(targetKeys); }}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation(); if (!busy) onRetranslate(targetKeys);
      }
    }}><RefreshCw size={12} aria-hidden="true" /></span>;
}

export function BilingualText({ text, parts, separator, inline = false }: { text: string; parts?: string[]; separator?: string; inline?: boolean }) {
  const { locale, texts } = useContext(TranslationContext);
  if (locale === 'en' || (!texts.has(text) && !parts?.some(part => texts.has(part)))) return <>{text}</>;
  return <span class={`bilingual-text${inline ? ' bilingual-text--inline' : ''}`}>{text}<TranslationText source={text} parts={parts} separator={separator} /></span>;
}
