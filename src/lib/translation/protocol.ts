import type { Segment, Translation } from './plan';

// Keep the storage version: old span arrays can be joined and shown below the same source block.
export const FORMAT_VERSION = 'poe2ultra-dual-v1';
export const GLOSSARY_VERSION = '2245-884e31a5';
const excerpt = (text: string) => text.replace(/\s+/g, ' ').slice(0, 180);
/** Extract one complete object surrounded by prose/fences without repairing or inventing its contents. */
function parseJsonOutput(raw: string): unknown {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(clean); } catch { /* Try a single, complete wrapped object below. */ }
  const start = clean.indexOf('{');
  const stack: string[] = [];
  let inString = false, escaped = false, end = -1;
  for (let i = start; start >= 0 && i < clean.length; i++) {
    const char = clean[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) break;
      if (!stack.length) { end = i + 1; break; }
    }
  }
  // Reject multiple payloads and arrays around the object instead of selecting an arbitrary result.
  if (end !== -1 && !/[{}\[\]]/.test(clean.slice(0, start) + clean.slice(end))) {
    try { return JSON.parse(clean.slice(start, end)); } catch { /* Invalid contents stay invalid. */ }
  }
  const detail = !clean ? '接口返回了空内容。'
    : start < 0 ? '返回内容不是 JSON 对象，可能没有遵守输出格式。'
    : end < 0 && (stack.length || inString) ? 'JSON 没有完整闭合，可能被截断。'
    : 'JSON 语法错误或包含多份结果，可能有未转义的引号、换行或多余逗号。';
  const sample = !clean ? '' : `\n返回开头：${excerpt(clean)}${clean.length > 180 ? `\n返回结尾：${excerpt(clean.slice(-180))}` : ''}`;
  throw new Error(`模型返回的 JSON 格式无效，本批未缓存。${detail}已接收 ${raw.length.toLocaleString('zh-CN')} 字符。之前已保存的译文仍保留。${sample}`);
}
export function parseBatch(raw: string, batch: Segment[]): Translation[] {
  const data = parseJsonOutput(raw);
  const rows = (data as { translations?: unknown })?.translations;
  if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error('模型返回的文字块不完整，本批未缓存。可以继续翻译缺失内容。');
  const result: Translation[] = [];
  for (const row of rows) {
    if (!row || !Number.isInteger(row.id) || !batch[row.id] || result[row.id]) throw new Error('译文的文字块编号无效或重复，本批未缓存。');
    const translated = {} as Translation;
    for (const locale of ['cn', 'tw'] as const) {
      const received: unknown = row[locale];
      // Also accept older string-array responses; formatting boundaries no longer constrain translations.
      const text = typeof received === 'string' ? received : Array.isArray(received) && received.every(t => typeof t === 'string') ? received.join('') : '';
      if (!text.trim()) {
        const error = new Error(`模型未返回有效译文（本批第 ${row.id + 1} 个文字块，${locale === 'cn' ? '简中' : '繁中'}）：译文为空或不是文本。本批未缓存，之前已保存的译文仍保留。`);
        Object.assign(error, { details: { code: 'block_translation', segmentId: row.id, locale, sourceText: batch[row.id]!.texts.join(''), received } });
        throw error;
      }
      translated[locale] = [text];
    }
    result[row.id] = translated;
  }
  return result;
}

export function batches(segments: Segment[], maxChars = 3500): Segment[][] {
  const result: Segment[][] = [];
  let batch: Segment[] = [], size = 0;
  for (const segment of segments) {
    const length = JSON.stringify(segment).length;
    if (batch.length && (size + length > maxChars || batch.length >= 24)) { result.push(batch); batch = []; size = 0; }
    batch.push(segment); size += length;
  }
  if (batch.length) result.push(batch);
  return result;
}

export function validateSegments(value: unknown): asserts value is Segment[] {
  if (!Array.isArray(value) || value.length > 12000 || JSON.stringify(value).length > 3_000_000) throw new Error('Guide is too large.');
  for (const s of value) {
    if (!s || !['term', 'prose'].includes(s.kind) || !Array.isArray(s.texts) || !s.texts.length ||
        s.texts.some((t: unknown) => typeof t !== 'string') || !Array.isArray(s.protected) ||
        s.protected.some((i: unknown) => !Number.isInteger(i) || Number(i) < 0 || Number(i) >= s.texts.length) ||
        JSON.stringify(s).length > 16000) throw new Error('Invalid or oversized paragraph.');
  }
}
