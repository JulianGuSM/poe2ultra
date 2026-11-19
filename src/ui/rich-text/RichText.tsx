import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import type { RichText as RichTextValue } from '@/lib/build/model';
import { type RichBlock, type RichEntity, type RichInline, type RichList, type RichTextRun, toRichBlocks } from '@/lib/rich-text/convert';
import { Icon } from '@/ui/common/Icon';
import { RetranslateControl, TranslationContext, TranslationText } from '@/ui/translation/BilingualText';
import { useContext } from 'preact/hooks';

export interface RichTextProps {
  value: RichTextValue | null;
  /** Custom entity rendering, e.g. a chip with a tooltip. */
  renderEntity?: (entity: RichEntity) => ComponentChildren;
  /** Renderer for entity chips positioned by their translated labels in the complete target-language sentence. */
  renderTranslatedEntity?: (entity: RichEntity) => ComponentChildren;
  class?: string;
}

type EntityRenderer = NonNullable<RichTextProps['renderEntity']>;

/** Guide text from the site's editor. Rendered through JSX only, so text can never become markup. */
export function RichText({ value, renderEntity = EntityChip, renderTranslatedEntity = renderEntity, class: className }: RichTextProps) {
  const blocks = useMemo(() => toRichBlocks(value), [value]);
  if (blocks.length === 0) return null;
  return <div class={className ? `rt ${className}` : 'rt'}>{blocks.map((block, i) => renderBlock(block, i, renderEntity, renderTranslatedEntity))}</div>;
}

export function EntityChip(entity: RichEntity) {
  return (
    <span class={`rt-entity rt-entity--${entity.group}`} data-slug={entity.slug}>
      <Icon src={entity.iconUrl} class="rt-entity__icon" missing="none" />
      <span class="rt-entity__label">{entity.label}</span>
    </span>
  );
}

function renderBlock(block: RichBlock, key: number, renderEntity: EntityRenderer, renderTranslatedEntity: EntityRenderer) {
  switch (block.kind) {
    case 'paragraph':
      return <TranslatedBlock key={key} source={inlineText(block.children)} nodes={block.children} renderEntity={renderTranslatedEntity}><p>{renderInlines(block.children, renderEntity)}</p></TranslatedBlock>;
    case 'heading': {
      const Heading = `h${block.level}` as 'h2' | 'h3' | 'h4';
      return <TranslatedBlock key={key} source={inlineText(block.children)} nodes={block.children} renderEntity={renderTranslatedEntity}><Heading>{renderInlines(block.children, renderEntity)}</Heading></TranslatedBlock>;
    }
    case 'list':
      return renderList(block, key, renderEntity, renderTranslatedEntity);
  }
}

