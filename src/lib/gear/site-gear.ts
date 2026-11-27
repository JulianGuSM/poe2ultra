import { findVariantSection, selectSiteVariant, type WidgetSection } from '@/lib/passives/site-tree';

export type GearEmbedStatus = 'loading' | 'ready' | 'missing';

export interface GearEmbed {
  setVariant(variantIndex: number): void;
  sync(animate?: boolean): void;
  destroy(): void;
}

const TOP = '2147483647';
const RETRY_MS = 1000;
const gearLog = (label: string, details: unknown) => console.info(`[poe2ultra:gear] ${label} ${JSON.stringify(details)}`);

/** Locate and place the site's native equipment board over an extension-owned placeholder. */
export function embedSiteGear({
  doc,
  win,
  placeholder,
  variantIndex,
  itemIcons,
  jewelIcons,
  itemTradeUrls,
  socketableCounts,
  tradeLinkFor,
  onSelectItem,
  onSelectJewel,
  onSelectSocketable,
  onStatus,
}: {
  doc: Document;
  win: Window;
  placeholder: HTMLElement;
  variantIndex: number;
  itemIcons: Map<string, number[]>;
  jewelIcons: Map<string, number[]>;
  itemTradeUrls: (string | null)[];
  socketableCounts: number[];
  tradeLinkFor: (source: string) => { url?: string; error?: string };
  onSelectItem: (index: number, anchor: HTMLElement, portalParent: HTMLElement) => void;
  onSelectJewel: (index: number, anchor: HTMLElement, portalParent: HTMLElement) => void;
  onSelectSocketable: (equipmentIndex: number, socketableIndex: number, anchor: HTMLElement, portalParent: HTMLElement) => void;
  onStatus: (status: GearEmbedStatus) => void;
}): GearEmbed {
  let wanted = variantIndex;
  let status: GearEmbedStatus | null = null;
  let board: { element: HTMLElement; style: string | null } | null = null;
  let setControls: { element: HTMLElement; style: string | null; width: number; height: number; gap: number } | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedFor = new WeakMap<HTMLElement, number>();
  let destroyed = false;
  let moveFrame: number | null = null;
  const containers = new Map<HTMLElement, string>();
  const sourceTradeUrls = new Map<HTMLAnchorElement, string>();
  const scroller = placeholder.closest<HTMLElement>('.build-view__panel');
  const originalStageHeight = placeholder.style.getPropertyValue('--gear-native-height');
  const originalStageHeightPriority = placeholder.style.getPropertyPriority('--gear-native-height');

  const fitStageToBoard = () => {
    if (!board) return;
    // Jewels sit below the equipment grid. Grow the placeholder to the complete
    // native board height so its lower rows are not clipped by the preview size.
    const height = Math.ceil(Math.max(board.element.scrollHeight, board.element.getBoundingClientRect().height));
    const current = Number.parseFloat(placeholder.style.getPropertyValue('--gear-native-height'));
    if (Number.isFinite(current) && Math.abs(current - height) < 1) return;
    placeholder.style.setProperty('--gear-native-height', `${height}px`);
  };

  const setStatus = (next: GearEmbedStatus) => {
    if (next === 'loading') retryTimer ??= setTimeout(() => { retryTimer = null; sync(); }, RETRY_MS);
    else if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (status === next) return;
    status = next;
    onStatus(next);
  };

  const release = () => {
    for (const [anchor, source] of sourceTradeUrls) {
      if (anchor.isConnected && anchor.href !== source) anchor.href = source;
    }
    sourceTradeUrls.clear();
    for (const element of [board, setControls]) {
      if (!element) continue;
      if (element.style === null) element.element.removeAttribute('style');
      else element.element.setAttribute('style', element.style);
    }
    board = null;
    setControls = null;
  };

  const place = (animate = false) => {
    if (!board) return;
    fitStageToBoard();
    const box = placeholder.getBoundingClientRect();
    const panel = scroller?.getBoundingClientRect();
    const clip = {
      left: Math.max(0, panel?.left ?? 0),
      top: Math.max(0, panel?.top ?? 0),
      right: Math.min(win.innerWidth, panel?.right ?? win.innerWidth),
      bottom: Math.min(win.innerHeight, panel?.bottom ?? win.innerHeight),
    };
    const boardTop = box.top + (setControls?.height ?? 0) + (setControls?.gap ?? 0);
    const boardHeight = Math.max(0, box.height - (setControls?.height ?? 0) - (setControls?.gap ?? 0));
    const targets = [
      ...(setControls ? [{ element: setControls.element, left: box.left + (box.width - setControls.width) / 2, top: box.top, width: setControls.width, height: setControls.height }] : []),
      { element: board.element, left: box.left, top: boardTop, width: box.width, height: boardHeight },
    ];

    if (moveFrame !== null) {
      win.cancelAnimationFrame(moveFrame);
      moveFrame = null;
    }
    if (animate) {
      for (const target of targets) {
        const rect = target.element.getBoundingClientRect();
        const style = target.element.style;
        style.setProperty('transition', 'none', 'important');
        setPosition(style, rect.left, rect.top, rect.width, rect.height);
      }
      // Commit the old position before transitioning to the new placeholder coordinates.
      for (const target of targets) void target.element.offsetWidth;
      for (const target of targets) target.element.style.setProperty(
        'transition',
        'left 180ms ease-out, top 180ms ease-out, width 180ms ease-out, height 180ms ease-out, clip-path 180ms ease-out',
        'important',
      );
      moveFrame = win.requestAnimationFrame(() => {
        moveFrame = null;
        for (const target of targets) applyPosition(target, clip);
      });
      return;
    }

    for (const target of targets) {
      target.element.style.setProperty('transition', 'none', 'important');
      applyPosition(target, clip);
    }
  };

  const sync = (animate = false) => {
    if (destroyed) return;
    const found = findEquipmentSection(doc);
    if (!found || found.variantIndex !== wanted) {
      release();
      const source = found ?? findVariantSection(doc);
      if (source && selectedFor.get(source.section) !== wanted) {
        if (selectSiteVariant(source.section, wanted)) selectedFor.set(source.section, wanted);
      }
      setStatus(source ? 'loading' : 'missing');
      return;
    }
    const section = found.section;
    const links = [...section.querySelectorAll<HTMLElement>('a[href*="trade2/search"]')];
    for (const link of links) {
      const anchor = link as HTMLAnchorElement;
      let source = sourceTradeUrls.get(anchor);
      if (!source) {
        const href = normalizeUrlWithQuery(anchor.href, doc.baseURI);
        source = itemTradeUrls.find(value => value !== null && normalizeUrlWithQuery(value, doc.baseURI) === href) ?? undefined;
        if (source) sourceTradeUrls.set(anchor, source);
      }
      if (!source) continue;
      const destination = tradeLinkFor(source);
      const target = destination.url ?? source;
      if (anchor.href !== target) anchor.href = target;
    }
    const radioGroup = section.querySelector<HTMLElement>('[role="radiogroup"]');
    const boardElement = links.length ? commonAncestor(links) : null;
    const radios = [...section.querySelectorAll<HTMLElement>('[role="radio"]')];
    const controlsElement = radioGroup ?? (radios.length ? commonAncestor(radios) : null);
    if (!boardElement) {
      release();
      setStatus('loading');
      return;
    }
    if (board?.element !== boardElement || setControls?.element !== controlsElement) {
      release();
      const controlRect = controlsElement?.getBoundingClientRect();
      const boardRect = boardElement.getBoundingClientRect();
      board = { element: boardElement, style: boardElement.getAttribute('style') };
      boardResizeObserver?.disconnect();
      boardResizeObserver?.observe(boardElement);
      setControls = controlsElement && !boardElement.contains(controlsElement)
        ? {
            element: controlsElement,
            style: controlsElement.getAttribute('style'),
            width: controlRect?.width ?? 0,
            height: controlRect?.height ?? 0,
            gap: Math.max(0, (boardRect?.top ?? 0) - ((controlRect?.bottom ?? 0))),
          }
        : null;
      liftContainers(boardElement, containers);
      if (setControls) liftContainers(setControls.element, containers);
    }
    place(animate);
    setStatus('ready');
  };
  const placeImmediately = () => place();

  const onClick = (event: MouseEvent) => {
    if (!board || !(event.target instanceof Element)) return;
    const runeFillNode = findRuneFillElement(event.target);
    const runeTrigger = event.target.closest<HTMLElement>('[data-tippy-trigger="hover"]')
      ?? runeFillNode?.closest<HTMLElement>('[data-tippy-trigger="hover"], [data-tippy-delegate-id]')
      ?? runeFillNode;
    const clickDiagnostic = {
      target: describeElement(event.target),
      trigger: runeTrigger ? describeElement(runeTrigger) : null,
      triggerInBoard: !!runeTrigger && board.element.contains(runeTrigger),
      filled: !!runeFillNode,
      runeFillNode: runeFillNode ? describeElement(runeFillNode) : null,
      boardContainsTarget: board.element.contains(event.target),
    };
    if (runeFillNode) gearLog('socket click candidate', clickDiagnostic);
    if (runeFillNode && board.element.contains(runeFillNode)) {
      const detail = findRuneDetail(runeFillNode, board.element, itemIcons, itemTradeUrls, socketableCounts, doc.baseURI);
      if (detail) {
        gearLog('socket mapped', { ...detail, socketableCount: socketableCounts[detail.equipmentIndex] });
        event.preventDefault();
        event.stopPropagation();
        onSelectSocketable(detail.equipmentIndex, detail.socketableIndex, runeFillNode, board.element);
        return;
      }
      gearLog('socket mapping failed', { ...clickDiagnostic, socketableCounts, itemImageCount: board.element.querySelectorAll('img[alt="item"]').length });
    }
    const target = event.target.closest('img');
    if (!target || !board.element.contains(target)) return;
    const icon = normalizeUrl(target.currentSrc || target.src, doc.baseURI);
    const matchingImages = [...board.element.querySelectorAll<HTMLImageElement>('img')]
      .filter((image) => normalizeUrl(image.currentSrc || image.src, doc.baseURI) === icon);
    const occurrence = matchingImages.indexOf(target as HTMLImageElement);
    const position = Math.max(0, occurrence);
    const itemMatches = itemIcons.get(icon);
    const itemIndex = itemMatches?.[position] ?? itemMatches?.[0];
    if (itemIndex !== undefined) {
      // Equipment clicks open the translated detail supplied by the extension, instead of navigating to trade.
      event.preventDefault();
      event.stopPropagation();
      onSelectItem(itemIndex, target, board.element);
      return;
    }
    const jewelMatches = jewelIcons.get(icon);
    const jewelIndex = jewelMatches?.[position] ?? jewelMatches?.[0];
    if (jewelIndex !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      onSelectJewel(jewelIndex, target, board.element);
      return;
    }
  };
  doc.addEventListener('click', onClick, true);

  const onWheel = (event: WheelEvent) => {
    if (!event.cancelable || !scroller || !(event.target instanceof Node)) return;
    const overEmbeddedGear = [board?.element, setControls?.element].some((element) => element?.contains(event.target as Node));
    if (!overEmbeddedGear) return;
    // The board lives in the page DOM, so its wheel event would otherwise scroll Mobalytics behind the fixed guide.
    event.preventDefault();
    scroller.scrollBy({ top: event.deltaY, left: event.deltaX });
  };
  win.addEventListener('wheel', onWheel, { capture: true, passive: false });

  let pending = false;
  const observer = new MutationObserver((records) => {
    if (!records.some((record) => record.type === 'childList' ||
      (record.type === 'attributes' && record.attributeName === 'href' && record.target instanceof HTMLAnchorElement &&
        record.target.matches('a[href*="trade2/search"]')))) return;
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; sync(); });
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(placeImmediately);
  resizeObserver?.observe(placeholder);
  const boardResizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    fitStageToBoard();
    placeImmediately();
  });
  win.addEventListener('resize', placeImmediately);
  // The embedded nodes are fixed in the page DOM; follow scrolling from the guide panel and any ancestor scroller.
  win.addEventListener('scroll', placeImmediately, true);
  sync();

  return {
    setVariant(index) { wanted = index; sync(); },
    sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (moveFrame !== null) win.cancelAnimationFrame(moveFrame);
      observer.disconnect();
      resizeObserver?.disconnect();
      win.removeEventListener('resize', placeImmediately);
      win.removeEventListener('scroll', placeImmediately, true);
      win.removeEventListener('wheel', onWheel, true);
      doc.removeEventListener('click', onClick, true);
      boardResizeObserver?.disconnect();
      release();
      if (originalStageHeight) placeholder.style.setProperty('--gear-native-height', originalStageHeight, originalStageHeightPriority);
      else placeholder.style.removeProperty('--gear-native-height');
      containers.forEach((value, node) => {
        if (value) node.style.setProperty('container-type', value);
        else node.style.removeProperty('container-type');
      });
    },
  };
}

