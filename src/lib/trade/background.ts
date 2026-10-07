import { browser } from 'wxt/browser';
import { isBuildPageUrl } from '@/lib/build-url';
import { glossarySnapshot } from '@/lib/translation/glossary-snapshot';
import { getSettings } from '@/lib/translation/preferences';
import { OVERRIDE_KEY } from '@/lib/translation/vendor/glossary.js';
import { chinaTradeUrl, type TradeLinkResult } from './china';

export function registerTradeLinks() {
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'china-trade-links') return;
    if (sender.id !== browser.runtime.id || !isBuildPageUrl(sender.url ?? '')) return;
    void (async () => {
      if (!Array.isArray(message.urls) || message.urls.length > 100 || message.urls.some((url: unknown) => typeof url !== 'string' || url.length > 64000)) {
        throw new Error('装备搜索链接格式无效。');
      }
      const [settings, stored, bundled] = await Promise.all([getSettings(), browser.storage.local.get(OVERRIDE_KEY), glossarySnapshot()]);
      const names = new Map(bundled.index.en);
      const override = stored[OVERRIDE_KEY] as { entries?: unknown[] } | undefined;
      if (override?.entries?.length) {
        const imported = await glossarySnapshot(override);
        for (const [key, entry] of imported.index.en) if (entry.c?.trim()) names.set(key, entry);
      }
      const links: Record<string, TradeLinkResult> = {};
      await Promise.all((message.urls as string[]).map(async source => {
        try { links[source] = { url: await chinaTradeUrl(source, names, settings.chinaTradeLeague) }; }
        catch (error) { links[source] = { error: error instanceof Error ? error.message : String(error) }; }
      }));
      return { links };
    })().then(respond, error => respond({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
}
