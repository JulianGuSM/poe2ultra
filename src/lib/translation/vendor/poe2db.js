/**
 * poe2db.tw 术语页直查。
 *
 * 比起「搜索」，按术语直接构造 URL 更精确、也更省：poe2db 的术语页形如
 *   https://poe2db.tw/{us|cn|tw}/<Slug>
 * 其中 us=英文原文、cn=简中、tw=繁中（站点还有 kr/ru/jp/… 但我们只要这三种）。
 *
 * 查询策略：**cn 与 tw 是两套译名，都要抓**（见 ZH_LOCALES / lookupTerms）；
 * us 页标题就是英文原名，只在中文页都没命中时兜底。
 *
 * Slug 规则是从术语表里 2244 条真实来源链接反推出来的，可复现 95.5%：
 *   1. 去掉撇号（Adonia's Ego → Adonias_Ego）
 *   2. 空格换成下划线
 *   3. 逐词 URL 编码（Atziri, the Red Queen → Atziri%2C_the_Red_Queen）
 *   4. 去掉词尾的 ! ? （Cannons, Ready! → Cannons%2C_Ready）
 * 剩下约 4.5% 是页面 slug 与显示名不同源的（如 Absorbed → Damage_Absorption），
 * 构造出来会 404，交给调用方回退到搜索。
 *
 * tools/analyze-slugs.mjs 会拿真实数据复核这个比例。
 */
import { TranslateError, httpGet } from './api-base.js';
import { cacheKeyOf, cacheSize, clearCache, readCached, writeCached } from './cache.js';

export const POE2DB_ORIGIN = 'https://poe2db.tw';
export const POE2DB_CACHE_KEY = 'poe2dbCache';
export const DEFAULT_LOCALES = ['us', 'cn', 'tw'];
export const LOCALE_LABELS = { us: '英文原文', cn: '简中', tw: '繁中' };

/**
 * 中文语言页：同一个术语在这里多半是**两套译名**（简中 / 繁中各一套），
 * 所以一次直查要为每个术语把这两种都抓下来，一起交给模型，
 * 目标语言是简中就用 cn 那套、繁体就用 tw 那套。
 */
export const ZH_LOCALES = ['cn', 'tw'];

/** 英文原文页：它给的只是英文原名，没有中译增量，所以只在中文页一个都没抓到时兜底确认。 */
export const EN_LOCALE = 'us';

/**
 * 一次直查实际会尝试的语言顺序：中文页在前（preferLocale 最优先），us 兜底放在最后。
 * 背景脚本、设置页「测试直查」和测试都用它，保证展示的顺序＝真实请求顺序。
 *
 * @param {string[]} locales 设置里的语言路径
 * @param {string} preferLocale 目标语言对应的中文路径（cn 或 tw）
 * @returns {string[]}
 */
export function directLocaleOrder(locales = DEFAULT_LOCALES, preferLocale = 'cn') {
  const wanted = [
    ...new Set((Array.isArray(locales) ? locales : []).map((l) => String(l).trim().toLowerCase())),
  ].filter(Boolean);
  const zh = ZH_LOCALES.filter((l) => wanted.includes(l));
  const order = [preferLocale, ...zh.filter((l) => l !== preferLocale)].filter((l) => zh.includes(l));
  if (wanted.includes(EN_LOCALE)) order.push(EN_LOCALE);
  return order;
}

/** 清空直查页面缓存 / 查看条数（设置页用）。 */
export const clearPoe2dbCache = () => clearCache(POE2DB_CACHE_KEY);
export const poe2dbCacheSize = () => cacheSize(POE2DB_CACHE_KEY);

