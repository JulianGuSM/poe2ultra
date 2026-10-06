/**
 * Tavily 检索客户端（本地术语表没覆盖时用来查 poe2db.tw）。
 *
 * 只被 background 使用：API Key 不能出现在页面上下文。
 * 结果带本地缓存，避免同一段文本反复消耗额度。
 */
import { TranslateError, withRequest } from './api-base.js';
import { cacheKeyOf, cacheSize, clearCache, readCached, writeCached } from './cache.js';

export const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
export const DEFAULT_DOMAINS = ['poe2db.tw'];
/**
 * poe2db.tw 的语言路径：/us/ 英文原文、/cn/ 简中、/tw/ 繁中。
 * Tavily 的 include_domains 只能限到域名、限不到路径，所以拿到结果后
 * 按这里的语言前缀再过滤一次，把 /jp/ /kr/ 之类的其它语言页挡掉。
 */
export const DEFAULT_LOCALES = ['us', 'cn', 'tw'];
/**
 * 默认取 6 条而不是 3 条：结果要按 slug 聚合成「一页一条」，要多留几条才凑得齐
 * 同一页面的 /cn/ 与 /tw/ 两种中文版本。Tavily 按请求计费（basic search 1 次 = 1 credit），
 * 同一次请求里多要几条不会多花钱。
 */
export const DEFAULT_MAX_RESULTS = 6;
export const CACHE_STORAGE_KEY = 'tavilyCache';

const STATUS_HINTS = {
  400: 'Tavily 拒绝了请求，请检查查询内容与参数。',
  401: 'Tavily API Key 无效，请到设置页重新填写。',
  403: 'Tavily 拒绝访问，可能是 Key 权限或套餐限制。',
  429: 'Tavily 触发限流（免费额度通常每月 1000 次），请稍后再试。',
  432: 'Tavily 用量或套餐额度已用尽。',
  433: '该 Tavily 功能需要付费套餐。',
};

export function normalizeDomains(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\s]+/);
  const out = list
    .map((d) => String(d).trim().toLowerCase())
    .map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  return out.length ? [...new Set(out)] : [...DEFAULT_DOMAINS];
}

/** 语言路径列表，如 ['us','cn','tw']；留空表示不按语言过滤。 */
export function normalizeLocales(raw) {
  if (raw === '' || raw === null || raw === undefined) return [...DEFAULT_LOCALES];
  if (Array.isArray(raw) && raw.length === 0) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/);
  const out = list
    .map((l) => String(l).trim().toLowerCase().replace(/^\/+|\/+$/g, ''))
    .filter((l) => /^[a-z]{2}(-[a-z]{2})?$/.test(l));
  return [...new Set(out)];
}

/**
 * 取 URL 命中的语言路径。只认 poe2db.tw 的 /us/ /cn/ /tw/ 这类首页路径段，
 * 因此 https://poe2db.tw/cn/Abyssal_Lich 与带 www./http/查询串/锚点的写法都能识别。
 */
export function localeOf(url, locales = DEFAULT_LOCALES) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'poe2db.tw') return '';
  const first = parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '';
  return locales.includes(first) ? first : '';
}

/**
 * 排序权重：目标语言对应页 → 另一种中文版本（简繁要成对给出）→ 英文原文 → 其它。
 * 英文原文排在中译之后：它没有中译增量，放前面只会挤掉真正要看的中文页。
 */
function localeRank(locale, preferLocale) {
  if (preferLocale && locale === preferLocale) return 0;
  if (locale === 'cn' || locale === 'tw') return 1;
  if (locale === 'us') return 2;
  return 3;
}

export function sortByLocalePreference(results, preferLocale = '') {
  return [...results]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => localeRank(a.r.locale, preferLocale) - localeRank(b.r.locale, preferLocale) || a.i - b.i)
    .map((x) => x.r);
}

/** URL → 去掉语言段的 slug：https://poe2db.tw/cn/Abyssal_Lich → Abyssal_Lich。 */
export function slugOf(url) {
  try {
    const parts = new URL(String(url)).pathname.split('/').filter(Boolean);
    return parts.slice(1).join('/');
  } catch {
    return '';
  }
}

/** URL → 域名（去掉 www.），聚合时用来避免把不同站点的同名 slug 混在一起。 */
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url || '');
  }
}

/** slug → 英文术语显示名：Atziri%2C_the_Red_Queen → Atziri, the Red Queen。 */
export function termOfSlug(slug) {
  let text = String(slug || '');
  try {
    text = decodeURIComponent(text);
  } catch {
    /* slug 里有非法百分号编码时保持原样 */
  }
  return text.replace(/_/g, ' ').trim();
}

/**
 * 搜索结果标题 → 术语名。
 * Tavily 给的标题常带站名后缀（`深渊巫妖 - 流亡2编年史` / `Abyssal Lich | PoE2DB`），
 * 只取第一段；用「空格 + 分隔符 + 空格」判定，`Ice-Tipped` 这类连字符术语不会被切坏。
 */
export function nameFromTitle(title) {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const cut = text.split(/\s+[|｜\-–—]\s+/)[0].trim();
  return cut || text;
}

/**
 * 同一页面（同域名 + 同 slug）的不同语言版本聚合成一条。
 * poe2db 的 /cn/ 与 /tw/ 是同一页的两种中文版本，标题各自是该语言下的正式名称，
 * 分开列会让模型以为它们是两个术语；聚合后 `深渊巫妖（简中）/ 深淵妖巫（繁中）` 并排。
 */
