import { isBuildPageUrl } from '@/lib/build-url';
import { indexedDbCandidates } from '@/lib/data/page-idb';
import { readStaticData } from '@/lib/data/static-data';
import { summarizeBuild } from '@/lib/dev/build-summary';
import { listenForCapture } from '@/lib/dev/capture-messaging';
import { captureFixture } from '@/lib/dev/fixture';
import { listenForPageCapture } from '@/lib/dev/page-capture';
import { listenForPageReport } from '@/lib/dev/page-report';
import { createBuildLoader } from '@/lib/page/build-loader';
import { createHtmlFetcher } from '@/lib/page/fetch-html';
import { pageFetch } from '@/lib/page/page-fetch';
import { createPageController, isOverlayVisible } from '@/lib/page/controller';
import { headerCollapsedItem, lastTabsItem, lastVariantsItem, pageModeItem, rememberPerBuild } from '@/lib/page/preferences';
import { guardFocus } from '@/lib/page/focus-guard';
import { setPageLocked } from '@/lib/page/page-lock';
import { mountApp } from '@/ui/app/mount';
import { browser } from 'wxt/browser';

const MARKER_ATTRIBUTE = 'data-poe2-build-guide';

// Build pages are asked for as the page itself: in Firefox a content script's own fetch goes as the extension.
const fetchHtml = createHtmlFetcher(pageFetch(), {
  onAttempt: (attempt, request) => browser.runtime.sendMessage({
    type: 'page-fetch-diagnostics', action: 'append', sessionId: request.sessionId, url: request.url, attempt,
  }),
});

export default defineContentScript({
  // The whole site: build pages are often reached by in-app navigation, which doesn't inject scripts.
  matches: ['https://mobalytics.gg/*', 'https://www.mobalytics.gg/*'],
  runAt: 'document_idle',
  async main(ctx) {
    let invalidated = false;
    ctx.onInvalidated(() => {
      invalidated = true;
      setPageLocked(document, false);
      document.documentElement.removeAttribute(MARKER_ATTRIBUTE);
    });

    const initialMode = await readPreference(pageModeItem, 'extension');
    if (invalidated) return;
    const load = createBuildLoader({
      initialUrl: location.href,
      initialDocument: document,
      fetchHtml,
      readStaticData: () => readStaticData({ idb: indexedDbCandidates(), timeoutMs: 10_000 }),
    });
    const controller = createPageController({
      load,
      initialMode,
      onModeChange: (mode) => { if (!invalidated) writePreference(pageModeItem, mode); },
    });

    controller.subscribe((state) => {
      setPageLocked(document, isOverlayVisible(state));
      if (state.active) document.documentElement.setAttribute(MARKER_ATTRIBUTE, 'active');
      else document.documentElement.removeAttribute(MARKER_ATTRIBUTE);
    });
    let mounting: Promise<void> | null = null;
    const handleUrl = async (url: string) => {
      if (invalidated) return;
      if (isBuildPageUrl(url)) {
        mounting ??= Promise.all([
          readPreference(headerCollapsedItem, false),
          readPreference(lastTabsItem, {}),
          readPreference(lastVariantsItem, {}),
        ]).then(([headerCollapsed, lastTabs, lastVariants]) =>
          invalidated ? undefined : mountApp(ctx, controller, {
            headerCollapsed,
            onHeaderCollapsedChange: (collapsed) => { if (!invalidated) writePreference(headerCollapsedItem, collapsed); },
            lastTabs,
            onLastTabChange: (buildSlug, tab) => {
              if (invalidated) return;
              void readPreference(lastTabsItem, {}).then((remembered) => {
                if (!invalidated) writePreference(lastTabsItem, rememberPerBuild(remembered, buildSlug, tab));
              });
            },
            lastVariants,
            onVariantChange: (buildSlug, variant) => {
              if (invalidated) return;
              void readPreference(lastVariantsItem, {}).then((remembered) => {
                if (!invalidated) writePreference(lastVariantsItem, rememberPerBuild(remembered, buildSlug, variant));
              });
            },
          }).then((host) => {
            if (!invalidated && host) ctx.onInvalidated(guardFocus({ doc: document, host, isActive: () => isOverlayVisible(controller.getState()) }));
          }),
        ).catch((error: unknown) => {
          if (!invalidated) console.warn('[poe2ultra] Could not mount build guide UI:', error);
        });
        await mounting;
      }
      if (invalidated) return;
      controller.handleUrl(url);
    };
    ctx.addEventListener(window, 'wxt:locationchange', (event) => { if (!invalidated) void handleUrl(event.newUrl.href); });
    await handleUrl(location.href);

    if (import.meta.env.DEV) {
      const loadStaticData = () => readStaticData({ idb: indexedDbCandidates(), timeoutMs: 5_000 });
      const capture = () => captureFixture({ url: location.href, loadPage: () => fetchHtml(location.href), readStaticData: loadStaticData });
      ctx.onInvalidated(listenForCapture(browser.runtime.onMessage as never, capture));
      ctx.onInvalidated(listenForPageCapture(document, capture));

      const loadBuild = async () => {
        const result = await load(location.href);
        if (!result.ok) throw new Error(result.message);
        return result.build;
      };
      ctx.onInvalidated(
        listenForPageReport(document, { event: 'poe2-build-guide:parse', attribute: 'data-poe2-build-guide-parse' }, async () =>
          summarizeBuild(await loadBuild()),
        ),
      );
      ctx.onInvalidated(
        listenForPageReport(document, { event: 'poe2-build-guide:preview', attribute: 'data-poe2-build-guide-preview' }, async () => {
          // Dynamic import keeps the preview's CSS out of the production bundle.
          const { togglePreview } = await import('@/ui/dev/mount-preview');
          return { shown: await togglePreview(ctx, loadBuild) };
        }),
      );
    }
  },
});

async function readPreference<T>(item: { getValue: () => Promise<T> }, fallback: T): Promise<T> {
  try {
    return await item.getValue();
  } catch {
    return fallback;
  }
}

function writePreference<T>(item: { setValue: (value: T) => Promise<unknown> }, value: T): void {
  try {
    void item.setValue(value).catch(() => {});
  } catch {
    // Extension contexts can be invalidated between a UI event and its storage write.
  }
}
