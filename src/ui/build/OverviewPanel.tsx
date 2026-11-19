import { BilingualText, useDisplayLocale } from '@/ui/translation/BilingualText';
import { PanelLeftOpen } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import type { Build } from '@/lib/build/model';
import { RichText } from '@/ui/rich-text/RichText';
import { entityChipRenderer } from '@/ui/tooltip/EntityTooltipChip';
import { uiText, uiTextIfKnown } from '@/lib/ui/i18n';

/** Guide text sections, shown as collapsible panels. */
export function OverviewPanel({ build }: {
  build: Build;
  /** Legacy props are accepted for callers compiled against older component versions. */
  glanceCollapsed?: boolean;
  onGlanceCollapsedChange?: (collapsed: boolean) => void;
}) {
  const renderEntity = useMemo(() => entityChipRenderer(build.entities), [build.entities]);
  const renderTranslatedEntity = useMemo(() => entityChipRenderer(build.entities, true), [build.entities]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const primarySection = build.sections.find((section) => section.title.trim().toLowerCase() === 'build overview') ?? build.sections[0] ?? null;
  const sideSections = primarySection ? build.sections.filter((section) => section.id !== primarySection.id) : [];
  const hasStrengthsWeaknesses = !!(build.strengths || build.weaknesses);
  const splitLayout = !!primarySection && (hasStrengthsWeaknesses || sideSections.length > 0);
  const toggleSection = (id: string) => setCollapsedSections((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const renderSection = (section: Build['sections'][number]) => (
    <GuideSection
      key={section.id}
      section={section}
      renderEntity={renderEntity}
      renderTranslatedEntity={renderTranslatedEntity}
      collapsed={collapsedSections.has(section.id)}
      onToggle={() => toggleSection(section.id)}
    />
  );

  return (
    <div class="overview">
      <div class={`overview__texts${splitLayout ? ' overview__texts--split' : ''}`}>
        {splitLayout ? (
          <>
            <div class="overview__primary">
              {primarySection && renderSection(primarySection)}
            </div>
            <aside class="overview__side" aria-label="Other build details">
              {hasStrengthsWeaknesses && (
                <StrengthsWeaknesses
                  strengths={build.strengths}
                  weaknesses={build.weaknesses}
                  renderEntity={renderEntity}
                  renderTranslatedEntity={renderTranslatedEntity}
                  collapsed={collapsedSections.has('strengths-weaknesses')}
                  onToggle={() => toggleSection('strengths-weaknesses')}
                />
              )}
              {sideSections.map(renderSection)}
            </aside>
          </>
        ) : (
          <div class="overview__primary">
            {build.sections.length === 0 && !hasStrengthsWeaknesses && <p class="panel-empty">The author hasn't added a build description.</p>}
            {hasStrengthsWeaknesses && (
              <StrengthsWeaknesses
                strengths={build.strengths}
                weaknesses={build.weaknesses}
                renderEntity={renderEntity}
                renderTranslatedEntity={renderTranslatedEntity}
                collapsed={collapsedSections.has('strengths-weaknesses')}
                onToggle={() => toggleSection('strengths-weaknesses')}
              />
            )}
            {build.sections.map(renderSection)}
          </div>
        )}
      </div>
    </div>
  );
}

function GuideSection({ section, renderEntity, renderTranslatedEntity, collapsed, onToggle }: {
  section: Build['sections'][number];
  renderEntity: ReturnType<typeof entityChipRenderer>;
  renderTranslatedEntity: ReturnType<typeof entityChipRenderer>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const contentId = `overview-section-${section.id.replace(/[^\w-]/g, '-')}`;
  const locale = useDisplayLocale();
  const localizedTitle = uiTextIfKnown(section.title, locale);
  return (
    <section class={`card overview__section${collapsed ? ' overview__section--collapsed' : ''}`}>
      <h2 class="card__title overview__section-title">
        <button type="button" class="overview__accordion-trigger" aria-expanded={!collapsed} aria-controls={contentId} onClick={onToggle}>
          <PanelLeftOpen class="overview__accordion-icon" size={20} aria-hidden="true" />
          <span class="overview__accordion-label">{localizedTitle ?? <BilingualText text={section.title} inline />}</span>
        </button>
      </h2>
      {!collapsed && (
        <div id={contentId} class="overview__section-content">
          <RichText value={section.content} renderEntity={renderEntity} renderTranslatedEntity={renderTranslatedEntity} />
        </div>
      )}
    </section>
  );
}

function StrengthsWeaknesses({ strengths, weaknesses, renderEntity, renderTranslatedEntity, collapsed, onToggle }: {
  strengths: Build['strengths'];
  weaknesses: Build['weaknesses'];
  renderEntity: ReturnType<typeof entityChipRenderer>;
  renderTranslatedEntity: ReturnType<typeof entityChipRenderer>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const contentId = 'overview-section-strengths-weaknesses';
  const locale = useDisplayLocale();
  return (
    <section class={`card overview__section overview__strengths-weaknesses${collapsed ? ' overview__section--collapsed' : ''}`}>
      <h2 class="card__title overview__section-title">
        <button
          type="button"
          class="overview__accordion-trigger"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <PanelLeftOpen class="overview__accordion-icon" size={20} aria-hidden="true" />
          <span class="overview__accordion-label">{uiText('Strengths and Weaknesses', locale)}</span>
        </button>
      </h2>
      {!collapsed && (
        <div id={contentId} class="overview__section-content">
          {strengths && (
            <div class="overview__strengths">
              <h3>{uiText('Strengths', locale)}</h3>
              <RichText value={strengths} renderEntity={renderEntity} renderTranslatedEntity={renderTranslatedEntity} />
            </div>
          )}
          {weaknesses && (
            <div class="overview__weaknesses">
              <h3>{uiText('Weaknesses', locale)}</h3>
              <RichText value={weaknesses} renderEntity={renderEntity} renderTranslatedEntity={renderTranslatedEntity} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
