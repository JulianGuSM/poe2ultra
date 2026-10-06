import { loadGlossary, extractTerms, extractCandidates, buildSearchQuery } from './vendor/glossary.js';
import { lookupTerms } from './vendor/poe2db.js';
import { searchTavily } from './vendor/tavily.js';
const parseLocaleList = (raw, fallback = 'us,cn,tw') =>
  String(raw ?? fallback)
    .split(/[,\s]+/)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

/**
 * 术语增强：本地术语表 → poe2db 直查（按术语构造页面 URL）→ Tavily 兜底。
 * 任何一步失败都不应该让翻译失败，只记一条 warning。
 */
export async function collectContext(settings, input, signal, suppliedGlossary) {
  const result = {
    terms: [],
    direct: [],
    sources: [],
    warnings: [],
    glossarySource: '',
    notes: [],
    // 面板要能回答「术语表这次到底干了什么」，所以把状态一并带出去
    glossary: { enabled: true, source: '', size: 0, matched: 0, categories: [], error: '' },
  };
  if (settings.glossaryEnabled === false) {
    result.glossary.enabled = false;
    return result;
  }

  let index = null;
  try {
    const glossary = suppliedGlossary ?? await loadGlossary();
    index = glossary.index;
    result.glossarySource = glossary.source;
    result.glossary.source = glossary.source;
    result.glossary.size = glossary.index.size;
  } catch (err) {
    const message = err?.message || String(err);
    result.glossary.error = message;
    result.warnings.push(`术语表读取失败：${message}`);
    return result;
  }

  const categories = String(settings.glossaryCategories || '')
    .split(/[,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (categories.length) result.glossary.categories = categories;

  try {
    result.terms = extractTerms(input.text, index, {
      maxTerms: settings.glossaryMaxTerms,
      categories: categories.length ? categories : null,
    });
    result.glossary.matched = result.terms.length;
  } catch (err) {
    result.warnings.push(`术语抽取失败：${err?.message || err}`);
  }

  // 纯中文/无英文的选区没有可检索的英文术语（本流程只做英译中）
  if (!/[A-Za-z]/.test(input.text)) return result;

  const candidates = extractCandidates(input.text, result.terms, Number(settings.poe2dbMaxTerms) || 3);
  const localeList = parseLocaleList(settings.poe2dbLocales);
  const preferLocale = /繁|繁體/.test(String(settings.targetLang || '')) ? 'tw' : 'cn';

  // ② poe2db 直查：按术语构造 https://poe2db.tw/<locale>/<slug>，cn/tw 两套译名都要
  if (settings.poe2dbDirectEnabled !== false && candidates.length) {
    try {
      const { hits, requested, notes } = await lookupTerms(candidates, {
        locales: localeList,
        preferLocale,
        limit: Number(settings.poe2dbMaxTerms) || 3,
        budget: Number(settings.poe2dbRequestBudget) || 8,
        signal,
      });
      result.direct = hits;
      result.directRequested = requested;
      result.directTried = candidates.slice(0, Number(settings.poe2dbMaxTerms) || 3).length;
      result.notes.push(...notes);
    } catch (err) {
      if (err?.message === '已取消翻译。') throw err;
      result.warnings.push(`poe2db 直查失败：${err?.message || err}`);
    }
  }

  // ③ Tavily 兜底：只处理直查没解决的候选词；直查已全覆盖就不花这笔额度
  if (settings.tavilyEnabled === false) return result;
  if (!String(settings.tavilyApiKey || '').trim()) return result;

  const resolved = new Set(result.direct.map((d) => d.term.toLowerCase()));
  const remaining = candidates.filter((c) => !resolved.has(c.toLowerCase()));
  const noTermAtAll = result.terms.length === 0 && candidates.length === 0;
  if (!remaining.length && !noTermAtAll) return result;

  const query = buildSearchQuery(remaining, input.text, 200);
  if (!query) return result;

  try {
    const { results } = await searchTavily({
      apiKey: settings.tavilyApiKey,
      query,
      maxResults: settings.tavilyMaxResults,
      domains: String(settings.tavilyDomains || 'poe2db.tw').split(/[,\s]+/),
      locales: localeList,
      preferLocale,
      signal,
    });
    result.sources = results;
  } catch (err) {
    result.warnings.push(`Tavily 补充失败：${err?.message || err}`);
  }
  return result;
}


