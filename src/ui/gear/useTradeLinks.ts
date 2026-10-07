import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { EquipmentSlot } from '@/lib/build/model';
import type { TradeLinkResult } from '@/lib/trade/china';
import { SETTINGS_KEY } from '@/lib/translation/settings';
import { useDisplayLocale } from '@/ui/translation/BilingualText';

export function useTradeLinks(equipment: EquipmentSlot[]) {
  const locale = useDisplayLocale();
  const key = JSON.stringify([...new Set(equipment.flatMap(slot => slot.item.tradeUrl ? [slot.item.tradeUrl] : []))]);
  const [result, setResult] = useState<{ key: string; links: Record<string, TradeLinkResult>; error?: string }>();
  useEffect(() => {
    if (locale !== 'cn') return;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      setResult(undefined);
      try {
        const reply = await browser.runtime.sendMessage({ type: 'china-trade-links', urls: JSON.parse(key) });
        if (current === request) setResult({ key, links: reply?.links ?? {}, error: reply?.error ?? (!reply?.links ? '国服搜索链接生成失败，请重新加载扩展。' : undefined) });
      } catch {
        if (current === request) setResult({ key, links: {}, error: '国服搜索链接生成失败，请重新加载扩展。' });
      }
    };
    void refresh();
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && (SETTINGS_KEY in changes || 'glossaryOverride' in changes)) void refresh();
    };
    browser.storage.onChanged.addListener(changed);
    return () => { request++; browser.storage.onChanged.removeListener(changed); };
  }, [locale, key]);
  return (source: string): TradeLinkResult => locale !== 'cn' ? { url: source }
    : result?.key === key ? result.links[source] ?? { error: result.error ?? '国服搜索链接不可用。' }
    : { error: '正在准备国服搜索链接…' };
}
