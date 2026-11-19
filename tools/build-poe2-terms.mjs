import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = resolve(root, 'data/poe2_terms.csv');
const outputPath = resolve(root, 'public/data/poe2_terms.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some(value => value !== '')) rows.push(row);
  }
  return rows;
}

const csv = (await readFile(inputPath, 'utf8')).replace(/^\uFEFF/, '');
const [headers, ...records] = parseCsv(csv);
const required = ['term_id', 'en', 'zh_cn', 'zh_tw', 'category', 'quality'];
if (!headers || required.some(name => !headers.includes(name))) {
  throw new Error(`CSV must contain these columns: ${required.join(', ')}`);
}

const indexes = Object.fromEntries(required.map(name => [name, headers.indexOf(name)]));
const previousSources = new Map();
try {
  const previous = JSON.parse(await readFile(outputPath, 'utf8'));
  for (const entry of previous.entries ?? []) {
    if (entry.i && entry.s) previousSources.set(entry.i, entry.s);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const ids = new Set();
const entries = records.map((record, index) => {
  const value = Object.fromEntries(required.map(name => [name, record[indexes[name]] ?? '']));
  if (!value.term_id || !value.en || (!value.zh_cn && !value.zh_tw)) {
    throw new Error(`CSV row ${index + 2} is missing an ID, English term, or Chinese translation.`);
  }
  if (ids.has(value.term_id)) throw new Error(`Duplicate term_id on CSV row ${index + 2}: ${value.term_id}`);
  ids.add(value.term_id);
  return {
    i: value.term_id,
    e: value.en,
    c: value.zh_cn,
    t: value.zh_tw,
    k: value.category,
    q: value.quality,
    s: previousSources.get(value.term_id) ?? '',
  };
});

const maxEnWords = Math.min(8, Math.max(1, ...entries.map(entry => entry.e.trim().split(/\s+/).filter(Boolean).length)));
const data = {
  meta: { count: entries.length, maxEnWords, skipped: 0, source: 'data/poe2_terms.csv' },
  entries,
};
const json = `${JSON.stringify(data)}\n`;
await writeFile(outputPath, json, 'utf8');
const version = `${entries.length}-${createHash('sha256').update(json).digest('hex').slice(0, 8)}`;
console.log(`Wrote ${entries.length} terms to public/data/poe2_terms.json (version ${version}).`);
