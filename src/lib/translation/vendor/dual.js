/**
 * 「简中 + 繁中」双版本输出协议。
 *
 * 为什么需要它：PoE2 的简中与繁中是**两套独立译名**，不是简繁字形转换
 * （Abyssal Lich → 简中「深渊巫妖」/ 繁中「深淵妖巫」；Rupture the Flesh →
 * 简中「撕裂血肉」/ 繁中「割裂血肉」）。所以一次翻译要同时产出两版，
 * 模型按固定标记分段输出，插件再据此把两版拆开展示、分别复制。
 *
 * 这个模块同时被 background（拆最终译文）、设置页与面板（展示）使用；
 * content script 是普通脚本、不能 import，那边有一份等价的轻量实现。
 */

export const DUAL_MARKERS = { cn: '【简中】', tw: '【繁中】' };

/** `{{targetLang}}` 在双版本模式下的取值。 */
export const DUAL_TARGET_LABEL = '简中（简体中文）与繁中（繁體中文）两个版本';

/** 设置页/面板展示用的短标签。 */
export const DUAL_TARGET_SHORT = '简中 + 繁中';

/** 是否开启双版本输出（默认开）。 */
export function isDualOutput(settings = {}) {
  return settings.dualOutput !== false;
}

/** `{{targetLang}}` 的真实取值：双版本模式下忽略用户填的单一目标语言。 */
export function targetLabelOf(settings = {}) {
  return isDualOutput(settings) ? DUAL_TARGET_LABEL : String(settings.targetLang || '');
}

/* --------------------------------------------------------------- 解析 */

// 容忍模型写成「简体 / 简体中文 / 繁體 / 繁体中文」等变体，以及 ### 简中、简中：这类写法
const CN_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:【|\*\*)?\s*(?:简中|简体中文|简体|簡中|简体版)(?:】|\*\*)?\s*[:：]?\s*\n?/;
const TW_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:【|\*\*)?\s*(?:繁中|繁體中文|繁体中文|繁體|繁体|繁中版)(?:】|\*\*)?\s*[:：]?\s*\n?/;

/**
 * 把模型输出拆成简中/繁中两版。
 *
 * @param {string} text 模型返回的完整文本
 * @returns {{cn:string, tw:string, ok:boolean, missing:'cn'|'tw'|'both'|''}|null}
 *          null = 没有看到任何标记（调用方应退回「按原文整段展示」）
 */
export function parseDualOutput(text) {
  const full = String(text ?? '');
  if (!full.trim()) return null;

  const cnMatch = CN_RE.exec(full);
  const twMatch = TW_RE.exec(full);
  if (!cnMatch && !twMatch) return null;

  // 标记只出现一次时，前一段仍属于它；两个标记都有时按先后顺序切片
  const marks = [];
  if (cnMatch) marks.push({ key: 'cn', start: cnMatch.index, end: cnMatch.index + cnMatch[0].length });
  if (twMatch) marks.push({ key: 'tw', start: twMatch.index, end: twMatch.index + twMatch[0].length });
  marks.sort((a, b) => a.start - b.start);

  const parts = { cn: '', tw: '' };
  marks.forEach((mark, i) => {
    const until = i + 1 < marks.length ? marks[i + 1].start : full.length;
    const body = full.slice(mark.end, until).trim();
    parts[mark.key] = parts[mark.key] ? `${parts[mark.key]}\n${body}`.trim() : body;
  });

  // 第一个标记之前若有内容（模型偶尔多写一句前言），并进第一段，避免丢译文
  const head = full.slice(0, marks[0].start).trim();
  if (head) {
    const first = marks[0].key;
    parts[first] = parts[first] ? `${head}\n${parts[first]}` : head;
  }

  const missing = !parts.cn ? (parts.tw ? 'cn' : 'both') : !parts.tw ? 'tw' : '';
  return { cn: parts.cn, tw: parts.tw, ok: !missing, missing };
}

/** 面板「复制译文」用的整段文本（两版都带上，便于粘到别处）。 */
export function formatDualForCopy(dual) {
  if (!dual) return '';
  const blocks = [];
  if (dual.cn) blocks.push(`${DUAL_MARKERS.cn}\n${dual.cn}`);
  if (dual.tw) blocks.push(`${DUAL_MARKERS.tw}\n${dual.tw}`);
  return blocks.join('\n\n');
}
