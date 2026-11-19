import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/lib/translation/vendor/glossary.js';
import { chinaTradeUrl, DEFAULT_CHINA_LEAGUE } from './china';

const names = buildIndex(JSON.parse(readFileSync('public/data/poe2_terms.json', 'utf8'))).en;
const original = 'https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/H4sIAAAAAAAAClWOQQpCMRBDryJZ9wTdewG38pFRxzLwnV-nU-FTenepbmpWCXmBNBQnrwWxYcsumyKi8K0aXVdGD1B6MiKOb7ZkVLJoOpxEE8J3WhDPDb7nAZHeEfCQ1dlGsfRlij_sMuXJGpn4_nejqrwqow99AAQKnVCoAAAA';
const confirmed = 'H4sIAAAAAAAACqtWKi5JLCktVrKqVsovKMnMz1OyUipOTS4tSkzKSVWq1VHKS8xNVbJSerZhx7PGSc-3LH--Z-WTnd3POiYp6SiVVBaA5J73L3je1_msY9KznnYlHbCJxUpW0dUw-cS8FCUdpbTMnJLUIpBEbG0sEheiLB6Jj8QsSizKLKlEcV1pXmZhaapSLQgAAMpLQD2_AAAA';
const decode = (encoded: string) => JSON.parse(gunzipSync(Buffer.from(encoded, 'base64url')).toString('utf8'));
const decodeUrl = (url: string) => decode(new URL(url).pathname.split('/').at(-1)!);
const queryUrl = (query: object) => `https://www.pathofexile.com/trade2/search/Forbidden%20Rites?q=${encodeURIComponent(JSON.stringify({ query, sort: { price: 'asc' } }))}`;

describe('China realm trade links', () => {
  it('reproduces the user-confirmed ring search from the original compressed link', async () => {
    const url = await chinaTradeUrl(original, names);
    expect(url).toMatch(/^https:\/\/poe\.game\.qq\.com\/trade2\/search\/poe2\//);
    expect(decodeURIComponent(new URL(url).pathname.split('/')[4]!)).toBe(DEFAULT_CHINA_LEAGUE);
    expect(decodeUrl(url)).toEqual(decode(confirmed));
  });

  it('converts the current plugin query-string format to the same confirmed search', async () => {
    expect(decodeUrl(await chinaTradeUrl(queryUrl(decode(original.split('/').at(-1)!)), names))).toEqual(decode(confirmed));
  });

  it('preserves rare-item stat IDs, values, disabled filters and category without inventing a name', async () => {
    const query = {
      status: { option: 'securable' },
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043', value: { min: 60, max: 100 }, disabled: true }, { id: 'pseudo.pseudo_total_elemental_resistance', value: { min: 32 } }] }],
      filters: { type_filters: { filters: { category: { option: 'accessory.belt' } } }, trade_filters: { filters: { price: { max: 5, option: 'divine' } } } },
    };
    expect(decodeUrl(await chinaTradeUrl(queryUrl(query), names, '另一个赛季'))).toEqual(query);
  });

  it('translates a base in an option object without losing its discriminator', async () => {
    const dictionary = new Map([['pearl ring', { c: '珠玉戒指' }]]);
    const result = decodeUrl(await chinaTradeUrl(queryUrl({ type: { option: 'Pearl Ring', discriminator: 'test' }, stats: [] }), dictionary));
    expect(result.type).toEqual({ option: '珠玉戒指', discriminator: 'test' });
  });

  it('keeps a confirmed Chinese query intact when only the league changes', async () => {
    const url = await chinaTradeUrl(`https://poe.game.qq.com/trade2/search/poe2/old/${confirmed}`, names, '测试赛季');
    expect(decodeUrl(url)).toEqual(decode(confirmed));
    expect(decodeURIComponent(new URL(url).pathname.split('/')[4]!)).toBe('测试赛季');
  });

  it('reports an unmapped name instead of dropping the item filter', async () => {
    await expect(chinaTradeUrl(queryUrl({ name: 'Unknown Unique', stats: [] }), names)).rejects.toThrow('Unknown Unique');
    await expect(chinaTradeUrl(queryUrl({ type: 'Unknown Base', stats: [] }), names)).rejects.toThrow('Unknown Base');
  });

  it('rejects empty conditions, malformed payloads, foreign hosts and blank leagues', async () => {
    await expect(chinaTradeUrl(queryUrl({}), names)).rejects.toThrow('为空');
    await expect(chinaTradeUrl(original.replace(/H4sI.*$/, 'invalid'), names)).rejects.toThrow();
    await expect(chinaTradeUrl(original.replace('www.pathofexile.com', 'example.com'), names)).rejects.toThrow('无法识别');
    await expect(chinaTradeUrl(original, names, ' ')).rejects.toThrow('赛季');
  });
});
