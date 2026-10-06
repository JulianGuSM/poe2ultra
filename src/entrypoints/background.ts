import { browser } from 'wxt/browser';
import { PersistentCache } from '@/lib/translation/cache';
import { digest, TranslationEngine } from '@/lib/translation/engine';
import { validateSegments } from '@/lib/translation/protocol';
import { translateBatch } from '@/lib/translation/provider.js';
import { getSettings, saveSettings, requireEndpointPermission, guideCachePrompts, GUIDE_CACHE_PROMPTS_KEY } from '@/lib/translation/preferences';
import { translationProfile } from '@/lib/translation/profile';
import { createCacheBackup, validateCacheBackup } from '@/lib/translation/cache-backup';
import { createTranslationCsv } from '@/lib/translation/csv';
import { normalizeSettings, SETTINGS_KEY, validateSettings } from '@/lib/translation/settings';
import { glossarySnapshot } from '@/lib/translation/glossary-snapshot';
import { OVERRIDE_KEY } from '@/lib/translation/vendor/glossary.js';
import { registerSelection } from '@/lib/selection/background.js';
import type { Segment } from '@/lib/translation/plan';
import { getBuildSlug, isBuildPageUrl } from '@/lib/build-url';
import { DebugSession, DebugStore } from '@/lib/translation/debug';
import { estimateCost, formatCny } from '@/lib/translation/vendor/pricing.js';
import type { Activity } from '@/lib/translation/activity';

const cache = new PersistentCache();
const debugStore = new DebugStore();
const engines = new Map<string, TranslationEngine>();
const reporters = new Map<AbortSignal, (message: object) => void>();
let cacheTransfer = false;
const errorText = (e: unknown) => e instanceof Error ? e.message + ((e as Error & { debugId?: string }).debugId ? `\n调试记录：${(e as Error & { debugId: string }).debugId}（翻译设置 → Debug 日志）` : '') : String(e);

