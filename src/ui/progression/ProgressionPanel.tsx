import { BilingualText, useDisplayLocale } from '@/ui/translation/BilingualText';
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { MapPin } from 'lucide-preact';
import type { Build, Passive, QuestAct, QuestRewardCategory, Variant } from '@/lib/build/model';
import { gemTooltip, itemTooltip, passiveTooltip, type TooltipModel } from '@/lib/tooltip/tooltip-model';
import { type StageChanges, stageChanges } from '@/lib/ui/progression';
import type { TabId } from '@/lib/ui/route';
import type { IconKind } from '@/ui/common/Icon';
import { Icon } from '@/ui/common/Icon';
import { RichText } from '@/ui/rich-text/RichText';
import { entityChipRenderer } from '@/ui/tooltip/EntityTooltipChip';
import { WithTooltip } from '@/ui/tooltip/Tooltip';
import { uiText } from '@/lib/ui/i18n';
import { VariantPicker } from '@/ui/build/VariantPicker';

interface ChangeEntry {
  key: string;
  name: string;
  iconUrl: string | null;
  tooltip: TooltipModel;
  kind: IconKind;
  round?: boolean;
}

/** The variants as stages of the build: what each one changes, next to the campaign quest rewards. */
export function ProgressionPanel({
  build,
  variant,
  onSelectVariant,
  onOpenTab,
}: {
  build: Build;
  variant: Variant;
  onSelectVariant: (variantId: string) => void;
  onOpenTab: (tab: TabId) => void;
}) {
  const renderEntity = useMemo(() => entityChipRenderer(build.entities), [build.entities]);
  const renderTranslatedEntity = useMemo(() => entityChipRenderer(build.entities, true), [build.entities]);
  const index = build.variants.indexOf(variant);
  const previous = index > 0 ? build.variants[index - 1]! : null;
  const changes = useMemo(() => stageChanges(previous, variant), [previous, variant]);

  return (
    <div class={build.questRewards.length > 0 ? 'progression' : 'progression progression--no-quests'}>
      <nav class="progression__stages" aria-label="Stages">
        <VariantPicker
          variants={build.variants}
          selectedId={variant.id}
          onChange={onSelectVariant}
          ariaLabel="Build stages"
          showSingle
          buttonClass="chip stage"
          selectedAttribute="step"
          renderVariant={(stage) => <>
            <span class="stage__title"><BilingualText text={stage.title} inline /></span>
            <span class="stage__meta">{stage.passives.nodeCount} points</span>
          </>}
        />
      </nav>

      <section class="card progression__stage" aria-label="Stage">
        <div class="stage-header">
          <h2 class="card__title" title={variant.title}>
            <BilingualText text={variant.title} />
          </h2>
          <p class="stage-header__from">{previous ? `Changes from ${previous.title}` : 'Starting point'}</p>
        </div>
        <div class="stage-body">
          {variant.description && (
            <section class="stage-group stage-notes" aria-label="Author's Notes">
              <div class="stage-group__heading">
                <h3 class="stage-group__title">Author's Notes</h3>
              </div>
              <RichText value={variant.description} renderEntity={renderEntity} renderTranslatedEntity={renderTranslatedEntity} class="stage__description" />
            </section>
          )}
          <div class="stage-groups">
            <SkillChanges changes={changes} onOpen={() => onOpenTab('skills')} />
            <GearChanges changes={changes} onOpen={() => onOpenTab('gear')} />
            <PassiveChanges changes={changes} onOpen={() => onOpenTab('passives')} />
          </div>
        </div>
      </section>

      {build.questRewards.length > 0 && <QuestRewards acts={build.questRewards} />}
    </div>
  );
}

function StageGroup({ title, onOpen, children }: { title: string; onOpen: () => void; children: ComponentChildren }) {
  return (
    <section class="stage-group" aria-label={title}>
      <div class="stage-group__heading">
        <h3 class="stage-group__title">{title}</h3>
        <button type="button" class="link-button" onClick={onOpen}>
          Open {title}
        </button>
      </div>
      {children}
    </section>
  );
}

function SkillChanges({ changes, onOpen }: { changes: StageChanges; onOpen: () => void }) {
  const gem = (entry: StageChanges['addedSupports'][number]): ChangeEntry => ({
    key: entry.slug,
    name: entry.name,
    iconUrl: entry.iconUrl,
    tooltip: gemTooltip(entry),
    kind: 'gem',
  });
  const added = [...changes.addedSkills.map((skill) => gem(skill.gem)), ...changes.addedSupports.map(gem)];
  const removed = [...changes.removedSkills.map((skill) => gem(skill.gem)), ...changes.removedSupports.map(gem)];
  return (
    <StageGroup title="Skills" onOpen={onOpen}>
      <ChangeList added={added} removed={removed} />
    </StageGroup>
  );
}

