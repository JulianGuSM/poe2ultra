import { FOCUS_ALLOWED_ATTRIBUTE } from '@/lib/page/focus-guard';
import type { Passive } from '@/lib/build/model';
import { SETTINGS_KEY } from '@/lib/translation/settings';
import { findTreeSection, findTreeSlot, findVariantSection, selectSiteVariant, type TreeKind } from './site-tree';

export type TreeEmbedStatus = 'loading' | 'ready' | 'missing';

export interface TreeEmbed {
  setVariant(variantIndex: number): void;
  setActive(active: boolean): void;
  setPassiveCandidates(passives: Passive[]): void;
  /** Re-reads the site and the placeholder position. */
  sync(): void;
  destroy(): void;
}

const TOP = '2147483647';
// Until the site has hydrated it ignores clicks, and it may scroll the page back: try again while nothing happens.
const RETRY_MS = 1000;
// The site renders tooltips (tippy) at z-index 9999, under the guide.
const PAGE_CSS = '[data-tippy-root] { z-index: 2147483647 !important; }';

/**
 * Shows the site's own passive tree inside the guide: the tree block stays where the site renders it, but is laid
 * over the placeholder with fixed positioning, so the site keeps running it (zoom, pan, tooltips, variant changes).
 * Everything touched on the page is put back on destroy.
 */