/** 术语名 → poe2db slug。 */
export function slugifyTerm(name) {
  return String(name ?? '')
    .replace(/[\u2018\u2019\u02bc'`]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => encodeURIComponent(word.replace(/[!?]+$/g, '')))
    .join('_');
}

export function buildTermUrl(name, locale = 'cn', origin = POE2DB_ORIGIN) {
  const slug = slugifyTerm(name);
  return `${origin}/${locale}/${slug}`;
}

export function localeLabel(locale) {
  return LOCALE_LABELS[locale] || locale || '';
}

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ',
};

function decodeEntities(text) {
  return String(text || '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从术语页 HTML 里取出该术语的本地化名称。
 * 取 <title>，去掉站名后缀（`深渊巫妖 - 流亡2编年史…` → `深渊巫妖`）。
 *
 * @param {string} html
 * @param {{term?:string, locale?:string}} options term 用于校验页面确实在讲这个词
 * @returns {{name:string, confirmed:boolean}|null}
 */
export function parseTermPage(html, options = {}) {
  const text = String(html || '');
  if (!text.trim()) return null;

  const titleMatch = text.match(TITLE_RE);
  if (!titleMatch) return null;

  let title = decodeEntities(titleMatch[1]);
  const dash = title.indexOf(' - ');
  if (dash > 0) title = title.slice(0, dash).trim();
  if (!title) return null;

  // 页面上应出现该术语的原文（英文页是标题本身，中文页在正文里）
  const term = String(options.term || '').trim();
  const confirmed = term
    ? new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(term)}([^A-Za-z0-9]|$)`, 'i').test(text)
    : false;

  return { name: title, confirmed };
}

/**
 * 抓一个术语页（带缓存）。
 * @returns {Promise<{ok:boolean, url:string, locale:string, fromCache:boolean,
 *                    name?:string, confirmed?:boolean}>}
 *          ok=false 表示这个 slug 不存在（HTTP 404）或解析不出内容
 */
export async function fetchTermPage(name, options = {}) {
  const {
    locale = 'cn',
    origin = POE2DB_ORIGIN,
    signal,
    timeoutMs = 15000,
    useCache = true,
  } = options;

  const url = buildTermUrl(name, locale, origin);
  const cacheId = cacheKeyOf(url);

  if (useCache) {
    const cached = await readCached(POE2DB_CACHE_KEY, cacheId);
    if (cached) {
      return cached.missing
        ? { ok: false, url, locale, fromCache: true }
        : { ok: true, url, locale, fromCache: true, name: cached.name, confirmed: cached.confirmed };
    }
  }

  const res = await httpGet(url, { signal, timeoutMs });

  // poe2db 用 404 表示「这个术语页不存在」，记下来免得每次翻译都重打
  if (res.status === 404) {
    if (useCache) await writeCached(POE2DB_CACHE_KEY, cacheId, { missing: true });
    return { ok: false, url, locale, fromCache: false };
  }
  if (!res.ok) {
    throw new TranslateError(`poe2db 返回 HTTP ${res.status}：${url}`, { status: res.status });
  }

  const parsed = parseTermPage(await res.text(), { term: name, locale });
  if (!parsed) return { ok: false, url, locale, fromCache: false };

  const value = { name: parsed.name, confirmed: parsed.confirmed };
  if (useCache) await writeCached(POE2DB_CACHE_KEY, cacheId, value);
  return { ok: true, url, locale, fromCache: false, ...value };
}

/**
 * 批量直查：**每个术语把中文页（cn/tw）都抓一遍**，收集多套译名，不再「命中一个就停」。
 *
 * 之所以要两套：poe2db 的 cn / tw 是同一页面的两种中文版本，标题就是各自语言下的正式名称
 * （Abyssal Lich → 深渊巫妖 / 深淵巫妖）。术语表里没收录的词，一次把简繁两套都拿回来，
 * 模型翻译时按目标语言取用，也避免了「cn 页恰好 404、tw 页有」这种情况白跑一趟。
 *
 * us（英文原文）页的标题就是英文原名本身，对中译没有增量，所以只在某个术语的中文页
 * 一个都没抓到时，才作为「这页到底存不存在」的兜底请求。
 *
 * 预算只统计真正发出的请求（缓存命中不计），避免一次翻译打太多页面。
 *
 * @param {string[]} terms 未收录的候选术语
 * @param {{locales?:string[], preferLocale?:string, limit?:number, budget?:number}} options
 * @returns {Promise<{hits:Array, requested:number, notes:string[]}>}
 *          hits 里同一术语可能有多条（每条一个语言页）
 */
export async function lookupTerms(terms, options = {}) {
  const {
    locales = DEFAULT_LOCALES,
    preferLocale = 'cn',
    limit = 3,
    budget = 8,
    signal,
    timeoutMs = 15000,
    useCache = true,
  } = options;

  const order = directLocaleOrder(locales, preferLocale);
  const zhOrder = order.filter((l) => l !== EN_LOCALE); // 中文页：全都要
  const tryEn = order.includes(EN_LOCALE); // us 页：只在中文页全落空时兜底
  const hits = [];
  const notes = [];
  let requested = 0;
  let budgetNoted = false;

  /** 发一个页面的请求；返回命中对象、null（404/解析不出）或 false（网络/权限问题，换语言也没用）。 */
  const grab = async (term, locale) => {
    if (requested >= budget) {
      if (!budgetNoted) {
        notes.push(`已达单次请求上限 ${budget}，未继续尝试「${term}」`);
        budgetNoted = true;
      }
      return null;
    }
    try {
      const res = await fetchTermPage(term, { locale, signal, timeoutMs, useCache });
      if (!res.fromCache) requested++;
      if (!res.ok) return null; // 404：换下一种语言
      return {
        term,
        locale: res.locale,
        url: res.url,
        name: res.name,
        confirmed: res.confirmed,
        fromCache: res.fromCache,
      };
    } catch (err) {
      if (err?.message === '已取消翻译。') throw err;
      notes.push(`「${term}」直查 ${locale} 页失败：${err?.message || err}`);
      return false; // 网络/权限问题，换语言也没用
    }
  };

  for (const term of terms.slice(0, limit)) {
    const termHits = [];
    let stalled = false;

    // ① 中文页：cn、tw 都要，命中不停手
    for (const locale of zhOrder) {
      const hit = await grab(term, locale);
      if (hit === false) {
        stalled = true;
        break;
      }
      if (hit) termHits.push(hit);
    }

    // ② 中文页一个都没命中（404 或 slug 跟显示名不同源）时，才用 us 页确认一下
    if (!termHits.length && tryEn && !stalled) {
      const hit = await grab(term, EN_LOCALE);
      if (hit === false) stalled = true;
      else if (hit) termHits.push(hit);
    }

    hits.push(...termHits);

    // 预算用尽：后面的术语也不用试了（备注已经写过一条）
    if (requested >= budget) break;
  }

  return { hits, requested, notes };
}
