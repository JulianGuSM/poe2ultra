import type { SelectionTranslation } from './cache';
import type { CachedTranslation } from './plan';

/** A readable snapshot of locally accumulated bilingual translations, not an importable cache backup. */
export function createTranslationCsv(guide: [string, CachedTranslation][], selections: SelectionTranslation[]) {
  const seen = new Set<string>();
  const rows: [string, string, string][] = [];
  let unavailable = 0;
  function add(source: unknown, cn: unknown, tw: unknown) {
    if (![source, cn, tw].every(value => typeof value === 'string' && value.trim())) { unavailable++; return; }
    const row = [source, cn, tw] as [string, string, string];
    const key = JSON.stringify(row);
    if (!seen.has(key)) { seen.add(key); rows.push(row); }
  }
  for (const [, value] of guide) add(value.source, value.cn.join(''), value.tw.join(''));
  for (const value of selections) add(value.source, value.cn, value.tw);
  function cell(value: string) {
    // Excel/Sheets may evaluate formulas even when CSV fields are quoted.
    const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  }
  const csv = '\uFEFF' + [['英语原文', '简中', '繁中'], ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  return { csv, count: rows.length, unavailable };
}
