import { BilingualText } from '@/ui/translation/BilingualText';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EntityInfo, EquipmentSlot, ItemRef, Variant } from '@/lib/build/model';
import { itemTooltip, socketableTooltip } from '@/lib/tooltip/tooltip-model';
import { slotIconKind, slotLabel } from '@/lib/ui/slots';
import { Icon } from '@/ui/common/Icon';
import { RichText } from '@/ui/rich-text/RichText';
import { entityChipRenderer } from '@/ui/tooltip/EntityTooltipChip';
import { TooltipLauncher, WithTooltip } from '@/ui/tooltip/Tooltip';
import { embedSiteGear, type GearEmbed, type GearEmbedStatus } from '@/lib/gear/site-gear';

const EMPTY = "The author hasn't listed gear for this variant.";

export function GearPanel({ variant, variantIndex = 0, entities }: { variant: Variant; variantIndex?: number; entities: Record<string, EntityInfo> }) {
  const renderEntity = useMemo(() => entityChipRenderer(entities), [entities]);
  const renderTranslatedEntity = useMemo(() => entityChipRenderer(entities, true), [entities]);
  const hasEquipment = variant.equipment.length > 0;
  const [priorityCollapsed, setPriorityCollapsed] = useState(true);

  if (!hasEquipment && !variant.equipmentNotes) {
    return <p class="panel-empty">{EMPTY}</p>;
  }

  return (
    <div class="gear">
      {hasEquipment ? (
        <div class="gear__columns">
          {variant.itemPriority.length > 0 && (
            <PriorityCard
              items={variant.itemPriority}
              equipment={variant.equipment}
              collapsed={priorityCollapsed}
              onToggle={() => setPriorityCollapsed((value) => !value)}
            />
          )}
          <SiteEquipment variant={variant} variantIndex={variantIndex} priorityCollapsed={priorityCollapsed} />
        </div>
      ) : (
        <p class="panel-empty">{EMPTY}</p>
      )}
      {variant.equipmentNotes && (
        <section class="card gear__notes">
          <h2 class="card__title">Author's Notes</h2>
          <RichText value={variant.equipmentNotes} renderEntity={renderEntity} renderTranslatedEntity={renderTranslatedEntity} />
        </section>
      )}
    </div>
  );
}

export type EmbedGear = (options: {
  placeholder: HTMLElement;
  variantIndex: number;
  itemIcons: Map<string, number[]>;
  itemTradeUrls: (string | null)[];
  socketableCounts: number[];
  onSelectItem: (index: number, anchor: HTMLElement, portalParent: HTMLElement) => void;
  onSelectSocketable: (equipmentIndex: number, socketableIndex: number, anchor: HTMLElement, portalParent: HTMLElement) => void;
  onStatus: (status: GearEmbedStatus) => void;
}) => GearEmbed;

const embedIntoPage: EmbedGear = (options) => embedSiteGear({ doc: document, win: window, ...options });