function findEquipmentSection(doc: Document): WidgetSection | null {
  const pattern = /-equipment-(\d+)$/;
  for (const anchor of doc.querySelectorAll<HTMLElement>('span[id]')) {
    const match = pattern.exec(anchor.id);
    if (match && anchor.parentElement?.querySelector('[role=tab]')) {
      return { section: anchor.parentElement, variantIndex: Number(match[1]) };
    }
  }
  return null;
}

function commonAncestor(links: HTMLElement[]): HTMLElement | null {
  const [first, ...rest] = links;
  if (!first) return null;
  for (let node: HTMLElement | null = first; node; node = node.parentElement) {
    if (rest.every((link) => node.contains(link))) return node;
  }
  return null;
}

function liftContainers(element: HTMLElement, saved: Map<HTMLElement, string>) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (saved.has(node)) continue;
    saved.set(node, node.style.getPropertyValue('container-type'));
    node.style.setProperty('container-type', 'normal', 'important');
  }
}

function setPosition(style: CSSStyleDeclaration, left: number, top: number, width: number, height: number) {
  style.setProperty('position', 'fixed', 'important');
  style.setProperty('left', `${left}px`, 'important');
  style.setProperty('top', `${top}px`, 'important');
  style.setProperty('width', `${width}px`, 'important');
  style.setProperty('height', `${height}px`, 'important');
  style.setProperty('min-width', '0', 'important');
  style.setProperty('min-height', '0', 'important');
  style.setProperty('margin', '0', 'important');
  style.setProperty('z-index', TOP, 'important');
}

