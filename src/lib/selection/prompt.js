/** Selection-only prompts, context formatting and composition. Guide translation never uses this composer. */
import { DUAL_MARKERS, isDualOutput, targetLabelOf } from '../translation/vendor/dual.js';

export const DEFAULT_SYSTEM_PROMPT = `你是一名专业的翻译引擎，负责把用户提供的文本翻译成目标语言。

规则：
1. 只输出译文本身，不要输出解释、前言、总结，也不要使用 Markdown 代码块包裹。
2. POE2 的简中与繁中是**两套互相独立的译名**，不是简繁字形转换。上下文里的术语表会同时给出
   「简中」「繁中」两列：简中译文只用简中那列，繁中译文只用繁中那列，不要互相推导。
   标为「待补」的一列没有权威译名，可自行判断用通行说法，但不要臆造、也不要用另一列顶替。
3. 保持原文的段落、换行、列表和标点结构；原文换行处译文也换行。
4. 保留代码、命令、变量名、URL、邮箱、路径、数字与单位不被改动或翻译。
5. 人名、地名、作品名、游戏术语、专业术语采用通行译名；若没有通行译名，保留原文并在首次出现时用括号补充译名。
6. 文本若已经是目标语言，原样返回，不要改写。
7. 文本若明显是断句、单词或短语，给出最贴切的对应译法即可，不要脑补上下文。`;

export const DEFAULT_USER_PROMPT = `请把下面的文本翻译成{{targetLang}}。

<text>
{{text}}
</text>`;

/**
 * 双版本模式（设置页「一次输出简中 + 繁中」）下**自动追加**到系统提示词里的格式要求。
 *
 * 之所以自动注入、而不是写死在可编辑的默认提示词里：
 * 用户改过提示词、或把双版本开关关掉再打开，格式要求都不会丢；
 * 关掉开关时它也不会残留在提示词里让模型多输出一版。
 */
export const DUAL_RULE = [
  '本次要求一次给出两版译文，必须严格按下面两个标签分段（标签各占一行、顺序固定）：',
  DUAL_MARKERS.cn,
  '（简体中文译文）',
  DUAL_MARKERS.tw,
  '（繁體中文譯文）',
  '标签内是译文本体，标签之外不要写任何解释、前言或总结；两版都要完整翻译，',
  '不能只给一版，也不能把简中译文用字形转换当成繁中译文。',
].join('\n');

/** 可在提示词里使用的占位符，设置页会展示给用户。 */
export const PLACEHOLDERS = [
  { token: '{{text}}', desc: '划词选中的原文（必填，缺失时会自动追加到末尾）' },
  { token: '{{targetLang}}', desc: '目标语言；双版本模式下固定为「简中与繁中两个版本」' },
  { token: '{{glossary}}', desc: '命中的本地术语表条目（简中 / 繁中两列）；不写也会自动前置到提示词前' },
  { token: '{{sources}}', desc: 'poe2db.tw 检索结果；不写也会自动前置到提示词前' },
  { token: '{{title}}', desc: '当前网页标题' },
  { token: '{{url}}', desc: '当前网页地址' },
  { token: '{{pageLang}}', desc: '网页声明的语言（如 en、ja）' },
];


/**
 * 渲染提示词模板。未提供 {{text}} 时自动把原文追加到末尾，避免用户误删占位符后
 * 请求里完全没有原文。
 */
export function renderTemplate(template, vars) {
  const tpl = String(template ?? '');
  let out = tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : whole
  );
  if (!/\{\{\s*text\s*\}\}/.test(tpl)) {
    out = `${out}\n\n${vars.text ?? ''}`;
  }
  return out.trim();
}

/**
 * 命中术语时始终追加术语表规则。
 * 重点说清「简繁是两套译名、不是字形转换」，否则模型很容易把简中译文用字体转换糊弄成繁中。
 */
export const TERM_RULE = [
  '翻译要求：下面提供的术语表来自本地权威术语库，每个术语都给了「简中」与「繁中」两列。',
  'PoE2 的简中与繁中是两套互相独立的译名，不是简繁字形转换：',
  '简中版必须用简中那列、繁中版必须用繁中那列，不得用字体转换互相推导，也不要另造译名。',
  '标为「待补」的一列没有权威译名，可自行判断用通行说法，但不要臆造、也不要用另一列顶替。',
].join('');

export function glossaryFormatLabel(lang) {
  const text = String(lang || '');
  if (/繁|繁体|繁中|繁體/.test(text)) return '繁體中文';
  return '简体中文';
}

/** 术语某一列的显示值；缺了就写「待补」，让模型知道这列没有权威译名。 */
function glossaryCell(value) {
  return String(value || '').trim() || '待补';
}

/**
 * 术语表 → 纯文本块（供 {{glossary}} 或自动前置）。
 *
 * **永远同时给出简中与繁中两列**：PoE2 的简繁是两套独立译名，
 * 只给目标语言那列的话，另一版就只能靠字形转换，正是要避免的事。
 * targetLang 只影响两列的先后顺序（目标语言那列排在前面）。
 */
