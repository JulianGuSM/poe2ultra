/**
 * 费用估算（人民币）。
 *
 * 价格取自 DeepSeek 官方价目表，单位：元 / 百万 tokens。
 * 官方规则：空闲时段价格为高峰时段的一半；北京时间周一至周五
 * （不含中国法定节假日）9:00-12:00、14:00-18:00 为高峰时段，
 * 其余时段（含周末全天）为空闲时段。
 *
 * 注意：结果是估算值，法定节假日无法在本地判断，实际扣费以 DeepSeek 账单为准。
 */

export const PRICE_SOURCE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing';
export const PEAK_RULE_TEXT =
  '高峰时段：北京时间周一至周五 9:00-12:00、14:00-18:00（不含法定节假日）；其余时段按空闲价，为空峰价的一半。';

/** 元 / 百万 tokens */
export const PRICE_TABLE = {
  'deepseek-flash': {
    label: 'deepseek-flash',
    note: '旧模型名 deepseek-chat / deepseek-reasoner 目前也由该模型提供服务并按此价计费',
    hit: { off: 0.02, peak: 0.04 },
    miss: { off: 1, peak: 2 },
    out: { off: 4, peak: 8 },
  },
  'deepseek-v4-pro': {
    label: 'deepseek-v4-pro',
    note: '更强也明显更贵，翻译场景通常不必使用',
    hit: { off: 0.15, peak: 0.3 },
    miss: { off: 4.5, peak: 9 },
    out: { off: 13.5, peak: 27 },
  },
};

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** 北京时间是否处于高峰时段。 */
export function isPeakTime(date = new Date()) {
  const beijing = new Date(date.getTime() + 8 * 3600 * 1000);
  const day = beijing.getUTCDay(); // 0 = 周日
  if (day === 0 || day === 6) return false;
  const hours = beijing.getUTCHours() + beijing.getUTCMinutes() / 60;
  return (hours >= 9 && hours < 12) || (hours >= 14 && hours < 18);
}

/** 按模型名猜价目表；拿不准时按便宜的 flash 估。 */
export function guessPriceKey(model) {
  return String(model || '').toLowerCase().includes('pro') ? 'deepseek-v4-pro' : 'deepseek-flash';
}

/**
 * 解析出本次适用的单价。
 * @param {object} settings 插件配置
 * @param {Date} date 用于判断高峰/空闲
 */
export function resolveRates(settings = {}, date = new Date()) {
  const costModel = settings.costModel || 'auto';
  const peak = settings.costAutoPeak !== false && isPeakTime(date);

  if (costModel === 'custom') {
    return {
      key: 'custom',
      label: '自定义单价',
      peak: false,
      hit: num(settings.priceCacheHit),
      miss: num(settings.priceCacheMiss),
      out: num(settings.priceOutput),
    };
  }

  const key = costModel === 'auto' ? guessPriceKey(settings.model) : costModel;
  const table = PRICE_TABLE[key] || PRICE_TABLE['deepseek-flash'];
  const slot = peak ? 'peak' : 'off';
  return {
    key,
    label: table.label,
    peak,
    hit: table.hit[slot],
    miss: table.miss[slot],
    out: table.out[slot],
  };
}

/**
 * 拆出缓存命中/未命中的输入 token。
 * DeepSeek 会额外返回 prompt_cache_hit_tokens / prompt_cache_miss_tokens；
 * 拿不到时全部按「未命中」估算（偏保守，不会少算）。
 */
export function splitPromptTokens(usage = {}) {
  const prompt = num(usage.prompt_tokens);
  const hasHit = Number.isFinite(Number(usage.prompt_cache_hit_tokens));
  const hasMiss = Number.isFinite(Number(usage.prompt_cache_miss_tokens));

  if (!hasHit && !hasMiss) return { hit: 0, miss: prompt };

  let hit = hasHit ? num(usage.prompt_cache_hit_tokens) : 0;
  let miss = hasMiss ? num(usage.prompt_cache_miss_tokens) : 0;
  if (!hasHit) hit = Math.max(0, prompt - miss);
  if (!hasMiss) miss = Math.max(0, prompt - hit);
  return { hit, miss };
}

/**
 * 估算一次请求的花费。
 * @returns {{cny:number, text:string, label:string, peak:boolean, detail:object}|null}
 *          没有 token 数据时返回 null，避免显示成 ¥0 误导用户。
 */
export function estimateCost(usage, settings = {}, date = new Date()) {
  if (!usage) return null;
  const { hit, miss } = splitPromptTokens(usage);
  const out = num(usage.completion_tokens);
  if (!hit && !miss && !out) return null;

  const rates = resolveRates(settings, date);
  const cny = (hit * rates.hit + miss * rates.miss + out * rates.out) / 1e6;
  return {
    cny,
    text: `≈${formatCny(cny)}`,
    label: rates.label,
    peak: rates.peak,
    detail: { hit, miss, out, rates },
  };
}

/** 金额格式化：小额多留几位小数，避免显示成 ¥0.00。 */
export function formatCny(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return '¥0';
  if (v < 0.001) return `¥${v.toFixed(5)}`;
  if (v < 1) return `¥${v.toFixed(4)}`;
  return `¥${v.toFixed(2)}`;
}