export function embedSiteTree({
  doc,
  win,
  kind = 'passive-tree',
  placeholder,
  variantIndex,
  active = true,
  passiveCandidates = [],
  onPassiveClick = () => {},
  onStatus,
}: {
  doc: Document;
  win: Window;
  kind?: TreeKind;
  placeholder: HTMLElement;
  variantIndex: number;
  active?: boolean;
  passiveCandidates?: Passive[];
  onPassiveClick?: (passive: Passive, anchor: HTMLElement) => void;
  onStatus: (status: TreeEmbedStatus) => void;
}): TreeEmbed {
  let wanted = variantIndex;
  let isActive = active;
  let candidates = passiveCandidates;
  let status: TreeEmbedStatus | null = null;
  let slot: { element: HTMLElement; style: string | null } | null = null;
  const containers = new Map<HTMLElement, string>();
  let clickedFor = new WeakMap<HTMLElement, number>();
  let scrolled = new WeakSet<HTMLElement>();
  // Retries alternate between scrolling the page away and back: the site only reacts to the tree coming into view.
  let scrollAway = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let savedScroll: { x: number; y: number } | null = null;
  // The site rewrites the URL for a variant and drops the hash the guide keeps its route in.
  let hashBeforeClick = '';
  let destroyed = false;
  let debugEnabled = false;
  let mutationBatches = 0;
  let mutationRecords = 0;
  let mutationReportTimer: ReturnType<typeof setTimeout> | null = null;

  const log = (event: string, details: Record<string, unknown> = {}) => {
    if (debugEnabled) console.info('[poe2ultra passive tree]', event, { kind, ...details });
  };
  const refreshDebugSetting = () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    void chrome.storage.local.get(SETTINGS_KEY).then((saved) => {
      const settings = saved[SETTINGS_KEY] as { advancedSettingsEnabled?: boolean; passiveTreeDebugEnabled?: boolean } | undefined;
      const wasEnabled = debugEnabled;
      debugEnabled = settings?.advancedSettingsEnabled === true && settings?.passiveTreeDebugEnabled === true;
      if (debugEnabled && !wasEnabled) log('debug logging enabled');
    }).catch(() => {});
  };
  refreshDebugSetting();
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && SETTINGS_KEY in changes) refreshDebugSetting();
  };
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) chrome.storage.onChanged.addListener(onStorageChanged);

  // The canvas remains in the site's DOM, outside the guide's shadow root. Catch Ctrl+wheel
  // before either tree handles it, including overlays and gaps while the site remounts a variant.
  const preventPageZoom = (event: WheelEvent) => {
    if (!event.ctrlKey || !event.cancelable || !placeholder.isConnected) return;
    const box = placeholder.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const path = event.composedPath();
    const overTree = path.includes(placeholder) || (slot !== null && path.includes(slot.element))
      || (event.clientX >= box.left && event.clientX < box.right
        && event.clientY >= box.top && event.clientY < box.bottom);
    // Cancel only the browser default; the site's wheel handlers still receive the event.
    if (overTree) event.preventDefault();
  };
  win.addEventListener('wheel', preventPageZoom, { capture: true, passive: false });

  const pageStyle = doc.createElement('style');
  pageStyle.textContent = PAGE_CSS;
  doc.head.append(pageStyle);

  const setStatus = (next: TreeEmbedStatus, details: Record<string, unknown> = {}) => {
    if (next === 'loading') scheduleRetry();
    else stopRetry();
    if (next === status) return;
    log('status', { from: status, to: next, ...details });
    status = next;
    onStatus(next);
  };

  const scheduleRetry = () => {
    retryTimer ??= setTimeout(() => {
      retryTimer = null;
      clickedFor = new WeakMap();
      scrolled = new WeakSet();
      scrollAway = !scrollAway;
      log('retry', { wantedVariant: wanted, scrollAway });
      sync();
    }, RETRY_MS);
  };

  const stopRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const releaseSlot = () => {
    if (!slot) return;
    const { element, style } = slot;
    if (style === null) element.removeAttribute('style');
    else element.setAttribute('style', style);
    element.removeAttribute(FOCUS_ALLOWED_ATTRIBUTE);
    slot = null;
  };

  const liftContainers = (element: HTMLElement) => {
    // Size containment makes an ancestor the containing block of fixed elements, which would break the overlay.
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (containers.has(node)) continue;
      containers.set(node, node.style.getPropertyValue('container-type'));
      node.style.setProperty('container-type', 'normal', 'important');
    }
  };

  const place = () => {
    if (!slot) return;
    const box = placeholder.getBoundingClientRect();
    const style = slot.element.style;
    style.setProperty('position', 'fixed', 'important');
    style.setProperty('left', `${box.left}px`, 'important');
    style.setProperty('top', `${box.top}px`, 'important');
    style.setProperty('width', `${box.width}px`, 'important');
    style.setProperty('height', `${box.height}px`, 'important');
    style.setProperty('min-width', '0', 'important');
    style.setProperty('min-height', '0', 'important');
    style.setProperty('margin', '0', 'important');
    style.setProperty('z-index', TOP, 'important');
  };

  const restoreHash = () => {
    if (hashBeforeClick && !win.location.hash) win.history.replaceState(win.history.state, '', hashBeforeClick);
  };

  const passiveAtPointer = () => {
    if (!slot) return null;
    const tooltips = [...doc.querySelectorAll<HTMLElement>('[data-tippy-root]')]
      .filter((tooltip) => tooltip.getClientRects().length > 0);
    for (const tooltip of tooltips) {
      const text = (tooltip.querySelector<HTMLElement>('.tippy-content')?.innerText ?? tooltip.innerText ?? '').trim();
      if (!text) continue;
      const passive = candidates.find((candidate) => candidate.name && text.includes(candidate.name));
      if (passive) return { passive, anchor: tooltip };
    }
    return null;
  };

  const selectPassiveFromTree = (event: MouseEvent) => {
    if (!isActive || !slot || !event.composedPath().includes(slot.element)) return;
    const found = passiveAtPointer();
    if (!found) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onPassiveClick(found.passive, found.anchor);
  };

  const sync = () => {
    if (destroyed) return;
    const started = performance.now();
    const finish = (outcome: string, details: Record<string, unknown> = {}) => {
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      if (durationMs >= 25) log('slow sync', { durationMs, outcome, ...details });
    };
    if (!isActive) {
      releaseSlot();
      finish('inactive');
      return;
    }
    restoreHash();
    const lookupStarted = performance.now();
    const found = findTreeSection(doc, kind);
    const lookupMs = Math.round((performance.now() - lookupStarted) * 100) / 100;
    if (!found || found.variantIndex !== wanted) {
      releaseSlot();
      // Without a tree section (e.g. no atlas for the variant the site shows), switch through another widget.
      const shown = found ?? findVariantSection(doc);
      if (!shown || shown.variantIndex === wanted) {
        setStatus('missing', { reason: 'variant section unavailable', wantedVariant: wanted, foundVariant: found?.variantIndex ?? null, lookupMs });
        finish('missing', { lookupMs });
        return;
      }
      const { section } = shown;
      if (clickedFor.get(section) !== wanted) {
        hashBeforeClick = win.location.hash;
        if (selectSiteVariant(section, wanted)) clickedFor.set(section, wanted);
        restoreHash();
      }
      setStatus('loading', { reason: 'switching site variant', wantedVariant: wanted, foundVariant: shown.variantIndex, lookupMs });
      finish('switching variant', { lookupMs });
      return;
    }

    const { section } = found;
    // Once taken, keep the block: with its minimum height lowered, a new lookup would pick an outer one.
    const keep = slot && section.contains(slot.element) && slot.element.querySelector('canvas');
    const element = keep ? slot!.element : findTreeSlot(section);
    if (!element) {
      releaseSlot();
      if (!scrolled.has(section)) {
        // The site creates the tree lazily, once its section comes into view.
        savedScroll ??= { x: win.scrollX, y: win.scrollY };
        scrolled.add(section);
        if (scrollAway) win.scrollTo(0, 0);
        else section.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      setStatus('loading', { reason: 'waiting for tree canvas', wantedVariant: wanted, lookupMs, scrolledIntoView: scrolled.has(section) });
      finish('waiting for canvas', { lookupMs });
      return;
    }

    if (slot?.element !== element) {
      releaseSlot();
      slot = { element, style: element.getAttribute('style') };
      // Its zoom buttons stay reachable from the keyboard while the guide keeps focus to itself.
      element.setAttribute(FOCUS_ALLOWED_ATTRIBUTE, '');
      liftContainers(element);
    }
    place();
    setStatus('ready', { reason: 'tree canvas found', wantedVariant: wanted, lookupMs });
    finish('ready', { lookupMs });
  };

  let pending = false;
  const observer = new MutationObserver((records) => {
    if (debugEnabled) {
      mutationBatches++;
      mutationRecords += records.length;
      if (mutationReportTimer === null) {
        mutationReportTimer = setTimeout(() => {
          mutationReportTimer = null;
          log('DOM mutation activity', { batches: mutationBatches, records: mutationRecords, status });
          mutationBatches = 0;
          mutationRecords = 0;
        }, 5000);
      }
    }
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      sync();
    });
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('click', selectPassiveFromTree, true);

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
  resizeObserver?.observe(placeholder);
  win.addEventListener('resize', place);

  sync();

  return {
    setVariant(index) {
      wanted = index;
      sync();
    },
    setActive(active) {
      if (isActive === active) return;
      isActive = active;
      if (active) sync();
      else releaseSlot();
    },
    setPassiveCandidates(passives) {
      candidates = passives;
    },
    sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopRetry();
      observer.disconnect();
      doc.removeEventListener('click', selectPassiveFromTree, true);
      resizeObserver?.disconnect();
      win.removeEventListener('resize', place);
      win.removeEventListener('wheel', preventPageZoom, true);
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) chrome.storage.onChanged.removeListener(onStorageChanged);
      if (mutationReportTimer !== null) clearTimeout(mutationReportTimer);
      releaseSlot();
      containers.forEach((value, node) => {
        if (value) node.style.setProperty('container-type', value);
        else node.style.removeProperty('container-type');
      });
      pageStyle.remove();
      if (savedScroll) win.scrollTo(savedScroll.x, savedScroll.y);
    },
  };
}
