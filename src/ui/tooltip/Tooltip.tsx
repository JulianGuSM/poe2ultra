import { BilingualText } from '@/ui/translation/BilingualText';
import { TranslationContext } from '@/ui/translation/BilingualText';
import type { ComponentChildren } from 'preact';
import { createContext, render } from 'preact';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { type Placement, placeTooltip } from '@/lib/tooltip/placement';
import type { TooltipModel } from '@/lib/tooltip/tooltip-model';
import { Icon } from '@/ui/common/Icon';

const TOOLTIP_ID = 'guide-tooltip';

interface TooltipApi {
  open(anchor: HTMLElement, model: TooltipModel): void;
  close(anchor?: HTMLElement): void;
  openAnchor: HTMLElement | null;
}

const TooltipContext = createContext<TooltipApi | null>(null);

/** One persistent, non-modal detail card; another hover cannot replace it until dismissed. */
export function TooltipProvider({ children, resetKey }: { children: ComponentChildren; resetKey?: string }) {
  const [open, setOpen] = useState<{ anchor: HTMLElement; model: TooltipModel } | null>(null);
  const close = useCallback((anchor?: HTMLElement) => setOpen(current => (!anchor || current?.anchor === anchor ? null : current)), []);
  useEffect(() => close(), [resetKey, close]);

  const api = useMemo<TooltipApi>(
    () => ({
      open: (anchor, model) => setOpen(current => current ?? { anchor, model }),
      close,
      openAnchor: open?.anchor ?? null,
    }),
    [open, close],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  return (
    <TooltipContext.Provider value={api}>
      {children}
      {open && <TooltipOutsideOverlay anchor={open.anchor} model={open.model} onClose={() => close()} />}
    </TooltipContext.Provider>
  );
}

export function WithTooltip({ model, children }: { model: TooltipModel | null; children: ComponentChildren }) {
  const api = useContext(TooltipContext);
  const ref = useRef<HTMLSpanElement>(null);

  const close = api?.close;
  useEffect(() => {
    const anchor = ref.current;
    return () => {
      if (anchor) close?.(anchor);
    };
  }, [close]);

  if (!model || !api) return <>{children}</>;

  const show = () => ref.current && !api.openAnchor && api.open(ref.current, model);
  const isOpen = api.openAnchor !== null && api.openAnchor === ref.current;

  return (
    <span
      ref={ref}
      class="tooltip-trigger"
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={isOpen ? TOOLTIP_ID : undefined}
      onClick={(event) => {
        // Only the innermost trigger opens a new card; an already pinned card keeps ownership.
        const owner = (event.target as Element).closest('.tooltip-trigger');
        if (owner !== ref.current) return;
        if (isOpen) {
          api.close();
        } else if (!api.openAnchor) {
          show();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (isOpen) {
            api.close();
          } else if (!api.openAnchor) {
            show();
          }
        } else if (event.key === 'Escape') {
          api.close();
        }
      }}
    >
      {children}
    </span>
  );
}

/** Outside the overlay's stacking context: the site's passive tree is laid over the overlay and would cover it. */
function TooltipOutsideOverlay({ anchor, model, onClose }: { anchor: HTMLElement; model: TooltipModel; onClose: () => void }) {
  const layer = anchor.closest('.overlay')?.parentElement;
  const tooltip = <TooltipLayer anchor={anchor} model={model} onClose={onClose} />;
  return layer ? <Portal parent={layer}>{tooltip}</Portal> : tooltip;
}

function TooltipLayer({ anchor, model, onClose }: { anchor: HTMLElement; model: TooltipModel; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const origin = anchor.getBoundingClientRect();
    const position = () => setPlacement(
      placeTooltip({
        anchor: origin,
        size: { width: element.offsetWidth, height: element.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
    position();
    window.addEventListener('resize', position);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(element);
    return () => { window.removeEventListener('resize', position); observer?.disconnect(); };
  }, [anchor, model]);

  return (
    <div
      ref={ref}
      id={TOOLTIP_ID}
      role="dialog"
      aria-label={model.title}
      aria-modal="false"
      class={`tooltip tooltip--${model.accent}`}
      style={placement ? { left: `${placement.left}px`, top: `${placement.top}px` } : { visibility: 'hidden' }}
    >
      <div class="tooltip__controls">
        <button type="button" class="tooltip__close" aria-label="Close details" title="Close details (Esc)" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div class="tooltip__body"><TooltipCard model={model} /></div>
    </div>
  );
}

/** Renders into its own root at the end of `parent`. */
function Portal({ parent, children }: { parent: Element; children: ComponentChildren }) {
  const translations = useContext(TranslationContext);
  const [host] = useState(() => parent.ownerDocument.createElement('div'));
  useLayoutEffect(() => {
    parent.append(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, [parent, host]);
  useLayoutEffect(() => {
    render(<TranslationContext.Provider value={translations}>{children}</TranslationContext.Provider>, host);
  });
  return null;
}

function TooltipCard({ model }: { model: TooltipModel }) {
  return (
    <>
      <div class="tooltip__header">
        <Icon src={model.iconUrl} class="tooltip__icon" missing="none" />
        <div>
          <p class="tooltip__title"><BilingualText text={model.title} /></p>
          {model.subtitle && <p class="tooltip__subtitle"><BilingualText text={model.subtitle} /></p>}
        </div>
      </div>
      {model.tags.length > 0 && (
        <ul class="tooltip__tags">
          {model.tags.map((tag) => (
            <li key={tag}><BilingualText text={tag} /></li>
          ))}
        </ul>
      )}
      {model.stats.length > 0 && (
        <dl class="tooltip__stats">
          {model.stats.map(({ name, value }) => (
            <div key={name}>
              <dt><BilingualText text={name} /></dt>
              <dd><BilingualText text={value} /></dd>
            </div>
          ))}
        </dl>
      )}
      {model.requirements && <p class="tooltip__requirements">Requires: {model.requirements}</p>}
      {model.description && <p class="tooltip__description"><BilingualText text={model.description} /></p>}
      {model.sections.map((section, i) => (
        <div key={i} class={`tooltip__section tooltip__section--${section.tone}`}>
          {section.title && <p class="tooltip__section-title">{section.title}</p>}
          <ul>
            {(section.blocks ?? section.lines).map((line, j) => (
              <li key={j}><BilingualText text={line} /></li>
            ))}
          </ul>
        </div>
      ))}
      {model.flavour && <p class="tooltip__flavour"><BilingualText text={model.flavour} /></p>}
      {model.corrupted && <p class="tooltip__corrupted">Corrupted</p>}
      {model.note && <p class="tooltip__note">{model.note}</p>}
    </>
  );
}
