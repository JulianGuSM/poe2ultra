import { BilingualText, TranslationContext, TranslationText } from '@/ui/translation/BilingualText';
import { Flag, Tag, User } from 'lucide-preact';
import { useContext, useMemo } from 'preact/hooks';
import type { Build } from '@/lib/build/model';
import { richTextSummaryEntry, shortenSummary } from '@/lib/rich-text/summary';
import { Icon } from '@/ui/common/Icon';

/** Build identity and meta; purely informational — page controls live in the tab bar. */
export function BuildHeader({ build }: { build: Build }) {
  const summary = useMemo(() => build.sections.map(section => richTextSummaryEntry(section.content)).find(Boolean), [build]);
  const { locale, texts } = useContext(TranslationContext);
  const translated = locale !== 'en' && summary ? texts.get(summary.source) : undefined;

  return (
    <header class={`build-header${summary ? '' : ' build-header--no-summary'}`}>
      <Icon src={build.headerImageUrl} class="build-header__art" missing="none" />
      <div class="build-header__identity">
        <h1 class="build-header__title">
          <span class="build-header__title-original">{build.title}</span>
          <TranslationText source={build.title} />
        </h1>
        {(build.className || build.ascendancy) && (
          <p class="build-header__hero">
            {build.className && <span><BilingualText text={build.className} /></span>}
            {build.className && build.ascendancy && <span class="build-header__separator">/</span>}
            {build.ascendancy && <span class="build-header__ascendancy"><BilingualText text={build.ascendancy} /></span>}
          </p>
        )}
        <ul class="build-header__meta">
          {build.patch && (
            <li>
              <Tag size={14} aria-hidden="true" />
              <span>{build.patch}</span>
            </li>
          )}
          {build.buildTypes.length > 0 && (
            <li>
              <Flag size={14} aria-hidden="true" />
              <span><BilingualText text={build.buildTypes.join(' · ')} parts={build.buildTypes} /></span>
            </li>
          )}
          {build.author && (
            <li>
              <User size={14} aria-hidden="true" />
              <span>{build.author}</span>
            </li>
          )}
        </ul>
      </div>
      {summary && <p class="build-header__summary">
        <span class="build-header__excerpt">{shortenSummary(summary.text)}</span>
        {translated && <span class="build-header__excerpt translation-text" lang={locale === 'cn' ? 'zh-Hans' : 'zh-Hant'}>{shortenSummary(translated)}</span>}
      </p>}
    </header>
  );
}