function renderList(list: RichList, key: number, renderEntity: EntityRenderer, renderTranslatedEntity: EntityRenderer) {
  const items = list.items.map((item, i) => (
    <li key={i}>
      <TranslatedBlock source={inlineText(item.children)} nodes={item.children} renderEntity={renderTranslatedEntity}>
        {item.children.length > 0 && <span>{renderInlines(item.children, renderEntity)}</span>}
      </TranslatedBlock>
      {item.lists.map((nested, j) => renderList(nested, j, renderEntity, renderTranslatedEntity))}
    </li>
  ));
  return list.ordered ? (
    <ol key={key} start={list.start === 1 ? undefined : list.start}>
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

function TranslatedBlock({ source, nodes, renderEntity, children }: {
  source: string; nodes: RichInline[]; renderEntity: EntityRenderer; children: ComponentChildren;
}) {
  const { locale, texts, entityTranslations = new Map(), widgetTranslations = new Map(), retranslateMode } = useContext(TranslationContext);
  const translated = locale === 'en' ? undefined : texts.get(source);
  const richTranslation = translated
    ? placeTranslatedEntities(translated, nodes, widgetTranslations.get(source), entityTranslations, renderEntity)
    : null;
  if (!richTranslation) return <>{children}<TranslationText source={source} /></>;
  return <>{children}<span class={`translation-text-row translation-text-row--rich${retranslateMode ? ' translation-text-row--retranslation-mode' : ''}`}>
    <RetranslateControl source={source} />
    <span class="translation-text" lang={locale === 'cn' ? 'zh-Hans' : 'zh-Hant'}>{richTranslation}</span>
  </span></>;
}

interface EntityPlacement { start: number; end: number; entity: RichEntity; label: string }

/** Reposition entity chips by their translated labels instead of source-node indices. */
function placeTranslatedEntities(
  translation: string,
  nodes: RichInline[],
  widgetTranslations: Map<number, string> | undefined,
  entityTranslations: Map<string, string>,
  renderEntity: EntityRenderer,
): ComponentChildren[] | null {
  const entities = collectEntities(nodes);
  if (!entities.length) return null;

  const placements: EntityPlacement[] = [];
  for (const { index, entity } of entities) {
    const localized = (widgetTranslations?.get(index) ?? entityTranslations.get(entity.label))?.trim();
    const candidates = [...new Set([localized, entity.label].filter((label): label is string => !!label))];
    let match: { start: number; label: string } | undefined;
    for (const label of candidates) {
      if (placements.some(placement => placement.label === label && placement.entity.slug !== entity.slug)) return null;
      let start = translation.indexOf(label);
      while (start >= 0) {
        const end = start + label.length;
        if (!placements.some(placement => start < placement.end && end > placement.start)) {
          match = { start, label };
          break;
        }
        start = translation.indexOf(label, start + Math.max(1, label.length));
      }
      if (match) break;
    }
    if (!match) return null;
    placements.push({ start: match.start, end: match.start + match.label.length, entity, label: match.label });
  }

  placements.sort((a, b) => a.start - b.start || b.end - a.end);
  // Duplicate/overlapping labels cannot be associated with a unique entity safely.
  for (let i = 1; i < placements.length; i++) {
    if (placements[i]!.start < placements[i - 1]!.end) return null;
  }

  const result: ComponentChildren[] = [];
  let cursor = 0;
  for (const [index, placement] of placements.entries()) {
    if (placement.start < cursor) return null;
    if (placement.start > cursor) result.push(translation.slice(cursor, placement.start));
    result.push(<span key={`translated-entity-${index}`}>{renderEntity({ ...placement.entity, label: placement.label })}</span>);
    cursor = placement.end;
  }
  if (cursor < translation.length) result.push(translation.slice(cursor));
  return result;
}

function collectEntities(nodes: RichInline[]): { index: number; entity: RichEntity }[] {
  const entities: { index: number; entity: RichEntity }[] = [];
  let cursor = 0;
  const visit = (children: RichInline[]) => {
    for (const node of children) {
      if (node.kind === 'entity') entities.push({ index: cursor++, entity: node });
      else if (node.kind === 'text') cursor++;
      else if (node.kind === 'link') visit(node.children);
    }
  };
  visit(nodes);
  return entities;
}

function inlineText(nodes: RichInline[]): string {
  return nodes.map(node => node.kind === 'text' ? node.text : node.kind === 'entity' ? node.label : node.kind === 'link' ? inlineText(node.children) : '').join('');
}

function renderInlines(nodes: RichInline[], renderEntity: EntityRenderer): ComponentChildren[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return <TextRun key={i} run={node} />;
      case 'linebreak':
        return <br key={i} />;
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInlines(node.children, renderEntity)}
          </a>
        );
      case 'entity':
        return <span key={i}>{renderEntity(node)}</span>;
    }
  });
}

function TextRun({ run }: { run: RichTextRun }) {
  let content: ComponentChildren = run.text;
  if (run.code) content = <code>{content}</code>;
  if (run.color) content = <span style={{ color: run.color }}>{content}</span>;
  if (run.strikethrough) content = <s>{content}</s>;
  if (run.underline) content = <u>{content}</u>;
  if (run.italic) content = <em>{content}</em>;
  if (run.bold) content = <strong>{content}</strong>;
  return <>{content}</>;
}
