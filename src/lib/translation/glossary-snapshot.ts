import { browser } from 'wxt/browser';
import { buildIndex } from './vendor/glossary.js';
let bundled: Promise<any> | undefined;
export async function glossarySnapshot(override?: { entries?: unknown[]; meta?: object } | null, customTermAliases = '[]') {
  const aliases = JSON.parse(customTermAliases || '[]');
  if (override?.entries?.length) return { index: buildIndex(override, aliases), meta: override.meta ?? {}, source: 'imported' };
  if (!bundled) bundled = fetch(browser.runtime.getURL('/data/poe2_terms.json')).then(async response => {
    if (!response.ok) throw new Error('内置术语表读取失败。');
    return response.json();
  }).catch(error => { bundled = undefined; throw error; });
  const data = await bundled;
  return { index: buildIndex(data, aliases), meta: data.meta, source: 'bundled' };
}
