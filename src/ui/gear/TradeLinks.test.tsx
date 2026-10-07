import { act, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseBuild } from '@/lib/build/parse-build';
import { SETTINGS_KEY } from '@/lib/translation/settings';
import { TranslationProvider } from '@/ui/translation/BilingualText';
import { TooltipProvider } from '@/ui/tooltip/Tooltip';
import type { Locale } from '@/lib/translation/plan';
import { loadFixture } from '../../../tests/fixtures/load';
import { GearPanel } from './GearPanel';

const mock = vi.hoisted(() => ({ send: vi.fn(), changed: new Set<(changes: Record<string, unknown>, area: string) => void>() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { sendMessage: mock.send },
  storage: { onChanged: { addListener: (fn: any) => mock.changed.add(fn), removeListener: (fn: any) => mock.changed.delete(fn) } },
} }));
const fixture = loadFixture('chaos-dot-lich-starter-deadrabbit');
const build = parseBuild(fixture.build, fixture.staticData);
const equipped = build.variants.flatMap(v => v.equipment).find(slot => slot.item.tradeUrl)!;
const source = equipped.item.tradeUrl!;
const variant = { ...build.variants[0]!, equipment: [equipped] };
const chinaUrl = 'https://poe.game.qq.com/trade2/search/poe2/test/H4sI';
const panel = (locale: Locale) => <TranslationProvider records={{}} locale={locale}><TooltipProvider><GearPanel variant={variant} entities={build.entities} /></TooltipProvider></TranslationProvider>;
const link = () => screen.getByRole('link', { name: `Find ${equipped.item.name} on the trade site` });
beforeEach(() => { mock.send.mockReset(); mock.changed.clear(); });

it('waits for the converted link and updates it when the China league settings change', async () => {
  let resolve!: (value: unknown) => void;
  mock.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(panel('cn'));
  expect(link().hasAttribute('href')).toBe(false);
  expect(mock.send).toHaveBeenCalledWith({ type: 'china-trade-links', urls: [source] });
  await act(async () => resolve({ links: { [source]: { url: chinaUrl } } }));
  expect(link().getAttribute('href')).toBe(chinaUrl);
  mock.send.mockResolvedValue({ links: { [source]: { url: `${chinaUrl}-new` } } });
  act(() => mock.changed.forEach(fn => fn({ [SETTINGS_KEY]: {} }, 'local')));
  await waitFor(() => expect(link().getAttribute('href')).toBe(`${chinaUrl}-new`));
});

it('ignores a pending China response after switching back to English or Traditional Chinese', async () => {
  let resolve!: (value: unknown) => void;
  mock.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(panel('cn'));
  view.rerender(panel('en'));
  expect(link().getAttribute('href')).toBe(source);
  await act(async () => resolve({ links: { [source]: { url: chinaUrl } } }));
  expect(link().getAttribute('href')).toBe(source);
  view.rerender(panel('tw'));
  expect(link().getAttribute('href')).toBe(source);
});

it('shows the conversion error instead of linking to an empty search', async () => {
  mock.send.mockResolvedValue({ links: { [source]: { error: '术语表中缺少国服名称' } } });
  render(panel('cn'));
  await waitFor(() => expect(link().getAttribute('title')).toBe('术语表中缺少国服名称'));
  expect(link().getAttribute('aria-disabled')).toBe('true');
  expect(link().hasAttribute('href')).toBe(false);
});
