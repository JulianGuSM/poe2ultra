import { normalize } from '@/lib/translation/vendor/glossary.js';

/** Confirmed by a working search supplied by the user; editable in extension settings. */
export const DEFAULT_CHINA_LEAGUE = '周年庆巅峰挑战';
export interface TradeLinkResult { url?: string; error?: string }
export type TradeNames = Map<string, { c?: string }>;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);

// The source search omits this base. Both fields were verified in the user's China realm search.
const VERIFIED_UNIQUE_BASES: Record<string, string> = { '永恒紧缩之戒': '珠玉戒指' };

async function transform(bytes: Uint8Array<ArrayBuffer>, codec: CompressionStream | DecompressionStream) {
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  return new Uint8Array(await new Response(stream.pipeThrough(codec)).arrayBuffer());
}

async function readQuery(source: string): Promise<JsonObject> {
  const url = new URL(source);
  if (!['www.pathofexile.com', 'poe.game.qq.com'].includes(url.hostname) || url.protocol !== 'https:' || !url.pathname.startsWith('/trade2/search/')) {
    throw new Error('无法识别装备市集链接。');
  }
  let raw: unknown;
  if (url.searchParams.has('q')) raw = JSON.parse(url.searchParams.get('q')!);
  else {
    const encoded = url.pathname.split('/').at(-1)!;
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    raw = JSON.parse(new TextDecoder().decode(await transform(bytes, new DecompressionStream('gzip'))));
  }
  if (!object(raw)) throw new Error('装备搜索条件格式无效。');
  const query = 'query' in raw ? raw.query : raw;
  if (!object(query) || !Object.keys(query).length) throw new Error('装备搜索条件为空。');
  return query;
}

function translateName(value: unknown, names: TradeNames): unknown {
  if (object(value) && typeof value.option === 'string') return { ...value, option: translateName(value.option, names) };
  if (typeof value !== 'string') throw new Error('装备名称或基底格式无效。');
  if (!value || /[\u3400-\u9fff]/.test(value)) return value;
  const translated = names.get(normalize(value))?.c?.trim();
  if (!translated) throw new Error(`术语表中缺少“${value}”的国服名称，请在设置中补充术语表。`);
  return translated;
}

/** Convert identifiers expressed as names, leaving stat IDs, thresholds and all other filters intact. */
export async function chinaTradeUrl(source: string, names: TradeNames, league = DEFAULT_CHINA_LEAGUE): Promise<string> {
  if (!league.trim() || league.length > 120) throw new Error('请在设置中填写有效的国服市集赛季。');
  const query = await readQuery(source);
  for (const field of ['name', 'type'] as const) {
    if (query[field] !== undefined) query[field] = translateName(query[field], names);
  }
  if (!query.type && typeof query.name === 'string' && VERIFIED_UNIQUE_BASES[query.name]) query.type = VERIFIED_UNIQUE_BASES[query.name];
  const bytes = await transform(new TextEncoder().encode(JSON.stringify(query)), new CompressionStream('gzip'));
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `https://poe.game.qq.com/trade2/search/poe2/${encodeURIComponent(league.trim())}/${encoded}`;
}
