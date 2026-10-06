/**
 * 本地 POE2 术语表：加载、索引、从原文里抽取命中的术语。
 *
 * 数据来源是打包进扩展的 data/glossary.json（由 tools/build-glossary.mjs 从
 * 上游 JSONL 生成）；用户在设置页导入的术语表会存进 chrome.storage.local，
 * 优先级高于内置数据。
 *
 * buildIndex / extractTerms / compactRows 都是纯函数，Node 里可直接测。
 */

export const GLOSSARY_URL = 'data/glossary.json';
export const OVERRIDE_KEY = 'glossaryOverride';

/* --------------------------------------------------------------- 打包 */

/** 把上游 JSONL 的一行压成精简结构。 */
export function compactRow(raw) {
  return {
    i: String(raw?.term_id ?? raw?.i ?? ''),
    e: String(raw?.en ?? raw?.e ?? ''),
    c: String(raw?.zh_cn ?? raw?.c ?? ''),
    t: String(raw?.zh_tw ?? raw?.t ?? ''),
    k: String(raw?.category ?? raw?.k ?? ''),
    q: String(raw?.quality ?? raw?.q ?? ''),
    s: String(raw?.sources?.zh_cn ?? raw?.s ?? ''),
  };
}

export function compactRows(rows) {
  const entries = [];
  let skipped = 0;
  for (const raw of rows) {
    const row = compactRow(raw);
    if (!row.e && !row.c && !row.t) {
      skipped++;
      continue;
    }
    entries.push(row);
  }
  return { meta: { ...describeIndex(entries), skipped }, entries };
}

function describeIndex(entries) {
  let maxEnWords = 1;
  for (const e of entries) {
    if (e.e) maxEnWords = Math.max(maxEnWords, normalize(e.e).split(' ').filter(Boolean).length);
  }
  return {
    count: entries.length,
    maxEnWords: Math.min(maxEnWords, 8), // 上游最长 6 词，留点余量并封顶，避免退化成 O(n²)
  };
}

/* --------------------------------------------------------------- 导入 */

/**
 * 解析用户导入的术语表文本，兼容四种形态：
 *   1. 上游 JSONL（每行一个 JSON 对象）——它也以 `{` 开头，**不能**直接当成
 *      单个 JSON 文档，否则会报 "Unexpected non-whitespace character after JSON"
 *   2. 精简 JSON：{ meta, entries: [...] }
 *   3. 纯数组：[ {...}, {...} ]
 *   4. 单条记录：{ term_id: ..., en: ... }
 *
 * @returns {object[]} 原始记录数组（长字段或短字段都行，交给 compactRows 归一化）
 */
export function parseGlossaryText(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error('文件是空的');

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('文件顶层不是数组');
    return parsed;
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed); // 整份能解析 → 精简格式或单条记录
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.entries)) return parsed.entries;
      return [parsed];
    } catch {
      return parseJsonl(trimmed); // 整份解析不了 → 当作 JSONL
    }
  }

  return parseJsonl(trimmed);
}

function parseJsonl(trimmed) {
  const rows = [];
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`第 ${i + 1} 行不是合法 JSON：${err.message}`);
    }
  }
  return rows;
}

/* --------------------------------------------------------------- 归一化 */

