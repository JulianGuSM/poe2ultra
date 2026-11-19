import { ChevronsDown, ChevronsUp, LogOut, Settings, TriangleAlert } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Build } from '@/lib/build/model';
import { availableTabs, formatRoute, parseRoute, type RememberedVariant, type Route, type TabId } from '@/lib/ui/route';
import { TooltipProvider } from '@/ui/tooltip/Tooltip';
import { BuildHeader } from './BuildHeader';
import { GearPanel } from '@/ui/gear/GearPanel';
import { AtlasPanel } from '@/ui/passives/AtlasPanel';
import { PassivesPanel } from '@/ui/passives/PassivesPanel';
import { ProgressionPanel } from '@/ui/progression/ProgressionPanel';
import { SkillsPanel } from '@/ui/skills/SkillsPanel';
import { OverviewPanel } from './OverviewPanel';
import { VariantPicker } from './VariantPicker';
import { panelElementId, tabElementId, Tabs } from './Tabs';
import { useTranslation } from '@/ui/translation/useTranslation';
import { TranslationProvider } from '@/ui/translation/BilingualText';
import { TranslationBar } from '@/ui/translation/TranslationBar';
import { ToastProvider } from '@/ui/common/Toast';

/** Tabs that fill the panel and give tall content its own scroll area. */
const FILL_TABS: TabId[] = ['passives', 'atlas', 'progression', 'skills'];

export interface BuildViewProps {
  build: Build;
  initialHash: string;
  onRouteChange: (hash: string) => void;
  onOriginal: () => void;
  /** Hash changes made outside the UI (typing in the address bar, back/forward). Returns an unsubscribe. */
  subscribeToHash?: (onHash: (hash: string) => void) => () => void;
  headerCollapsed: boolean;
  onHeaderCollapsedChange: (collapsed: boolean) => void;
  /** Tab to open when the hash names none, e.g. the one used last. */
  defaultTab?: TabId;
  /** The user picked another tab (not called for variant changes). */
  onTabChange?: (tab: TabId) => void;
  /** Variant to open when the address names none, e.g. the one this build was last read at. */
  defaultVariant?: RememberedVariant | null;
  /** The user picked another variant. */
  onVariantChange?: (variant: RememberedVariant) => void;
}

const NO_VARIANTS = "The author hasn't added build variants yet.";
const DATA_WARNING = 'Game data could not be loaded: some names, icons and tooltips are missing. Reload the page to try again.';

