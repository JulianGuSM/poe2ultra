import { render } from 'preact';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { PageController } from '@/lib/page/controller';
import { isolateGuideKeyboard } from '@/lib/page/keyboard-isolation';
import type { RememberedVariant, TabId } from '@/lib/ui/route';
import { BASE_CSS } from '@/ui/styles';
import { registerFonts } from '@/ui/theme/fonts';
import { INTER_SOURCES } from '@/ui/theme/inter-sources';
import appCss from './app.css?inline';
import { ConnectedApp } from './App';

/** Mounts the extension UI in an isolated shadow root at the end of the page body; returns the shadow host. */
export async function mountApp(
  ctx: ContentScriptContext,
  controller: PageController,
  preferences: {
    headerCollapsed: boolean;
    onHeaderCollapsedChange: (collapsed: boolean) => void;
    lastTabs: Record<string, TabId>;
    onLastTabChange: (buildSlug: string, tab: TabId) => void;
    glanceCollapsed: boolean;
    onGlanceCollapsedChange: (collapsed: boolean) => void;
    lastVariants: Record<string, RememberedVariant>;
    onVariantChange: (buildSlug: string, variant: RememberedVariant) => void;
  },
): Promise<HTMLElement> {
  registerFonts({ fontSet: document.fonts, FontFace, sources: INTER_SOURCES });
  const ui = await createShadowRootUi(ctx, {
    name: 'poe2-build-guide',
    css: `${BASE_CSS}\n${appCss}`,
    position: 'inline',
    anchor: 'body',
    // Selectively isolate keyboard events so the site's tree still receives Ctrl state.
    isolateEvents: false,
    onMount: (container, shadow) => {
      const releaseKeyboard = isolateGuideKeyboard(shadow);
      render(
        <ConnectedApp
          controller={controller}
          initialHeaderCollapsed={preferences.headerCollapsed}
          onHeaderCollapsedChange={preferences.onHeaderCollapsedChange}
          initialLastTabs={preferences.lastTabs}
          onLastTabChange={preferences.onLastTabChange}
          initialGlanceCollapsed={preferences.glanceCollapsed}
          onGlanceCollapsedChange={preferences.onGlanceCollapsedChange}
          initialLastVariants={preferences.lastVariants}
          onVariantChange={preferences.onVariantChange}
        />,
        container,
      );
      return { container, releaseKeyboard };
    },
    onRemove: (mounted) => {
      if (!mounted) return;
      mounted.releaseKeyboard();
      render(null, mounted.container);
    },
  });
  ui.mount();
  return ui.shadowHost;
}
