import { gunzipSync } from 'node:zlib';
import { beforeEach, expect, it, vi } from 'vitest';
import { registerTradeLinks } from './background';

const mock = vi.hoisted(() => ({
  listener: undefined as undefined | ((message: any, sender: any, reply: (result: any) => void) => unknown),
  stored: {} as Record<string, unknown>,
  league: '周年庆巅峰挑战',
}));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'extension-id', onMessage: { addListener: (fn: typeof mock.listener) => { mock.listener = fn; } } },
  storage: { local: { get: async () => mock.stored } },
} }));
vi.mock('@/lib/translation/preferences', () => ({ getSettings: async () => ({ chinaTradeLeague: mock.league }) }));
vi.mock('@/lib/translation/glossary-snapshot', () => ({ glossarySnapshot: async (override?: { entries: { e: string; c: string }[] }) => ({ index: { en: new Map((override?.entries ?? [{ e: 'evergrasping ring', c: '永恒紧缩之戒' }]).map(entry => [entry.e, entry])) } }) }));
const sender = { id: 'extension-id', url: 'https://mobalytics.gg/poe-2/builds/test-guide' };
const url = (name: string) => `https://www.pathofexile.com/trade2/search/Forbidden%20Rites?q=${encodeURIComponent(JSON.stringify({ query: { name, status: { option: 'securable' }, stats: [] } }))}`;
const decode = (source: string) => JSON.parse(gunzipSync(Buffer.from(source.split('/').at(-1)!, 'base64url')).toString('utf8'));
beforeEach(() => { mock.stored = {}; mock.league = '周年庆巅峰挑战'; registerTradeLinks(); });

it('returns independent conversion results without discarding successful searches', async () => {
  const known = url('Evergrasping Ring'), unknown = url('Unknown');
  const reply = await new Promise<any>(resolve => {
    expect(mock.listener!({ type: 'china-trade-links', urls: [known, unknown] }, sender, resolve)).toBe(true);
  });
  expect(decode(reply.links[known].url)).toMatchObject({ name: '永恒紧缩之戒', type: '珠玉戒指' });
  expect(reply.links[unknown].error).toContain('Unknown');
  expect(reply.links[unknown].url).toBeUndefined();
});

it('uses a saved league and supplements the bundled names with imported terminology', async () => {
  mock.stored = { glossaryOverride: { entries: [{ e: 'another unique', c: '另一个暗金' }] } };
  mock.league = '用户选择的赛季';
  const sources = [url('Evergrasping Ring'), url('Another Unique')];
  const reply = await new Promise<any>(resolve => mock.listener!({ type: 'china-trade-links', urls: sources }, sender, resolve));
  expect(decode(reply.links[sources[0]!].url).name).toBe('永恒紧缩之戒');
  expect(decode(reply.links[sources[1]!].url).name).toBe('另一个暗金');
  expect(decodeURIComponent(reply.links[sources[1]!].url)).toContain('/用户选择的赛季/');
});

it('accepts requests only from this extension on build pages and rejects invalid batches', async () => {
  const respond = vi.fn();
  expect(mock.listener!({ type: 'china-trade-links', urls: [] }, { ...sender, id: 'other' }, respond)).toBeUndefined();
  expect(mock.listener!({ type: 'china-trade-links', urls: [] }, { ...sender, url: 'https://example.com' }, respond)).toBeUndefined();
  expect(respond).not.toHaveBeenCalled();
  const reply = await new Promise<any>(resolve => mock.listener!({ type: 'china-trade-links', urls: [123] }, sender, resolve));
  expect(reply.error).toBeTruthy();
});