export function BuildView({
  build: sourceBuild,
  initialHash,
  onRouteChange,
  onOriginal,
  subscribeToHash,
  headerCollapsed,
  onHeaderCollapsedChange,
  defaultTab,
  onTabChange,
  defaultVariant,
  onVariantChange,
}: BuildViewProps) {
  const translation = useTranslation(sourceBuild);
  const build = translation.build;
  const tabs = availableTabs(build);
  const [route, setRoute] = useState<Route>(() => parseRoute(initialHash, sourceBuild, defaultTab, defaultVariant));
  const [passivesMounted, setPassivesMounted] = useState(route.tab === 'passives');

  useEffect(() => subscribeToHash?.((hash) => setRoute(parseRoute(hash, sourceBuild))), [subscribeToHash, sourceBuild]);
  useEffect(() => {
    if (route.tab === 'passives') setPassivesMounted(true);
  }, [route.tab]);

  const navigate = (next: Route) => {
    if (next.tab !== route.tab) onTabChange?.(next.tab);
    if (next.variantId !== route.variantId) {
      const picked = sourceBuild.variants.find((v) => v.id === next.variantId);
      if (picked) onVariantChange?.({ id: picked.id, title: picked.title });
    }
    setRoute(next);
    onRouteChange(formatRoute(next, sourceBuild));
  };
  const selectTab = (tab: TabId) => navigate({ ...route, tab });
  const selectVariant = (variantId: string) => navigate({ ...route, variantId });

  useNumberHotkeys((index) => {
    const tab = tabs[index];
    if (tab) selectTab(tab.id);
  });

  const tab = tabs.find((t) => t.id === route.tab)!;
  const variant = build.variants.find((v) => v.id === route.variantId) ?? build.variants[0];
  if (translation.initialCacheRead) {
    const { checked, total } = translation.cacheReadProgress;
    const percent = total ? Math.min(100, Math.floor(checked / total * 100)) : 0;
    return <div class="translation-cache-loading">
      <div class="translation-cache-loading__card">
        <div class="translation-cache-loading__status" role="status" aria-live="polite">
          <strong>正在读取翻译缓存</strong>
          <progress aria-label="缓存读取进度" value={checked} max={Math.max(total, 1)} />
          <span>{checked.toLocaleString('zh-CN')} / {total.toLocaleString('zh-CN')} 个文字块 · {percent}%</span>
        </div>
        <button type="button" class="button" aria-label="Show original page" onClick={onOriginal}>Show original page</button>
      </div>
    </div>;
  }
  return (
    <TranslationProvider records={translation.state.records} segments={translation.plan.segments} locale={translation.locale} busy={translation.busy} retryingKeys={translation.retryingKeys} retranslateMode={translation.retranslateMode} onRetranslate={translation.retranslate}><ToastProvider><TooltipProvider resetKey={`${build.id}:${route.tab}:${route.variantId}`}>
      <div class="build-view">
        {!headerCollapsed && <BuildHeader build={build} />}
        <div class="tab-bar">
          <Tabs tabs={tabs} selected={route.tab} onSelect={selectTab} />
          <div class="tab-bar__side">
            {!build.hasStaticData && (
              <span class="data-warning" title={DATA_WARNING}>
                <TriangleAlert size={16} role="img" aria-label="Game data unavailable" />
              </span>
            )}
            <TranslationBar translation={translation} />
            <button type="button" class="icon-button" aria-label="插件设置" title="插件设置" onClick={translation.settings}>
              <Settings size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-button"
              aria-label={headerCollapsed ? 'Expand header' : 'Collapse header'}
              title={headerCollapsed ? 'Expand header' : 'Collapse header'}
              aria-expanded={!headerCollapsed}
              onClick={() => onHeaderCollapsedChange(!headerCollapsed)}
            >
              {headerCollapsed ? <ChevronsDown size={16} aria-hidden="true" /> : <ChevronsUp size={16} aria-hidden="true" />}
            </button>
            <button type="button" class="icon-button" aria-label="Show original page" title="Show original page" onClick={onOriginal}>
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <section
          class={FILL_TABS.includes(route.tab) ? 'build-view__panel build-view__panel--fill' : 'build-view__panel'}
          role="tabpanel"
          id={panelElementId(route.tab)}
          aria-labelledby={tabElementId(route.tab)}
        >
          {tab.hasVariant && route.tab !== 'progression' && <VariantPicker variants={build.variants} selectedId={variant?.id ?? null} onChange={selectVariant} />}
          {route.tab === 'overview' && (
            <OverviewPanel build={build} />
          )}
          {tab.hasVariant && !variant && <p class="panel-empty">{NO_VARIANTS}</p>}
          {route.tab === 'gear' && variant && <GearPanel variant={variant} variantIndex={build.variants.indexOf(variant)} entities={build.entities} />}
          {route.tab === 'skills' && variant && <SkillsPanel key={variant.id} variant={variant} entities={build.entities} />}
          {passivesMounted && variant && (
            <div style={route.tab === 'passives' ? { display: 'contents' } : { display: 'none' }} aria-hidden={route.tab !== 'passives'}>
              <PassivesPanel
                variant={variant}
                sourceVariant={sourceBuild.variants[build.variants.indexOf(variant)] ?? variant}
                variantIndex={build.variants.indexOf(variant)}
                active={route.tab === 'passives'}
                entities={build.entities}
              />
            </div>
          )}
          {route.tab === 'atlas' && variant && <AtlasPanel variant={variant} variantIndex={build.variants.indexOf(variant)} entities={build.entities} />}
          {route.tab === 'progression' && variant && (
            <ProgressionPanel build={build} variant={variant} onSelectVariant={selectVariant} onOpenTab={selectTab} />
          )}
        </section>
      </div>
    </TooltipProvider></ToastProvider></TranslationProvider>
  );
}

/**
 * Keys 1–9 without modifiers, outside text fields. Listens in the capture phase: the UI's shadow root
 * stops key events from bubbling to the page.
 */
function useNumberHotkeys(onNumber: (index: number) => void) {
  const handler = useRef(onNumber);
  handler.current = onNumber;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!/^[1-9]$/.test(event.key) || isEditable(event.composedPath()[0])) return;
      handler.current(Number(event.key) - 1);
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, []);
}

function isEditable(target: EventTarget | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
