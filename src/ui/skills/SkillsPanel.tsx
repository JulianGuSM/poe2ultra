import { BilingualText, useDisplayLocale } from '@/ui/translation/BilingualText';
import { uiRequirements, uiText } from '@/lib/ui/i18n';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { Attributes, EntityInfo, Gem, GemPriorityEntry, Skill, Variant } from '@/lib/build/model';
import { gemAttribute, gemTooltip } from '@/lib/tooltip/tooltip-model';
import { copyText } from '@/lib/ui/clipboard';
import { Icon } from '@/ui/common/Icon';
import { RichText } from '@/ui/rich-text/RichText';
import { entityChipRenderer } from '@/ui/tooltip/EntityTooltipChip';
import { WithTooltip } from '@/ui/tooltip/Tooltip';
import { useToast } from '@/ui/common/Toast';

const EMPTY = "The author hasn't listed skills for this variant.";

/** Active skills of a variant with their supports, and details of the selected skill. */
export function SkillsPanel({
  variant,
  entities,
  copy = copyText,
}: {
  variant: Variant;
  entities: Record<string, EntityInfo>;
  /** Injected in tests; a gem name goes to the clipboard, ready for the game's own search. */
  copy?: (text: string) => Promise<boolean>;
}) {
  const locale = useDisplayLocale();
  const renderEntity = useMemo(() => entityChipRenderer(entities), [entities]);
  const renderTranslatedEntity = useMemo(() => entityChipRenderer(entities, true), [entities]);
  const { copyName } = useCopyName(copy);
  const [selected, setSelected] = useState(0);
  const [priorityCollapsed, setPriorityCollapsed] = useState(true);
  // Which gem the gem priority points at, so Active Skills can mark it.
  const [pointedAt, setPointedAt] = useState<GemPointer | null>(null);
  const skill = variant.skills[selected] ?? variant.skills[0];

  if (!skill && !variant.skillNotes) {
    return <p class="panel-empty">{EMPTY}</p>;
  }

  return (
    <div class="skills">
      {skill ? (
        <div class="skills__columns">
          {variant.gemPriority.length > 0 && (
            <GemPriorityCard
              entries={variant.gemPriority}
              skills={variant.skills}
              currentSkillSlug={skill.gem.slug}
              onPointAt={setPointedAt}
              onCopy={copyName}
              collapsed={priorityCollapsed}
              onToggle={() => setPriorityCollapsed((value) => !value)}
            />
          )}
          <div class="skills__main">
            <section class="card skills__list">
              <div class="skills__heading">
                <h2 class="card__title">{uiText('Active Skills', locale)}</h2>
                {variant.gemRequirements && <span class="skills__requirements">{formatAttributes(variant.gemRequirements, locale)}</span>}
              </div>
              <ul class="skill-rows" aria-label="Active skills">
                {variant.skills.map((entry, i) => (
                  <SkillRow
                    key={`${entry.gem.slug}-${i}`}
                    skill={entry}
                    selected={entry === skill}
                    onSelect={() => setSelected(i)}
                    onCopy={copyName}
                    pointedAt={pointedAt}
                  />
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : (
        <p class="panel-empty">{EMPTY}</p>
      )}
      {variant.skillNotes && (
        <section class="card skills__notes">
          <h2 class="card__title">{uiText("Author's Notes", locale)}</h2>
          <RichText value={variant.skillNotes} renderEntity={renderEntity} renderTranslatedEntity={renderTranslatedEntity} />
        </section>
      )}
    </div>
  );
}

/** Copies a gem name and says so for a moment, so the click has a visible answer. */
function useCopyName(copy: (text: string) => Promise<boolean>) {
  const toast = useToast();

  const copyName = async (name: string) => {
    const copied = await copy(name);
    toast.notify(copied ? `Copied \u201c${name}\u201d` : "Couldn't copy the name", copied ? 'success' : 'error');
  };

  return { copyName };
}

const copyLabel = (name: string) => `Copy \u201c${name}\u201d`;

/** A gem the gem priority points at: a support inside its skill, or an active skill on its own. */
export interface GemPointer {
  gemSlug: string;
  parentSlug: string | null;
}

function SkillRow({
  skill,
  selected,
  onSelect,
  onCopy,
  pointedAt,
}: {
  skill: Skill;
  selected: boolean;
  onSelect: () => void;
  onCopy: (name: string) => void;
  pointedAt: GemPointer | null;
}) {
  const { gem, supports } = skill;
  const matchesSkill = pointedAt !== null && pointedAt.parentSlug === null && pointedAt.gemSlug === gem.slug;
  const matchesSupport = (support: Gem) => pointedAt !== null && pointedAt.parentSlug === gem.slug && pointedAt.gemSlug === support.slug;
  return (
    <li class={`skill-row${selected ? ' skill-row--selected' : ''}${matchesSkill ? ' skill-row--match' : ''}`}>
      <WithTooltip model={gemTooltip(gem)} openOnChildClick>
        <button
          type="button"
          class="skill-row__main"
          aria-pressed={selected}
          title="Show skill details and copy the gem name"
          onClick={() => {
            onSelect();
            void onCopy(gem.name);
          }}
        >
          <GemIcon gem={gem} class="skill-row__icon" />
          <span class="skill-row__text">
            <span class="skill-row__name"><BilingualText text={gem.name} inline /></span>
          </span>
        </button>
      </WithTooltip>
      {supports.length > 0 && (
        <span class="skill-row__supports">
          {supports.map((support, i) => (
            <WithTooltip key={`${support.slug}-${i}`} model={gemTooltip(support)} openOnChildClick>
              <button type="button" class="gem-copy" aria-label={copyLabel(support.name)} onClick={() => onCopy(support.name)}>
                <GemIcon
                  gem={support}
                  class={`skill-row__support gem-socket gem-socket--${gemAttribute(support) ?? 'none'}${matchesSupport(support) ? ' skill-row__support--match' : ''}`}
                />
              </button>
            </WithTooltip>
          ))}
        </span>
      )}
    </li>
  );
}

function GemPriorityCard({
  entries,
  skills,
  currentSkillSlug,
  onPointAt,
  onCopy,
  collapsed,
  onToggle,
}: {
  entries: GemPriorityEntry[];
  skills: Skill[];
  currentSkillSlug: string;
  onPointAt: (pointer: GemPointer | null) => void;
  onCopy: (name: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const locale = useDisplayLocale();
  const title = uiText('Gem Priority', locale);
  if (collapsed) {
    return (
      <section class="card glance glance--collapsed gem-priority gem-priority--collapsed" aria-label={title}>
        <button type="button" class="glance__rail" aria-label={`Expand ${title}`} title={`Expand ${title}`} aria-expanded="false" onClick={onToggle}>
          <PanelLeftOpen size={16} aria-hidden="true" />
          <span class="glance__rail-title" aria-hidden="true">{title}</span>
        </button>
      </section>
    );
  }
  return (
    <section class="card gem-priority">
      <div class="glance__header">
        <h2 class="card__title">{title}</h2>
        <button type="button" class="icon-button glance__toggle" aria-label={`Collapse ${title}`} title={`Collapse ${title}`} aria-expanded="true" onClick={onToggle}>
          <PanelLeftClose size={16} aria-hidden="true" />
        </button>
      </div>
      <ol class="gem-priority__list" aria-label="Gem priority">
        {entries.map((entry, i) => {
          const parentGem = entry.parentSlug
            ? skills.find((skill) => skill.gem.slug === entry.parentSlug)?.gem
            : undefined;
          return (
          <li
            key={`${entry.gem.slug}-${i}`}
            class={entry.parentSlug === currentSkillSlug ? 'gem-priority__row gem-priority__row--current' : 'gem-priority__row'}
            onPointerEnter={() => onPointAt({ gemSlug: entry.gem.slug, parentSlug: entry.parentSlug })}
            onPointerLeave={() => onPointAt(null)}
            onFocusIn={() => onPointAt({ gemSlug: entry.gem.slug, parentSlug: entry.parentSlug })}
            onFocusOut={() => onPointAt(null)}
          >
            <span class="gem-priority__number">{i + 1}</span>
            <WithTooltip model={gemTooltip(entry.gem)} openOnChildClick>
              <button type="button" class="gem-priority__gem gem-copy" aria-label={copyLabel(entry.gem.name)} onClick={() => onCopy(entry.gem.name)}>
                <GemIcon gem={entry.gem} class={`gem-priority__icon gem-socket gem-socket--${gemAttribute(entry.gem) ?? 'none'}`} />
                <span class="gem-priority__text">
                  <span class="gem-priority__name"><BilingualText text={entry.gem.name} /></span>
                </span>
              </button>
            </WithTooltip>
            {parentGem ? (
              <WithTooltip model={gemTooltip(parentGem)} openOnChildClick>
                <button
                  type="button"
                  class="gem-priority__parent gem-copy"
                  aria-label={`Show details for ${entry.parentName ?? parentGem.name}`}
                  title={entry.parentName ?? parentGem.name}
                >
                  <GemIcon gem={parentGem} class={`gem-priority__parent-icon gem-socket gem-socket--${gemAttribute(parentGem) ?? 'none'}`} />
                  <span class="gem-priority__parent-label">{entry.parentName ?? parentGem.name}</span>
                </button>
              </WithTooltip>
            ) : entry.parentName ? (
              <span class="gem-priority__parent gem-priority__parent--text" title={entry.parentName}>
                <BilingualText text={entry.parentName} />
              </span>
            ) : null}
          </li>
          );
        })}
      </ol>
    </section>
  );
}

function GemIcon({ gem, class: className }: { gem: Gem; class: string }) {
  return <Icon src={gem.iconUrl} class={className} kind="gem" />;
}

function formatAttributes({ str, dex, int }: Attributes, locale: ReturnType<typeof useDisplayLocale>): string {
  return `${uiText('Str', locale)} ${str} · ${uiText('Dex', locale)} ${dex} · ${uiText('Int', locale)} ${int}`;
}
