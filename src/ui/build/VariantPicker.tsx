import { BilingualText } from '@/ui/translation/BilingualText';
import type { ComponentChildren } from 'preact';
import type { Variant } from '@/lib/build/model';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Build variant chips (Act 1 … Endgame); hidden for single-variant builds. */
export function VariantPicker({
  variants,
  selectedId,
  onChange,
  ariaLabel = 'Build variant',
  showSingle = false,
  buttonClass = 'chip',
  selectedAttribute = 'pressed',
  renderVariant,
}: {
  variants: Variant[];
  selectedId: string | null;
  onChange: (id: string) => void;
  ariaLabel?: string;
  showSingle?: boolean;
  buttonClass?: string;
  selectedAttribute?: 'pressed' | 'step';
  renderVariant?: (variant: Variant) => ComponentChildren;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, top: 0, width: 0, height: 0, ready: false });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const button = buttonRefs.current.get(selectedId ?? '');
    if (!container || !button) return;

    const measure = () => {
      const next = { left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight, ready: true };
      setIndicator((current) => current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height && current.ready
        ? current
        : next);
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(container);
    for (const item of buttonRefs.current.values()) observer?.observe(item);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [selectedId, variants]);

  if (variants.length < 2 && !showSingle) return null;
  return (
    <div ref={containerRef} class="variants" role="group" aria-label={ariaLabel}>
      <span
        class="variants__indicator"
        aria-hidden="true"
        style={{
          width: `${indicator.width}px`,
          height: `${indicator.height}px`,
          transform: `translate(${indicator.left}px, ${indicator.top}px)`,
          opacity: indicator.ready ? 1 : 0,
        }}
      />
      {variants.map((variant) => (
        <button
          key={variant.id}
          ref={(node) => {
            if (node) buttonRefs.current.set(variant.id, node);
            else buttonRefs.current.delete(variant.id);
          }}
          type="button"
          class={buttonClass}
          title={variant.title}
          aria-pressed={selectedAttribute === 'pressed' ? variant.id === selectedId : undefined}
          aria-current={selectedAttribute === 'step' && variant.id === selectedId ? 'step' : undefined}
          onClick={() => onChange(variant.id)}
        >
          {renderVariant ? renderVariant(variant) : <BilingualText text={variant.title} inline />}
        </button>
      ))}
    </div>
  );
}