/**
 * 统一大小写、弯引号、各种连字符与空白，让「Well-Read」和「well read」能对上。
 * 注意必须包含 ASCII 连字符（One-Handed / Ice-Tipped Arrows 这类术语表条目），
 * 否则术语键里留着 '-' 而正文被切成两个词，永远匹配不上。
 */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u002d\u2010-\u2015\u2212]/g, ' ')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EN_TOKEN = /[\p{L}\p{N}][\p{L}\p{N}']*/gu;

function tokenize(text) {
  return [...text.matchAll(EN_TOKEN)].map((m) => ({ value: m[0], index: m.index }));
}

/* --------------------------------------------------------------- 索引 */

/**
 * 建立检索索引。只建英文表 —— 本插件的用途是「英文 POE2 内容 → 中文」，
 * 只需要从原文里认出英文术语，不需要中文反查（反查既用不上，又会因为
 * 国服简中/国际服繁中译名不同而引入歧义，比如 盛怒 同时是 Berserk 的简中名
 * 和 Rage 的繁中名）。简中(c)/繁中(t) 两条**都会进上下文**：
 * 一次翻译要同时出简中与繁中两版，只给一列的话另一版就只能靠字形转换。
 *
 * @returns {{en:Map, maxWords:number, size:number, collisions:number}}
 *          collisions = 英文写法相同但属于不同条目的数量（英译中会取先出现的一条）
 */
export function buildIndex(glossary) {
  const entries = Array.isArray(glossary?.entries)
    ? glossary.entries
    : Array.isArray(glossary)
      ? glossary
      : [];
  const en = new Map();
  let collisions = 0;

  for (const entry of entries) {
    const key = normalize(entry.e);
    if (!key) continue;
    const prev = en.get(key);
    if (!prev) {
      en.set(key, entry);
    } else if (prev.i !== entry.i) {
      collisions++; // 同一条目重复登记不算
    }
  }

  const meta = describeIndex(entries);
  return { en, maxWords: meta.maxEnWords, size: entries.length, collisions };
}

/* --------------------------------------------------------------- 抽取 */

/**
 * 单复数变体，只在精确匹配失败时兜底用。
 * PoE 文本里复数满地都是（Minions / Splinters / Charges），而术语表里往往只收单数，
 * 不做这层兜底就会漏掉大量本该命中的术语。
 */
export function wordVariants(word) {
  const w = String(word || '');
  const out = [];
  const add = (v) => {
    if (v && v !== w && !out.includes(v)) out.push(v);
  };

  // 复数 → 单数
  if (/ies$/.test(w) && w.length > 4) add(w.replace(/ies$/, 'y')); // entities → entity
  if (/ves$/.test(w) && w.length > 4) {
    add(w.replace(/ves$/, 'f')); // wolves → wolf
    add(w.replace(/ves$/, 'fe')); // lives → life
  }
  if (/(ches|shes|xes|zes|ses)$/.test(w)) add(w.replace(/es$/, '')); // charges → charge
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) add(w.replace(/s$/, '')); // splinters → splinter

  // 单数 → 复数
  if (/[^aeiou]y$/.test(w)) add(`${w.slice(0, -1)}ies`); // entity → entities
  else if (/(x|z|ch|sh)$/.test(w)) add(`${w}es`); // box → boxes
  else if (!/(s|x|z|ch|sh)$/.test(w)) add(`${w}s`); // splinter → splinters

  return out;
}

/**
 * 从原文里抽命中术语。只在英文表里做「最长优先」的贪心匹配：
 * 命中后跳过整段，天然避免长术语内部再匹配出短词；
 * 精确形式查不到时，会拿最后一个词的单复数变体再试一次。
 *
 * @param {string} text
 * @param {object} index buildIndex 的结果
 * @param {{maxTerms?:number, categories?:string[]|null, minEnLength?:number}} options
 */
export function extractTerms(text, index, options = {}) {
  const maxTerms = Math.max(1, Number(options.maxTerms) || 20);
  const categories = options.categories?.length ? new Set(options.categories) : null;
  const minEnLength = Number(options.minEnLength) || 3;
  const normalized = normalize(text);
  const hits = new Map(); // term_id -> hit

  const accept = (entry, matched, at) => {
    if (categories && !categories.has(entry.k)) return;
    const id = entry.i || `${entry.e}|${entry.c}`;
    const prev = hits.get(id);
    if (!prev || matched.length > prev.matched.length) {
      hits.set(id, { entry, matched, at });
    }
  };

  const tokens = tokenize(normalized);
  let i = 0;
  while (i < tokens.length) {
    let found = null;
    for (let len = Math.min(index.maxWords, tokens.length - i); len >= 1; len--) {
      const phrase = tokens.slice(i, i + len).map((t) => t.value).join(' ');
      if (phrase.length < minEnLength) continue;

      let entry = index.en.get(phrase);
      if (entry) {
        found = { entry, matched: phrase, at: tokens[i].index, span: len };
        break;
      }

      // 兜底：把最后一个词换成单复数变体再试（"Simulacrum Splinters" → "simulacrum splinter"）
      const head = tokens.slice(i, i + len - 1).map((t) => t.value).join(' ');
      for (const variant of wordVariants(tokens[i + len - 1].value)) {
        const alt = head ? `${head} ${variant}` : variant;
        entry = index.en.get(alt);
        if (entry) {
          // matched 记原文里真实出现的形式，en 仍是术语表的规范写法
          found = { entry, matched: phrase, at: tokens[i].index, span: len };
          break;
        }
      }
      if (found) break;
    }
    if (found) {
      accept(found.entry, found.matched, found.at);
      i += found.span;
    } else {
      i++;
    }
  }

  return [...hits.values()]
    .sort((a, b) => b.matched.length - a.matched.length || a.at - b.at)
    .slice(0, maxTerms)
    .sort((a, b) => a.at - b.at)
    .map((hit) => ({
      id: hit.entry.i,
      en: hit.entry.e,
      zh_cn: hit.entry.c,
      zh_tw: hit.entry.t,
      category: hit.entry.k,
      quality: hit.entry.q,
      source: hit.entry.s,
      matched: hit.matched,
    }));
}