export default defineBackground(() => {
  registerSelection();
  browser.action.onClicked.addListener(() => { void browser.runtime.openOptionsPage(); });
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['translation-settings', 'translation-debug', 'translation-cache'].includes(message?.type)) return;
    // Secrets and settings are available only to our extension options page, never a content script.
    if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('/options.html')) return;
    void (async () => {
      if (message.type === 'translation-cache') {
        if (activeJobs || cacheTransfer) throw new Error('请先停止正在进行的攻略翻译或缓存操作，再导出或导入译文缓存。');
        cacheTransfer = true;
        try {
          if (message.action === 'export-csv') {
            return createTranslationCsv(await cache.entries(), await cache.selectionEntries());
          }
          if (message.action === 'export') {
            const settings = await getSettings();
            const stored = await browser.storage.local.get(OVERRIDE_KEY);
            const override = stored[OVERRIDE_KEY] as { entries?: unknown[]; meta?: object } | undefined;
            return { backup: createCacheBackup(await cache.entries(), settings, await guideCachePrompts(),
              override?.entries?.length ? { entries: override.entries, meta: override.meta } : null, await cache.costEntries()) };
          }
          if (message.action === 'import') {
            const backup = validateCacheBackup(message.backup);
            const settings = normalizeSettings({ ...await getSettings(), ...backup.settings });
            validateSettings(settings);
            const result = await cache.merge(backup.records);
            const importedCosts = await cache.mergeGuideCosts(backup.guideCosts ?? []);
            const values: Record<string, unknown> = {
              [SETTINGS_KEY]: settings,
              [GUIDE_CACHE_PROMPTS_KEY]: backup.legacyCachePrompts,
              'poe2ultra.translation.cache-revision': Date.now(),
            };
            if (backup.glossaryOverride) values[OVERRIDE_KEY] = backup.glossaryOverride;
            await browser.storage.local.set(values);
            if (!backup.glossaryOverride) await browser.storage.local.remove(OVERRIDE_KEY);
            engines.clear();
            return { imported: result, importedCosts, count: await cache.count(), settings };
          }
          throw new Error('未知缓存操作。');
        } finally { cacheTransfer = false; }
      }
      if (message.type === 'translation-debug') {
        if (message.action !== 'clear') throw new Error('未知调试操作。');
        if (activeJobs) throw new Error('请先停止正在进行的攻略翻译，再清空调试日志。');
        await debugStore.clear();
        return { ok: true };
      }
      if (message.action === 'save') {
        await saveSettings(message.settings);
      } else if (message.action === 'clear') {
        if (activeJobs) throw new Error('请先停止正在进行的攻略翻译，再清空缓存。');
        await cache.clear();
        await browser.storage.local.set({ 'poe2ultra.translation.cache-revision': Date.now() });
      }
      return { settings: await getSettings(), count: await cache.count() };
    })().then(respond, error => respond({ error: errorText(error) }));
    return true;
  });

  let activeJobs = 0;
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'poe2ultra-translation') return;
    const sender = port.sender;
    if (sender?.id !== browser.runtime.id || !isBuildPageUrl(sender.url ?? '')) { port.disconnect(); return; }
    const guideKey = `https://mobalytics.gg/poe-2/builds/${getBuildSlug(sender.url!)!}`;
    let controller = new AbortController();
    let busy = false, disconnected = false;
    const send = (message: object) => { if (!disconnected) { try { port.postMessage(message); } catch { disconnected = true; controller.abort(); } } };
    port.onDisconnect.addListener(() => { disconnected = true; controller.abort(); });
    port.onMessage.addListener(message => {
      if (message?.type === 'ping') return; // Message traffic keeps an active MV3 worker alive.
      if (message?.type === 'options') { void browser.runtime.openOptionsPage(); return; }
      if (message?.type === 'cancel') { controller.abort(); return; }
      if (!['inspect', 'translate'].includes(message?.type) || busy) return;
      if (cacheTransfer) { send({ type: 'error', text: '缓存正在导入或导出，请完成后重试。' }); return; }
      busy = true; controller = new AbortController(); activeJobs++;
      void (async () => {
        validateSegments(message.segments);
        const segments = message.segments as Segment[];
        const configured = await getSettings();
        // Credential changes do not invalidate translations; prompt/model/term-policy changes do.
        const { apiKey, tavilyApiKey, extraHeaders, timeoutMs, stream } = configured;
        const stored = await browser.storage.local.get(OVERRIDE_KEY);
        const override = stored[OVERRIDE_KEY] as { entries?: unknown[]; meta?: object } | undefined;
        const profile = await translationProfile(configured, override, await guideCachePrompts());
        const engineKey = await digest(JSON.stringify({ profile, apiKey, tavilyApiKey, extraHeaders, timeoutMs, stream }));
        let engine = engines.get(engineKey);
        if (!engine) {
          // A running task retains the same glossary snapshot even if a new one is imported mid-run.
          const glossary = configured.glossaryEnabled ? await glossarySnapshot(override) : undefined;
          engine = new TranslationEngine(cache, async (batch, signal, report, debug) => {
            await requireEndpointPermission(configured.baseUrl);
            const result = await translateBatch(batch, configured, signal, report, glossary, debug);
            // Diagnostics contain no key or full request body.
            if (result.warnings.length) reporters.get(signal)?.({ type: 'warning', text: result.warnings.join(' · ') });
            return result.translations;
          });
          engines.set(engineKey, engine);
        }
        const sendGuideCost = async () => send({ type: 'guide-cost', summary: await cache.guideCost(guideKey) });
        if (message.type === 'inspect') {
          send({ type: 'progress', ...await engine.inspect(segments, profile) });
          await sendGuideCost();
        }
        else {
          reporters.set(controller.signal, send);
          let requests = 0, priced = 0, totalCny = 0;
          let costWrites = Promise.resolve();
          await sendGuideCost();
          const activity = (event: Activity) => {
            if (event.stage === 'requesting') requests++;
            if (event.modelRequest) {
              const estimate = estimateCost(event.usage, configured);
              if (estimate) { totalCny += estimate.cny; priced++; }
              costWrites = costWrites.then(async () => {
                await cache.appendGuideCost(guideKey, estimate?.cny ?? null);
                await sendGuideCost();
              }).catch(error => send({ type: 'warning', text: `本次费用记录保存失败：${errorText(error)}` }));
            }
            const { usage: _usage, modelRequest: _modelRequest, ...visible } = event;
            send({ type: 'activity', ...visible });
          };
          const sendCost = () => {
            send({ type: 'cost', text: priced ? `≈${formatCny(totalCny)}` : requests ? '' : '¥0', requests, priced });
          };
          const debug = configured.debugEnabled ? new DebugSession(debugStore, configured, {
            guideUrl: sender.url, profile, apiMode: configured.apiMode, model: configured.model,
          }, () => send({ type: 'warning', text: '调试日志保存失败，翻译仍继续。请在设置页检查本地日志存储。' })) : undefined;
          try {
            const summary = await engine.run(segments, profile, controller.signal,
              progress => send({ type: 'progress', ...progress }), activity, debug,
              failure => send({ type: 'batch-error', ...failure }));
            await costWrites;
            sendCost();
            if (summary.failedBatches) {
              send({ type: 'partial', failedBatches: summary.failedBatches, firstError: summary.failures[0]?.message });
              return;
            }
          } catch (error) { await costWrites; sendCost(); throw error; }
        }
        send({ type: 'done' });
      })().catch(error => send({ type: controller.signal.aborted ? 'cancelled' : 'error', text: errorText(error) }))
        .finally(() => { reporters.delete(controller.signal); busy = false; activeJobs--; });
    });
  });
});
