/**
 * 默认配置与提示词。
 * background / 设置页 / 弹窗 共用（ES Module）。
 * 注意：content script 是普通脚本，用不到本文件，只读取它需要的几个键。
 */

import { DUAL_MARKERS } from './dual.js';

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

export const DEFAULTS = {
  // —— 接口 ——
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  apiMode: 'responses', // responses（POST /responses）| chat（POST /chat/completions）
  model: 'deepseek-chat',
  temperature: 1.3, // 仅非思考模式生效；思考模式下服务端会忽略它
  maxTokens: 8192,
  timeoutMs: 90000,

  // —— 本地术语表 ——
  // 从 data/glossary.json（由 tools/build-glossary.mjs 打包）里检索命中术语，
  // 作为上下文交给模型；设置页也可以导入更新过的术语表覆盖内置数据。
  glossaryEnabled: true,
  glossaryMaxTerms: 20,
  glossaryCategories: '', // 逗号分隔，留空＝全部（如 GemEffects,keyword）
  glossaryStrict: true, // 命中术语时在系统提示词里追加「必须采用表内译名」

  // —— poe2db 直查（按术语直接构造页面 URL，不依赖搜索）——
  // 术语表没收录的候选词，按 slug 规则构造 https://poe2db.tw/{us|cn|tw}/<术语> 直接抓，
  // 比搜索精确得多、也不消耗 Tavily 额度；构造错了会 404，再回退到搜索。
  // cn / tw 是两套译名，每个术语两页都抓（us 页只在中文页都没命中时兜底），预算要按 2 倍估。
  poe2dbDirectEnabled: true,
  poe2dbLocales: 'us,cn,tw', // us=英文原文、cn=简中、tw=繁中；留空＝不限语言
  poe2dbMaxTerms: 3, // 一次翻译最多直查几个候选词
  poe2dbRequestBudget: 8, // 一次翻译最多发出多少个页面请求（缓存命中不计）；3 术语 × cn/tw ≈ 6 页

  // —— Tavily 检索（直查不到时的兜底）——
  // 注意：这里永远不要填真实密钥。所有密钥只在运行时由用户填进设置页，
  // 存进 chrome.storage.local（见 LOCAL_ONLY_KEYS），不进代码、不进 git。
  tavilyEnabled: true,
  tavilyApiKey: '',
  // 结果会按 slug 聚合成「一页一条」，要多留几条才凑得齐同一页的 cn/tw 两套名称；
  // Tavily 按请求计费，同一次请求里多要几条不多花钱。
  tavilyMaxResults: 6,
  tavilyDomains: 'poe2db.tw',
  showContext: true, // 面板里展示命中的术语与检索来源

  // —— 思考模式 ——
  // default = 不发送思考参数，由服务端决定（官方当前默认为开启 / effort=high）
  // disabled = 显式关闭，最快最省；enabled = 显式开启
  thinkingMode: 'default',
  reasoningEffort: 'high', // low | high | max，仅 thinkingMode=enabled 时发送

  // —— 提示词 ——
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  userPrompt: DEFAULT_USER_PROMPT,
  targetLang: '简体中文',
  // 一次翻译同时产出简中 + 繁中两版（PoE2 的简繁是两套独立译名，不是字形转换）；
  // 关掉后回到「只翻 settings.targetLang 那一种」的老行为。
  dualOutput: true,

  // —— 交互 ——
  autoTranslate: false, // 划词后直接翻译，无需点击
  showButton: true, // 划词后显示悬浮翻译按钮
  keepSource: true, // 面板内保留原文
  autoClosePanel: false, // 点击页面空白处自动关闭面板
  theme: 'auto', // auto | light | dark
  panelWidth: 400,
  maxChars: 8000, // 单次最多送出的字符数
  stream: true, // 流式输出
  showPrompt: true, // 面板里折叠展示本次实际发出的 prompt

  // —— 费用估算（单位：元 / 百万 tokens，仅 costModel=custom 时使用）——
  showCost: true,
  costModel: 'auto', // auto | deepseek-flash | deepseek-v4-pro | custom
  costAutoPeak: true, // 按北京时间自动区分高峰/空闲时段价
  priceCacheHit: 0.02,
  priceCacheMiss: 1,
  priceOutput: 4,

  // —— 高级 ——
  extraHeaders: '', // 形如 {"X-Foo":"bar"}，给自建中转用
  customBody: '', // 形如 {"top_p":0.9}，合并进请求体
};

export const MODEL_PRESETS = [
  { value: 'deepseek-chat', label: 'deepseek-chat（旧名，按 flash 计费，仍可调用）' },
  { value: 'deepseek-reasoner', label: 'deepseek-reasoner（旧名，按 flash 计费）' },
  { value: 'deepseek-flash', label: 'deepseek-flash（当前主力，快且便宜）' },
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro（更强，明显更贵）' },
];

export const COST_MODEL_PRESETS = [
  { value: 'auto', label: '自动（按当前模型推断）' },
  { value: 'deepseek-flash', label: 'deepseek-flash' },
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
  { value: 'custom', label: '自定义单价' },
];

/** 只在本地保存、不参与 chrome.storage.sync 同步的键（含密钥）。 */
export const LOCAL_ONLY_KEYS = ['apiKey', 'tavilyApiKey'];

export const SETTING_KEYS = Object.keys(DEFAULTS).filter(
  (k) => !LOCAL_ONLY_KEYS.includes(k)
);

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
