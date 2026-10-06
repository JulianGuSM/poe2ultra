import { browser } from 'wxt/browser';
import { buildIndex } from './vendor/glossary.js';
let bundled: Promise<{ index: ReturnType<typeof buildIndex>; meta: object; source: string }> | undefined;
export async function glossarySnapshot(override?: { entries?: unknown[]; meta?: object } | null) {
  if (override?.entries?.length) return { index: buildIndex(override), meta: override.meta ?? {}, source: 'imported' };
  if (!bundled) bundled = fetch(browser.runtime.getURL('/data/glossary.json')).then(async response => {
    if (!response.ok) throw new Error('内置术语表读取失败。');
    const data = await response.json();
    return { index: buildIndex(data), meta: data.meta, source: 'bundled' };
  }).catch(error => { bundled = undefined; throw error; });
  return bundled;
}
