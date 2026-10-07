import { BilingualText } from '@/ui/translation/BilingualText';
import { Scale } from 'lucide-preact';
import { useMemo } from 'preact/hooks';
import type { EntityInfo, EquipmentSlot, ItemRef, Variant } from '@/lib/build/model';
import { gemTooltip, itemTooltip, socketableTooltip } from '@/lib/tooltip/tooltip-model';
import { type SheetSlot, sheetSlots, slotIconKind, slotLabel } from '@/lib/ui/slots';
import { Icon } from '@/ui/common/Icon';
import { RichText } from '@/ui/rich-text/RichText';
import { entityChipRenderer } from '@/ui/tooltip/EntityTooltipChip';
import { WithTooltip } from '@/ui/tooltip/Tooltip';
import type { TradeLinkResult } from '@/lib/trade/china';
import { useTradeLinks } from './useTradeLinks';

const EMPTY = "The author hasn't listed gear for this variant.";

/** An item can grant a handful of skills; the rest are counted, so one item cannot stretch the whole grid. */
const GRANTS_SHOWN = 2;

export function GearPanel({ variant, entities }: { variant: Variant; entities: Record<string, EntityInfo> }) {
  const renderEntity = useMemo(() => entityChipRenderer(entities), [entities]);
  const hasEquipment = variant.equipment.length > 0;
  const tradeLink = useTradeLinks(variant.equipment);

  if (!hasEquipment && !variant.equipmentNotes) {
    return <p class="panel-empty">{EMPTY}</p>;
  }

  const { armour, other } = sheetSlots(variant.equipment);
  const key = (s: SheetSlot) => `${s.slot}${s.weaponSet ?? ''}`;

  return (
    <div class="gear">
      {hasEquipment ? (
        <div class="gear__columns">
          <section class="card gear__slots" aria-label="Equipment">
            <div class="gear__armour">
              {armour.map((s) => (
                <ItemSlotCard key={key(s)} sheetSlot={s} size="large" tradeLink={tradeLink} />
              ))}
            </div>
            <div class="gear__other">
              {other.map((s) => (
                <ItemSlotCard key={key(s)} sheetSlot={s} size="compact" tradeLink={tradeLink} />
              ))}
            </div>
          </section>
          {variant.itemPriority.length > 0 && <PriorityCard items={variant.itemPriority} equipment={variant.equipment} />}
        </div>
      ) : (
        <p class="panel-empty">{EMPTY}</p>
      )}
      {variant.equipmentNotes && (
        <section class="card gear__notes">
          <h2 class="card__title">Author's Notes</h2>
          <RichText value={variant.equipmentNotes} renderEntity={renderEntity} />
        </section>
      )}
    </div>
  );
}

function ItemSlotCard({ sheetSlot, size, tradeLink }: { sheetSlot: SheetSlot; size: 'large' | 'compact'; tradeLink: (source: string) => TradeLinkResult }) {
  const label = slotLabel(sheetSlot.slot, sheetSlot.weaponSet);
  if (!sheetSlot.equipped) {
    return (
      <div class={`item-slot item-slot--${size} item-slot--empty`}>
        <div class="item-slot__art" />
        <div class="item-slot__body">
          <span class="item-slot__label">{label}</span>
          <span class="item-slot__placeholder">Empty</span>
        </div>
      </div>
    );
  }

  const { item, socketables } = sheetSlot.equipped;
  const trade = item.tradeUrl ? tradeLink(item.tradeUrl) : null;
  return (
    <WithTooltip model={itemTooltip(item, socketables)}>
      <div class={`item-slot item-slot--${size}`}>
        <div class="item-slot__art">
          <Icon src={item.iconUrl} class="item-slot__icon" kind={slotIconKind(sheetSlot.slot)} />
          {item.tradeUrl && (
            <a
              class="item-slot__trade"
              href={trade?.url}
              role="link"
              aria-disabled={!trade?.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Find ${item.name} on the trade site`}
              title={trade?.error ?? 'Find on the official trade site'}
              onClick={(event) => event.stopPropagation()}
            >
              <Scale size={12} aria-hidden="true" />
            </a>
          )}
        </div>
        <div class="item-slot__body">
          <span class="item-slot__label">{label}</span>
          <span class={`item-name item-name--${item.rarity}`}><BilingualText text={item.name} /></span>
          {item.grantedSkills.slice(0, GRANTS_SHOWN).map((skill) => (
            <WithTooltip key={skill.name} model={skill.gem ? gemTooltip(skill.gem) : null}>
              <span class="item-slot__grants">
                <Icon src={skill.gem?.iconUrl} class="item-slot__grants-icon" kind="gem" />
                <BilingualText text={skill.name} />
              </span>
            </WithTooltip>
          ))}
          {item.grantedSkills.length > GRANTS_SHOWN && (
            <span class="item-slot__grants item-slot__grants--rest">+{item.grantedSkills.length - GRANTS_SHOWN} more</span>
          )}
          {size === 'large' && item.modifiers.length > 0 && <span class="item-slot__mods"><BilingualText text={item.modifiers.slice(0, 2).join(' · ')} parts={item.modifiers.slice(0, 2)} /></span>}
        </div>
        {socketables.length > 0 && (
          <span class="item-slot__sockets">
            {socketables.map((socketable, i) => (
              <WithTooltip key={i} model={socketableTooltip(socketable)}>
                <Icon
                  src={socketable.iconUrl}
                  class={`item-slot__socket${socketable.iconUrl ? '' : ' item-slot__socket--empty'}`}
                  alt={socketable.name ?? ''}
                  kind={socketable.iconUrl ? 'rune' : undefined}
                />
              </WithTooltip>
            ))}
          </span>
        )}
      </div>
    </WithTooltip>
  );
}

function PriorityCard({ items, equipment }: { items: ItemRef[]; equipment: EquipmentSlot[] }) {
  return (
    <section class="card gear__priority">
      <h2 class="card__title">Gear Priority</h2>
      <ol class="priority" aria-label="Gear priority">
        {items.map((ref, i) => {
          // Priority entries point at the variant's own items; their tooltips come from the equipped slot.
          const equipped = equipment.find((slot) => slot.item.slug === ref.slug);
          return (
            <li key={`${ref.slug}-${i}`} class="priority__row">
              <span class="priority__number">{i + 1}</span>
              <WithTooltip model={equipped ? itemTooltip(equipped.item, equipped.socketables) : null}>
                <span class="priority__item">
                  <Icon src={ref.iconUrl} class="priority__icon" kind={slotIconKind(ref.slot)} />
                  <span class={`priority__name item-name item-name--${equipped?.item.rarity ?? 'normal'}`}><BilingualText text={ref.name} /></span>
                </span>
              </WithTooltip>
              <span class="priority__slot">{slotLabel(ref.slot)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