function applyPosition(
  target: { element: HTMLElement; left: number; top: number; width: number; height: number },
  bounds: { left: number; top: number; right: number; bottom: number },
) {
  setPosition(target.element.style, target.left, target.top, target.width, target.height);
  clipElement(target.element.style, target.left, target.top, target.width, target.height, bounds);
}

function clipElement(
  style: CSSStyleDeclaration,
  left: number,
  top: number,
  width: number,
  height: number,
  bounds: { left: number; top: number; right: number; bottom: number },
) {
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    style.setProperty('clip-path', 'inset(100%)', 'important');
    return;
  }
  const topInset = Math.max(0, bounds.top - top);
  const rightInset = Math.max(0, left + width - bounds.right);
  const bottomInset = Math.max(0, top + height - bounds.bottom);
  const leftInset = Math.max(0, bounds.left - left);
  const inset = `inset(${topInset}px ${rightInset}px ${bottomInset}px ${leftInset}px)`;
  style.setProperty('clip-path', inset, 'important');
  style.setProperty('-webkit-clip-path', inset, 'important');
}

function normalizeUrl(value: string, base: string): string {
  try {
    const url = new URL(value, base);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function normalizeUrlWithQuery(value: string, base: string): string {
  try {
    const url = new URL(value, base);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function describeElement(element: Element): Record<string, string | null> {
  const html = element as HTMLElement;
  return {
    tag: element.tagName.toLowerCase(),
    class: typeof html.className === 'string' ? html.className.slice(0, 160) : null,
    tippyTrigger: element.getAttribute('data-tippy-trigger'),
    tippyId: element.getAttribute('data-tippy-delegate-id'),
    backgroundImage: html.style?.backgroundImage?.slice(0, 180) ?? null,
  };
}

function findRuneFillElement(element: Element): HTMLElement | null {
  const own = element as HTMLElement;
  if (isRuneFillElement(own)) return own;
  return [...element.querySelectorAll<HTMLElement>('[style]')]
    .find(isRuneFillElement) ?? null;
}

function isRuneFillElement(element: HTMLElement): boolean {
  return element.style.backgroundImage.toLowerCase().includes('runesocketfilled');
}

function findRuneDetail(
  trigger: HTMLElement,
  board: HTMLElement,
  itemIcons: Map<string, number[]>,
  itemTradeUrls: (string | null)[],
  socketableCounts: number[],
  baseUrl: string,
): { equipmentIndex: number; socketableIndex: number } | null {
  const itemImages = [...board.querySelectorAll<HTMLImageElement>('img[alt="item"]')]
    .map(image => ({ image, url: normalizeUrl(image.currentSrc || image.src, baseUrl) }))
    .filter(({ url }) => itemIcons.has(url));
  if (!itemImages.length) {
    gearLog('resolver stopped: no item images matched the build icon URLs', {
      boardItemImages: [...board.querySelectorAll<HTMLImageElement>('img[alt="item"]')].map(image => normalizeUrl(image.currentSrc || image.src, baseUrl)),
      knownIconUrls: [...itemIcons.keys()],
    });
    return null;
  }

  const equipmentIndexFor = (image: HTMLImageElement, url: string): number | undefined => {
    // Prefer the source item's trade link: unlike icon ordering, it uniquely identifies
    // the equipped entry when two slots share a base-item image.
    for (let scope: HTMLElement | null = image; scope && scope !== board; scope = scope.parentElement) {
      const links = [...scope.querySelectorAll<HTMLAnchorElement>('a[href*="trade2/search"]')];
      const matches = new Set(links.flatMap(link => {
        const href = normalizeUrlWithQuery(link.href, baseUrl);
        return itemTradeUrls.flatMap((value, index) => value !== null && normalizeUrlWithQuery(value, baseUrl) === href ? [index] : []);
      }));
      if (matches.size === 1) return [...matches][0];
    }
    const matches = itemIcons.get(url);
    if (!matches?.length) return undefined;
    const occurrence = itemImages.filter(candidate => candidate.url === url).findIndex(candidate => candidate.image === image);
    return matches[occurrence] ?? matches[0];
  };
  const filledTriggers = [...board.querySelectorAll<HTMLElement>('[style]')]
    .filter(isRuneFillElement);
  gearLog('resolver inventory', {
      clickedSocket: describeElement(trigger),
    itemImages: itemImages.map(({ image, url }) => ({ url, rect: rectSummary(image.getBoundingClientRect()) })),
    filledTriggerCount: filledTriggers.length,
    socketableCounts,
    tradeLinkCount: board.querySelectorAll('a[href*="trade2/search"]').length,
  });

  // The source renders the 40×40 socket hover target as a positioned sibling layer,
  // not as a child of the item's <img>. First pair it with the closest shared DOM
  // container that owns exactly one equipment image; this is stable across scaling.
  for (let scope = trigger.parentElement; scope && scope !== board; scope = scope.parentElement) {
    const images = [...scope.querySelectorAll<HTMLImageElement>('img[alt="item"]')]
      .map(image => ({ image, url: normalizeUrl(image.currentSrc || image.src, baseUrl) }))
      .filter(({ url }) => itemIcons.has(url));
    if (images.length !== 1) continue;
    const owner = images[0]!;
    const equipmentIndex = equipmentIndexFor(owner.image, owner.url);
    if (equipmentIndex === undefined) continue;
    const runeTriggers = filledTriggers.filter(candidate => scope.contains(candidate));
    const socketableIndex = runeTriggers.indexOf(trigger);
    gearLog('resolver shared container candidate', {
      scope: describeElement(scope), imageUrl: owner.url, equipmentIndex, socketableIndex,
      runeTriggerCount: runeTriggers.length,
    });
    if (socketableIndex >= 0 && socketableIndex < (socketableCounts[equipmentIndex] ?? 0)) {
      return { equipmentIndex, socketableIndex };
    }
  }

  // Some versions position every piece of equipment directly under one board node.
  // In that layout pair each socket with the nearest full item-image box, including
  // sockets that sit just outside the image's rectangle. The old strict containment
  // check silently dropped these clicks.
  const distanceToImage = (candidate: HTMLElement, image: HTMLImageElement) => {
    const socket = candidate.getBoundingClientRect();
    const item = image.getBoundingClientRect();
    const x = socket.left + socket.width / 2;
    const y = socket.top + socket.height / 2;
    const dx = x < item.left ? item.left - x : x > item.right ? x - item.right : 0;
    const dy = y < item.top ? item.top - y : y > item.bottom ? y - item.bottom : 0;
    return Math.hypot(dx, dy);
  };
  const ownerFor = (candidate: HTMLElement) => [...itemImages]
    .map(entry => ({ ...entry, distance: distanceToImage(candidate, entry.image) }))
    .sort((a, b) => a.distance - b.distance)[0];
  const owner = ownerFor(trigger);
  gearLog('resolver nearest image candidate', owner ? {
    url: owner.url, distance: owner.distance, rect: rectSummary(owner.image.getBoundingClientRect()),
  } : null);
  if (!owner || owner.distance > Math.max(96, trigger.getBoundingClientRect().width * 2)) return null;
  const equipmentIndex = equipmentIndexFor(owner.image, owner.url);
  if (equipmentIndex === undefined) return null;
  const runeTriggers = filledTriggers.filter(candidate => ownerFor(candidate)?.image === owner.image);
  const socketableIndex = runeTriggers.indexOf(trigger);
  gearLog('resolver nearest mapping', { equipmentIndex, socketableIndex, runeTriggerCount: runeTriggers.length, allowedCount: socketableCounts[equipmentIndex] ?? 0 });
  return socketableIndex >= 0 && socketableIndex < (socketableCounts[equipmentIndex] ?? 0)
    ? { equipmentIndex, socketableIndex }
    : null;
}

function rectSummary(rect: DOMRect): { left: number; top: number; width: number; height: number } {
  return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
}