export function formatGlossary(terms, targetLang, limit = 40) {
  const list = Array.isArray(terms) ? terms.slice(0, limit) : [];
  if (!list.length) return '';
  const twFirst = glossaryFormatLabel(targetLang) === '繁體中文';
  const lines = list.map((t) => {
    const en = t.en || t.matched || '';
    const cn = glossaryCell(t.zh_cn);
    const tw = glossaryCell(t.zh_tw);
    const cells = twFirst ? [`繁中：${tw}`, `简中：${cn}`] : [`简中：${cn}`, `繁中：${tw}`];
    const category = t.category ? `（${t.category}）` : '';
    return `- ${en} = ${cells.join(' ｜ ')}${category}`;
  });
  return [
    '【术语表 · 必须优先采用（简中 / 繁中是两套不同译名，不是字形转换）】',
    ...lines,
  ].join('\n');
}

/** poe2db.tw 的语言路径 → 人话，用于标注检索结果所属语言。 */
export function poe2dbLocaleLabel(locale) {
  if (locale === 'us') return '英文原文';
  if (locale === 'cn') return '简中';
  if (locale === 'tw') return '繁中';
  return locale || '';
}

/**
 * 把直查命中的页面按「术语」归并。
 * 同一个术语在 cn 与 tw 页上是两套译名（深渊巫妖 / 深淵巫妖），
 * 展示与提示词里都该合并成一条，而不是看起来像两个不同术语。
 *
 * @param {Array<{term:string, locale:string, name?:string, url?:string}>} hits
 * @returns {Array<{term:string, entries:Array}>}
 */
