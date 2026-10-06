import { expect, it } from 'vitest';
import { createTranslationCsv } from './csv';

it('exports exactly three UTF-8 columns, safely quoting commas, quotes and line breaks', () => {
  const guide: [string, { source?: string; cn: string[]; tw: string[] }][] = [
    ['a', { source: 'Hello, "Exile"\nagain', cn: ['你好，', '流放者'], tw: ['你好，流亡者'] }],
    ['b', { cn: ['旧简中'], tw: ['舊繁中'] }],
  ];
  const selection = [
    { source: 'Hello, "Exile"\nagain', cn: '您好，流放者', tw: '你好，流亡者' },
    { source: 'Hello, "Exile"\nagain', cn: '您好，流放者', tw: '你好，流亡者' },
  ];
  const result = createTranslationCsv(guide, selection);
  expect(result.count).toBe(2);
  expect(result.unavailable).toBe(1);
  expect(result.csv).toBe('\uFEFF英语原文,简中,繁中\r\n"Hello, ""Exile""\nagain",你好，流放者,你好，流亡者\r\n"Hello, ""Exile""\nagain",您好，流放者,你好，流亡者\r\n');
});

it('escapes spreadsheet formulas in all three columns', () => {
  const result = createTranslationCsv([['a', { source: '=1+1', cn: ['+SUM(1,2)'], tw: ['@cmd'] }]], []);
  expect(result.csv).toContain("'=1+1,\"'+SUM(1,2)\",'@cmd\r\n");
});
