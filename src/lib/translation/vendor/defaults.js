/** Shared configuration defaults. Selection prompt text is defined only in selection/prompt.js. */
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT } from '../../selection/prompt.js';

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
  // 从 data/poe2_terms.json（由 data/poe2_terms.csv 生成）里检索命中术语，
  // 作为上下文交给模型；设置页也可以导入更新过的术语表覆盖内置数据。
  glossaryEnabled: true,

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
  showContext: false, // 默认不在面板里展示命中的术语与检索来源

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
  showPrompt: false, // 面板里折叠展示本次实际发出的 prompt

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