export function groupDirectHits(hits) {
  const list = Array.isArray(hits) ? hits : [];
  const groups = [];
  const index = new Map();
  for (const hit of list) {
    const term = String(hit?.term || '').trim();
    if (!term) continue;
    const key = term.toLowerCase();
    let group = index.get(key);
    if (!group) {
      group = { term, entries: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.entries.push(hit);
  }
  return groups;
}

/** 把一组命中的语言名并成 `深渊巫妖（简中）/ 深淵巫妖（繁中）`。 */
export function formatGroupNames(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((h) => {
      const label = poe2dbLocaleLabel(h.locale);
      const name = h.name || '（未解析出名称）';
      return label ? `${name}（${label}）` : name;
    })
    .join(' / ');
}

/**
 * poe2db 直查结果 → 纯文本块。
 * 这些是**按术语直接构造 URL 抓到的页面**（不经过搜索），比搜索结果可靠得多：
 * 页面标题就是该术语在该语言下的正式名称；cn/tw 两套译名会并排给出。
 */
export function formatDirectHits(hits, limit = 5) {
  const groups = groupDirectHits(hits).slice(0, limit);
  if (!groups.length) return '';
  const lines = groups.map((g) => {
    const urls = g.entries.map((h) => h.url).filter(Boolean);
    return `- ${g.term} = ${formatGroupNames(g.entries)}${urls.length ? ` (${urls.join(' ')})` : ''}`;
  });
  return [
    '【poe2db 术语页直查 · 按术语构造的页面，标题即该语言的正式名称，优先采用】',
    '（同一术语可能给出简中 / 繁中两套译名，按目标语言的用字体取用）',
    ...lines,
  ].join('\n');
}

/**
 * 一条检索结果 → 「术语 / 名称 / 链接」三段。
 * 新格式（Tavily 结果按 slug 聚合过）带 variants，同一页面的简中/繁中名称并排；
 * 旧格式（升级前写进缓存的结果）退回到 `[cn/简中] 标题 (链接)` 的写法。
 */
function sourceParts(s) {
  const variants = Array.isArray(s?.variants) && s.variants.length ? s.variants : null;
  if (variants) {
    return {
      term: s.term || '',
      names: variants
        .map((v) => {
          const label = poe2dbLocaleLabel(v.locale);
          const name = v.name || v.title || v.url || '';
          return label ? `${name}（${label}）` : name;
        })
        .join(' / '),
      urls: variants.map((v) => v.url).filter(Boolean),
    };
  }
  const label = poe2dbLocaleLabel(s?.locale);
  const tag = label ? `[${s.locale}/${label}] ` : '';
  return {
    term: '',
    names: `${tag}${s?.title || s?.url || ''}`,
    urls: s?.url ? [s.url] : [],
  };
}

/** Tavily 结果 → 纯文本块（同一页面的简中/繁中名称并排给出）。 */
export function formatSources(sources, limit = 5) {
  const list = Array.isArray(sources) ? sources.slice(0, limit) : [];
  if (!list.length) return '';
  const lines = list.map((s) => {
    const { term, names, urls } = sourceParts(s);
    const head = term ? `- ${term} = ${names}` : `- ${names}`;
    const link = urls.length ? ` (${urls.join(' ')})` : '';
    const snippet = s.snippet ? `\n  ${s.snippet}` : '';
    return `${head}${link}${snippet}`;
  });
  return [
    '【poe2db.tw 检索补充 · 本地术语表未收录，仅作参考，不确定就用通行说法】',
    '（每条前标注了来源页面语言：us=英文原文、cn=简中、tw=繁中；同一页面会并排给出简中/繁中两套名称，' +
      '简中版用 cn 那套、繁中版用 tw 那套）',
    ...lines,
  ].join('\n');
}

/**
 * 把「本地术语表这次到底干了什么」说清楚，供面板展示。
 *
 * 之所以需要它：命中 0 条时术语块不会出现在 prompt 里，如果面板什么都不说，
 * 用户根本分不清是「本次没命中」还是「术语表没加载成功」。
 *
 * @param {{enabled?:boolean, source?:string, size?:number, matched?:number, error?:string}} state
 */
export function describeGlossaryState(state = {}) {
  const size = Number(state.size) || 0;
  const where = state.source === 'imported' ? '已导入的官方术语表' : '内置术语表';

  // 补查链路：本地命中 → poe2db 直查 → Tavily，面板一句话交代清楚
  const chain = [];
  const directTried = Number(state.directTried) || 0;
  if (directTried) chain.push(`poe2db 直查 ${Number(state.directHit) || 0}/${directTried}`);
  const tavilyCount = Number(state.tavilyCount) || 0;
  if (tavilyCount) chain.push(`Tavily 补充 ${tavilyCount} 条`);
  const tail = chain.length ? ` · ${chain.join(' · ')}` : '';

  if (state.enabled === false) return '本地术语表：已关闭';

  if (state.error) return `本地术语表：读取失败 — ${state.error}`;
  if (!size) return '本地术语表：尚无可用数据';

  const matched = Number(state.matched) || 0;
  if (matched > 0) {
    return `本地术语表：${size} 条（${where}）· 命中 ${matched} 条 · 已写入 user 提示词${tail}`;
  }
  return (
    `本地术语表：${size} 条（${where}）· 本次未命中任何术语，` +
    `所以 user 提示词里不会有术语块${tail}`
  );
}

/**
 * 从「最终请求体」里还原真正会发出去的系统/用户文本。
 *
 * 刻意不去重新渲染一遍模板：直接读请求体，这样即使用户在「自定义请求体」里
 * 覆盖了 messages / input / instructions，面板展示的也一定是实际发出的内容。
 *
 * @param {object} body 客户端 buildBody 的结果
 * @returns {{system:string, user:string}}
 */
export function describePrompt(body) {
  if (!body || typeof body !== 'object') return { system: '', user: '' };

  // Chat Completions：messages 数组
  if (Array.isArray(body.messages)) {
    const pick = (roles) =>
      body.messages
        .filter((m) => roles.includes(m?.role))
        .map((m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '')))
        .join('\n\n');
    return { system: pick(['system']), user: pick(['user', 'assistant', 'tool']) };
  }

  // Responses：顶层 instructions + input
  const user =
    typeof body.input === 'string' ? body.input : JSON.stringify(body.input ?? '', null, 2);
  return { system: typeof body.instructions === 'string' ? body.instructions : '', user };
}

/**
 * 组装最终提示词。
 * - 模板里有 {{glossary}} / {{sources}} 就原位渲染；
 * - 没有的话，把上下文块前置到用户提示词之前（保证老用户不改提示词也生效）。
 */
export function composePrompt(settings, input = {}) {
  const vars = {
    text: input.text ?? '',
    // 双版本模式下 {{targetLang}} 固定渲染成「简中与繁中两个版本」，忽略设置里的单一语言
    targetLang: targetLabelOf(settings),
    title: input.title || '',
    url: input.url || '',
    pageLang: input.pageLang || '',
    glossary: '',
    sources: '',
  };

  // 双版本模式没有单一目标语言，术语表按「简中 ｜ 繁中」的固定顺序给
  const glossaryText = formatGlossary(input.terms, isDualOutput(settings) ? '' : settings.targetLang);
  const directText = formatDirectHits(input.direct);
  const sourcesText = formatSources(input.sources);
  vars.glossary = glossaryText;
  vars.sources = sourcesText;

  const template = String(settings.userPrompt || '');
  const hasGlossarySlot = /\{\{\s*glossary\s*\}\}/.test(template);
  const hasSourcesSlot = /\{\{\s*sources\s*\}\}/.test(template);

  let userText = renderTemplate(template, vars);
  const prefix = [];
  if (glossaryText && !hasGlossarySlot) prefix.push(glossaryText);
  if (directText) prefix.push(directText);
  if (sourcesText && !hasSourcesSlot) prefix.push(sourcesText);
  if (prefix.length) userText = `${prefix.join('\n\n')}\n\n${userText}`;

  const systemParts = [String(settings.systemPrompt || '').trim()];
  if (glossaryText || directText) systemParts.push(TERM_RULE);
  // 双版本模式：格式要求自动追加，用户改过提示词也不会丢
  if (isDualOutput(settings)) systemParts.push(DUAL_RULE);

  return {
    systemText: systemParts.filter(Boolean).join('\n\n'),
    userText,
    glossaryText,
    directText,
    sourcesText,
    dual: isDualOutput(settings),
  };
}