export function groupBySlug(results, preferLocale = '') {
  const groups = new Map();
  for (const r of results) {
    const slug = r.slug || slugOf(r.url) || r.url;
    const key = `${hostOf(r.url)}|${slug}`;
    let group = groups.get(key);
    if (!group) {
      group = { slug, term: termOfSlug(slug), variants: [], score: r.score };
      groups.set(key, group);
    }
    group.variants.push(r);
    if (r.score !== null && (group.score === null || r.score > group.score)) group.score = r.score;
  }

  return [...groups.values()].map((group) => {
    // 首选语言（目标语言）排最前，其余按 cn → tw → us 的常规顺序
    group.variants = sortByLocalePreference(group.variants, preferLocale);
    const primary = group.variants[0];
    return {
      ...primary,
      slug: group.slug,
      term: group.term,
      score: group.score,
      variants: group.variants.map((v) => ({
        locale: v.locale,
        title: v.title,
        name: nameFromTitle(v.title) || v.url,
        url: v.url,
        snippet: v.snippet,
      })),
    };
  });
}

/**
 * Tavily 结果 → 精简结构。
 * 有配置语言路径时，只保留 /us/ /cn/ /tw/ 这类页面的结果（Tavily 限不到路径，
 * 只能在拿到结果后过滤），再按 slug 把同一页面的简中/繁中聚合成一条，
 * 最后按「目标语言 → 英文原文 → 其它」重排、按页面数截断。
 */
export function mapResults(json, limit = DEFAULT_MAX_RESULTS, options = {}) {
  const list = Array.isArray(json?.results) ? json.results : [];
  const locales = normalizeLocales(options.locales);

  const mapped = list
    .map((r) => {
      const url = String(r?.url || '').trim();
      const slug = slugOf(url);
      return {
        title: String(r?.title || url || '').trim(),
        url,
        slug,
        snippet: String(r?.content || '').replace(/\s+/g, ' ').trim().slice(0, 320),
        score: Number.isFinite(Number(r?.score)) ? Number(r.score) : null,
        locale: localeOf(url, locales),
      };
    })
    .filter((r) => r.url);

  const filtered = locales.length ? mapped.filter((r) => r.locale) : mapped;
  const grouped = groupBySlug(filtered, options.preferLocale);
  const ordered = grouped
    .map((g, i) => ({ g, i }))
    .sort(
      (a, b) =>
        localeRank(a.g.locale, options.preferLocale) - localeRank(b.g.locale, options.preferLocale) ||
        a.i - b.i
    )
    .map((x) => x.g);
  return ordered.slice(0, Math.max(1, limit));
}

/**
 * 发一次 Tavily 检索。
 * @returns {Promise<{query:string, results:Array, fromCache?:boolean, elapsedMs?:number}>}
 */
export async function searchTavily(options) {
  const {
    apiKey,
    query,
    maxResults = DEFAULT_MAX_RESULTS,
    domains = DEFAULT_DOMAINS,
    locales = DEFAULT_LOCALES,
    preferLocale = '',
    timeoutMs = 20000,
    signal,
    useCache = true,
  } = options;

  const key = String(apiKey || '').trim();
  if (!key) throw new TranslateError('尚未配置 Tavily API Key。', { hint: '到设置页填写，或关闭「术语表缺失时联网补充」。' });

  const text = String(query || '').trim();
  if (!text) throw new TranslateError('检索内容为空。');

  const includeDomains = normalizeDomains(domains);
  const localePaths = normalizeLocales(locales);
  const limit = Math.max(1, Math.min(Number(maxResults) || DEFAULT_MAX_RESULTS, 10));
  const cacheId = cacheKeyOf(text, includeDomains, limit, localePaths);
  const mapOptions = { locales: localePaths, preferLocale };

  if (useCache) {
    const cachedResults = await readCached(CACHE_STORAGE_KEY, cacheId);
    if (cachedResults) return { query: text, results: cachedResults, fromCache: true };
  }

  const startedAt = Date.now();
  const json = await withRequest(
    {
      endpoint: TAVILY_ENDPOINT,
      apiKey: key,
      body: {
        query: text,
        search_depth: 'basic',
        max_results: limit,
        include_domains: includeDomains,
        include_answer: false,
        include_raw_content: false,
        topic: 'general',
      },
      timeoutMs,
      signal,
    },
    async (res) => {
      if (res.ok) return res.json();
      let detail = '';
      try {
        const raw = await res.text();
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.detail?.error || parsed?.detail || parsed?.message || raw.slice(0, 200);
        } catch {
          detail = raw.slice(0, 200);
        }
      } catch {
        /* 忽略 */
      }
      const hint = STATUS_HINTS[res.status] || '请稍后重试，或关闭联网补充。';
      throw new TranslateError(
        `Tavily 检索失败（HTTP ${res.status}）：${typeof detail === 'string' && detail ? detail : hint}`,
        { status: res.status, hint }
      );
    }
  );

  const results = mapResults(json, limit, mapOptions);
  if (useCache && results.length) await writeCached(CACHE_STORAGE_KEY, cacheId, results);
  return { query: text, results, fromCache: false, elapsedMs: Date.now() - startedAt, locales: localePaths };
}

/* --------------------------------------------------- chrome.storage 缓存 */

export const clearTavilyCache = () => clearCache(CACHE_STORAGE_KEY);
export const tavilyCacheSize = () => cacheSize(CACHE_STORAGE_KEY);