/* --------------------------------------------------- 候选词（喂给 Tavily） */

const STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'there', 'then', 'they', 'them', 'their',
  'and', 'but', 'for', 'with', 'from', 'into', 'over', 'under', 'when', 'while',
  'you', 'your', 'can', 'will', 'would', 'should', 'could', 'have', 'has', 'are',
  'was', 'were', 'not', 'all', 'any', 'each', 'every', 'more', 'most', 'some',
  'gains', 'gain', 'deals', 'deal', 'damage', 'increased', 'reduced', 'adds',
  'grants', 'grant', 'gives', 'give', 'unique', 'skill', 'skills', 'amulet',
  'ring', 'rings', 'belt', 'boots', 'gloves', 'helmet', 'body', 'armour',
  'weapon', 'shield', 'jewel', 'passive', 'passives', 'support', 'supports',
  'level', 'levels', 'quality', 'effect', 'effects', 'player', 'enemies',
]);

/**
 * 抽出「像专有名词但术语表没收录」的英文片段，用于构造 Tavily 查询。
 * 优先多词大写短语，其次句中较长的单个大写词；
 * 会丢掉彼此互为子串的候选（"Recovery" ⊂ "Life Recovery"）和句首的普通大写词。
 */
export function extractCandidates(text, matchedTerms = [], limit = 3) {
  const source = String(text ?? '');
  const covered = matchedTerms.map((t) => normalize(t.matched || t.en)).filter(Boolean);

  const isCovered = (phrase) => {
    const p = normalize(phrase);
    return covered.some((c) => c === p || c.includes(p) || p.includes(c));
  };

  /** 位置是否处于句首（文本开头，或前一个非空字符是句末标点）。 */
  const isSentenceStart = (at) => {
    for (let i = at - 1; i >= 0; i--) {
      const ch = source[i];
      if (/\s/.test(ch)) continue;
      return '.!?;:'.includes(ch) || ch === '\n';
    }
    return true;
  };

  const phrases = [];
  const multi = /\b([A-Z][\p{L}'-]+(?:\s+(?:of|the|and|in|to|for)\s+)?(?:\s+[A-Z][\p{L}'-]+){1,3})\b/gu;
  for (const m of source.matchAll(multi)) {
    const phrase = m[1].trim();
    if (phrase.length < 5 || isCovered(phrase)) continue;
    phrases.push(phrase);
  }

  const singles = /\b([A-Z][\p{L}'-]{4,})\b/gu;
  for (const m of source.matchAll(singles)) {
    const word = m[1];
    if (STOPWORDS.has(normalize(word)) || isCovered(word)) continue;
    if (isSentenceStart(m.index)) continue; // 句首大写多半只是正常起句
    phrases.push(word);
  }

  // 长短语优先，并丢掉被更长候选包含的短候选
  phrases.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length);
  const out = [];
  const seen = new Set();
  for (const phrase of phrases) {
    const key = normalize(phrase);
    if (seen.has(key)) continue;
    const contained = out.some((kept) => normalize(kept).includes(key));
    if (contained) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= limit) break;
  }
  return out;
}

/** 拼一个不超过 maxLen 字符的检索查询。 */
export function buildSearchQuery(candidates, text, maxLen = 200) {
  const fromCandidates = (candidates || []).join(' ').trim();
  if (fromCandidates) return fromCandidates.slice(0, maxLen);

  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  const cut = cleaned.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

/* --------------------------------------------------------------- 加载 */

let cached = null;

async function readOverride() {
  try {
    const data = await chrome.storage.local.get([OVERRIDE_KEY]);
    return data?.[OVERRIDE_KEY] || null;
  } catch {
    return null;
  }
}

/**
 * 载入术语表并建索引（进程内缓存）。
 * @returns {Promise<{index:object, meta:object, source:'bundled'|'imported'}>}
 */
export async function loadGlossary() {
  if (cached) return cached;

  const override = await readOverride();
  if (override?.entries?.length) {
    cached = { index: buildIndex(override), meta: override.meta || {}, source: 'imported' };
    return cached;
  }

  const res = await fetch(chrome.runtime.getURL(GLOSSARY_URL));
  if (!res.ok) throw new Error(`内置术语表读取失败（HTTP ${res.status}）`);
  const data = await res.json();
  cached = { index: buildIndex(data), meta: data.meta || {}, source: 'bundled' };
  return cached;
}

/** 术语表被替换后清缓存。 */
export function invalidateGlossary() {
  cached = null;
}