function SiteEquipment({ variant, variantIndex, priorityCollapsed, embedGear = embedIntoPage }: {
  variant: Variant;
  variantIndex: number;
  priorityCollapsed: boolean;
  embedGear?: EmbedGear;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const embed = useRef<GearEmbed | null>(null);
  const shownIndex = useRef(variantIndex);
  const previousCollapse = useRef(priorityCollapsed);
  const [status, setStatus] = useState<GearEmbedStatus>('loading');
  const [detail, setDetail] = useState<{
    anchor: HTMLElement;
    portalParent: HTMLElement;
    equipmentIndex: number;
    socketableIndex: number | null;
  } | null>(null);
  const iconIndices = useMemo(() => {
    const icons = new Map<string, number[]>();
    variant.equipment.forEach(({ item }, index) => {
      if (!item.iconUrl) return;
      const url = normalizeItemUrl(item.iconUrl);
      icons.set(url, [...(icons.get(url) ?? []), index]);
    });
    return icons;
  }, [variant]);
  const socketableCounts = useMemo(() => variant.equipment.map(({ socketables }) => socketables.length), [variant]);
  const itemTradeUrls = useMemo(() => variant.equipment.map(({ item }) => item.tradeUrl), [variant]);
  useEffect(() => {
    const placeholder = stage.current!;
    const handle = embedGear({
      placeholder,
      variantIndex: shownIndex.current,
      itemIcons: iconIndices,
      itemTradeUrls,
      socketableCounts,
      onSelectItem: (equipmentIndex, anchor, portalParent) => setDetail({ equipmentIndex, socketableIndex: null, anchor, portalParent }),
      onSelectSocketable: (equipmentIndex, socketableIndex, anchor, portalParent) => {
        const socketable = variant.equipment[equipmentIndex]?.socketables[socketableIndex];
        console.info('[poe2ultra:gear] panel received socket selection', {
          equipmentIndex,
          equipmentName: variant.equipment[equipmentIndex]?.item.name ?? null,
          socketableIndex,
          socketableName: socketable?.name ?? null,
          socketableSlug: socketable?.slug ?? null,
          equipmentSocketableCount: variant.equipment[equipmentIndex]?.socketables.length ?? 0,
        });
        if (socketable) {
          setDetail({ equipmentIndex, socketableIndex, anchor, portalParent });
        }
      },
      onStatus: setStatus,
    });
    embed.current = handle;
    const scroller = placeholder.closest('.build-view__panel');
    const follow = () => handle.sync();
    scroller?.addEventListener('scroll', follow);
    return () => {
      scroller?.removeEventListener('scroll', follow);
      handle.destroy();
      embed.current = null;
    };
  }, [embedGear, iconIndices, itemTradeUrls, socketableCounts, variant.equipment]);

  useEffect(() => {
    if (previousCollapse.current === priorityCollapsed) return;
    previousCollapse.current = priorityCollapsed;
    embed.current?.sync(true);
  }, [priorityCollapsed]);

  useEffect(() => {
    if (shownIndex.current === variantIndex) return;
    shownIndex.current = variantIndex;
    setDetail(null);
    embed.current?.setVariant(variantIndex);
  }, [variantIndex]);

  const equipped = detail && variant.equipment[detail.equipmentIndex];
  const tooltipRequest = useMemo(
    () => detail && equipped ? {
      anchor: detail.anchor,
      portalParent: detail.portalParent,
      nativeStyle: true as const,
      model: detail.socketableIndex === null
        ? itemTooltip(equipped.item, equipped.socketables)
        : socketableTooltip(equipped.socketables[detail.socketableIndex]!),
    } : null,
    [detail, equipped],
  );

  useEffect(() => {
    if (!detail) return;
    console.info('[poe2ultra:gear] tooltip request', {
      equipmentIndex: detail.equipmentIndex,
      socketableIndex: detail.socketableIndex,
      equipmentName: equipped?.item.name ?? null,
      tooltipTitle: tooltipRequest?.model.title ?? null,
      hasAnchor: detail.anchor.isConnected,
      hasPortalParent: detail.portalParent.isConnected,
    });
  }, [detail, equipped, tooltipRequest]);

  return (
    <section class="card gear__native" aria-label="Equipment">
      <div class="gear__native-stage" ref={stage}>
        {status !== 'ready' && <p class="gear__native-status" role="status">{status === 'loading' ? 'Loading the original equipment board…' : 'The site did not show equipment for this build.'}</p>}
      </div>
      <TooltipLauncher request={tooltipRequest} />
    </section>
  );
}

function normalizeItemUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function PriorityCard({ items, equipment, collapsed, onToggle }: {
  items: ItemRef[];
  equipment: EquipmentSlot[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <section class="card glance glance--collapsed gear__priority gear__priority--collapsed" aria-label="Gear Priority">
        <button type="button" class="glance__rail" aria-label="Expand Gear Priority" title="Expand Gear Priority" aria-expanded="false" onClick={onToggle}>
          <PanelLeftOpen size={16} aria-hidden="true" />
          <span class="glance__rail-title" aria-hidden="true">Gear Priority</span>
        </button>
      </section>
    );
  }

  return (
    <section class="card gear__priority">
      <div class="glance__header">
        <h2 class="card__title">Gear Priority</h2>
        <button type="button" class="icon-button glance__toggle" aria-label="Collapse Gear Priority" title="Collapse Gear Priority" aria-expanded="true" onClick={onToggle}>
          <PanelLeftClose size={16} aria-hidden="true" />
        </button>
      </div>
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