function GearChanges({ changes, onOpen }: { changes: StageChanges; onOpen: () => void }) {
  return (
    <StageGroup title="Gear" onOpen={onOpen}>
      {changes.gear.length === 0 ? (
        <p class="stage-group__empty">No changes</p>
      ) : (
        <ul class="gear-changes">
          {changes.gear.map((change, i) => (
            <li key={`${change.label}-${i}`} class="gear-change">
              <span class="gear-change__slot" title={change.label}>
                <BilingualText text={change.label} />
              </span>
              {change.previous && (
                <span class="gear-change__from" title={change.previous.item.name}>
                  <BilingualText text={change.previous.item.name} />
                </span>
              )}
              {change.current ? (
                <span class="gear-change__to">
                  <Entry
                    entry={{
                      key: change.current.item.slug,
                      name: change.current.item.name,
                      iconUrl: change.current.item.iconUrl,
                      tooltip: itemTooltip(change.current.item, change.current.socketables),
                      kind: 'item',
                    }}
                    nameClass={change.current.item.rarity === 'unique' ? 'item-name--unique' : undefined}
                  />
                </span>
              ) : (
                <span class="gear-change__to gear-change__to--empty">Removed</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </StageGroup>
  );
}

function PassiveChanges({ changes, onOpen }: { changes: StageChanges; onOpen: () => void }) {
  const { points } = changes;
  const delta = (value: number) => (value === 0 ? '' : ` (${value > 0 ? '+' : ''}${value})`);
  const summary = [
    `${points.total} points${delta(points.delta)}`,
    points.ascendancyTotal > 0 || points.ascendancyDelta !== 0 ? `${points.ascendancyTotal} ascendancy${delta(points.ascendancyDelta)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const passive = (entry: Passive): ChangeEntry => ({
    key: entry.nodeSlug ?? entry.name,
    name: entry.name,
    iconUrl: entry.iconUrl,
    tooltip: passiveTooltip(entry),
    kind: 'passive',
    round: true,
  });
  return (
    <StageGroup title="Passives" onOpen={onOpen}>
      <p class="stage-points">{summary}</p>
      <ChangeList added={[...changes.addedAscendancy, ...changes.addedKeyPassives].map(passive)} removed={changes.removedKeyPassives.map(passive)} quiet />
    </StageGroup>
  );
}

/** Added entries, then removed ones; `quiet` skips the "No changes" note (the group already says enough). */
function ChangeList({ added, removed, quiet = false }: { added: ChangeEntry[]; removed: ChangeEntry[]; quiet?: boolean }) {
  if (added.length === 0 && removed.length === 0) return quiet ? null : <p class="stage-group__empty">No changes</p>;
  return (
    <ul class="changes">
      {added.map((entry) => (
        <li key={`+${entry.key}`} class="change change--added">
          <span class="change__sign" aria-label="Added">
            +
          </span>
          <Entry entry={entry} />
        </li>
      ))}
      {removed.map((entry) => (
        <li key={`-${entry.key}`} class="change change--removed">
          <span class="change__sign" aria-label="Removed">
            −
          </span>
          <Entry entry={entry} />
        </li>
      ))}
    </ul>
  );
}

function Entry({ entry, nameClass }: { entry: ChangeEntry; nameClass?: string }) {
  return (
    <WithTooltip model={entry.tooltip}>
      <span class="change__entry">
        <Icon src={entry.iconUrl} class={entry.round ? 'change__icon change__icon--round' : 'change__icon'} kind={entry.kind} />
        <span class={nameClass ? `change__name ${nameClass}` : 'change__name'}><BilingualText text={entry.name} /></span>
      </span>
    </WithTooltip>
  );
}

type QuestFilter = QuestRewardCategory | 'all';
const QUEST_FILTERS: QuestFilter[] = ['choices', 'skill-points', 'character-upgrades', 'all'];
const QUEST_FILTER_LABELS: Record<QuestFilter, string> = {
  choices: 'Choices',
  'skill-points': 'Skill Points',
  'character-upgrades': 'Character Upgrades',
  all: 'All',
};

function QuestRewards({ acts }: { acts: QuestAct[] }) {
  const locale = useDisplayLocale();
  const [filter, setFilter] = useState<QuestFilter>('choices');
  const visibleActs = acts
    .map((act) => ({ ...act, quests: filter === 'all' ? act.quests : act.quests.filter((quest) => quest.categories.includes(filter)) }))
    .filter((act) => act.quests.length > 0);
  return (
    <section class="card progression__quests" aria-label={uiText('Quest Rewards', locale)}>
      <h2 class="card__title">{uiText('Quest Rewards', locale)}</h2>
      <div class="quest-filters" role="group" aria-label={uiText('Quest Rewards', locale)}>
        {QUEST_FILTERS.map((category) => (
          <button type="button" class="quest-filter" aria-pressed={filter === category} onClick={() => setFilter(category)}>
            {uiText(QUEST_FILTER_LABELS[category], locale)}
          </button>
        ))}
      </div>
      <div class="quests">
        {visibleActs.map((act) => (
          <details key={act.act} class="quests__group" open>
            <summary class="quests__act">{act.act}</summary>
            <ul class="quest-list">
              {act.quests.map((quest) => (
                <li key={quest.name} class="quest">
                  <div class="quest__heading">
                    {quest.area && (
                      <span class="quest__location">
                        <MapPin class="quest__pin" aria-hidden="true" />
                        <span class="quest__area" title={quest.area}>{quest.area}</span>
                        <span aria-hidden="true">—</span>
                      </span>
                    )}
                    <span class={`quest__name${quest.area ? ' quest__name--located' : ''}`} title={quest.name}>{quest.name}</span>
                  </div>
                  <div class="quest__rewards">
                    {quest.reward.split(/,\s*/).map((reward, index) => <span key={`${index}-${reward}`} class="quest__reward">{reward}</span>)}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
