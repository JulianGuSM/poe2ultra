import { render, screen } from '@testing-library/preact';
import { expect, it } from 'vitest';
import { TranslationProvider, BilingualText } from './BilingualText';
import { RichText } from '../rich-text/RichText';
import { segmentKey } from '@/lib/translation/plan';

const segment = { kind: 'prose' as const, texts: ['Our defenses ', 'were buffed ', 'in 0.5.'], protected: [] };
const records = { [segmentKey(segment)]: { cn: ['在 0.5 版本中，我们的防御得到加强。'], tw: ['在 0.5 版本中，我們的防禦得到加強。'] } };
const value = { root: { type: 'root', children: [{ type: 'paragraph', children: [
  { type: 'text', text: segment.texts[0] }, { type: 'text', text: segment.texts[1], format: 1 },
  { type: 'link', url: 'https://example.com/patch', children: [{ type: 'text', text: segment.texts[2] }] },
] }] } };

it('keeps original formatting and links, and places a whole translation below the paragraph', () => {
  const { container, rerender } = render(<TranslationProvider records={records} locale="cn"><RichText value={value} /></TranslationProvider>);
  expect(container.querySelector('strong')?.textContent).toBe('were buffed ');
  expect(screen.getByRole('link').textContent).toBe('in 0.5.');
  const translated = container.querySelector('.translation-text');
  expect(translated?.textContent).toBe(records[segmentKey(segment)]!.cn[0]);
  expect(translated?.previousElementSibling?.textContent).toBe(segment.texts.join(''));
  rerender(<TranslationProvider records={records} locale="tw"><RichText value={value} /></TranslationProvider>);
  expect(container.querySelector('.translation-text')?.textContent).toBe(records[segmentKey(segment)]!.tw[0]);
  rerender(<TranslationProvider records={records} locale="en"><RichText value={value} /></TranslationProvider>);
  expect(container.querySelector('.translation-text')).toBeNull();
  expect(screen.getByRole('link').textContent).toBe('in 0.5.');
});

it('reuses older cached span arrays as one translation and never interprets model HTML', () => {
  const old = { [segmentKey(segment)]: { cn: ['<img src=x>', '译文'], tw: ['舊譯文'] } };
  const { container } = render(<TranslationProvider records={old} locale="cn"><BilingualText text={segment.texts.join('')} /></TranslationProvider>);
  expect(container.querySelector('.translation-text')?.textContent).toBe('<img src=x>译文');
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain(segment.texts.join(''));
});
