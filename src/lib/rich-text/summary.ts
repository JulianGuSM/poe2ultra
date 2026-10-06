import { type RichBlock, type RichInline, toRichBlocks } from './convert';

/** One-line plain text teaser: the first paragraph (or list item), shortened at a word boundary. */
export function richTextSummary(value: unknown, maxLength = 180): string | null {
  const first = richTextSummaryEntry(value);
  return first ? shortenSummary(first.text, maxLength) : null;
}

/** Keep the complete source as a cache lookup key; decoration alone is not an introduction. */
export function richTextSummaryEntry(value: unknown): { source: string; text: string } | null {
  for (const nodes of toRichBlocks(value).flatMap(blockInlines)) {
    const text = nodes.map(node => inlineText(node, '\n')).join('').split(/\r?\n/)
      .filter(line => /[\p{L}\p{N}]/u.test(line)).join(' ').replace(/\s+/g, ' ').trim();
    if (text) return { source: nodes.map(node => inlineText(node, '')).join(''), text };
  }
  return null;
}

export function shortenSummary(first: string, maxLength = 180): string {
  if (first.length <= maxLength) return first;
  const cut = first.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

function blockInlines(block: RichBlock): RichInline[][] {
  if (block.kind === 'heading') return [];
  return block.kind === 'list'
    ? block.items.flatMap(item => [item.children, ...item.lists.flatMap(blockInlines)])
    : [block.children];
}

function inlineText(node: RichInline, linebreak: string): string {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'entity':
      return node.label;
    case 'link':
      return node.children.map(child => inlineText(child, linebreak)).join('');
    case 'linebreak':
      return linebreak;
  }
}
