import { CircleDot, Diamond, FlaskConical, Gem, ImageOff, Package, Shield, Shirt, Sparkles, Swords } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** What the picture would have shown, so its stand-in can suit the slot. */
export type IconKind = 'item' | 'armour' | 'weapon' | 'offhand' | 'jewellery' | 'flask' | 'charm' | 'gem' | 'passive' | 'rune';

const STAND_IN = {
  item: Package,
  armour: Shirt,
  weapon: Swords,
  offhand: Shield,
  jewellery: CircleDot,
  flask: FlaskConical,
  charm: Sparkles,
  gem: Gem,
  passive: Sparkles,
  rune: Diamond,
};

/** Detects a cached failure without asking decode() to reject while a lazy request is still pending. */
const cachedFailure = (image: HTMLImageElement) => image.complete && image.naturalWidth === 0
  ? Promise.reject(new Error('Image request already failed'))
  : Promise.resolve();

export interface IconProps {
  src: string | null | undefined;
  class: string;
  alt?: string;
  kind?: IconKind;
  /** What to leave behind when there is no picture: a stand-in in its place, or nothing at all. */
  missing?: 'box' | 'none';
  /** Load above-the-fold images immediately; other images stay lazy by default. */
  loading?: 'eager' | 'lazy';
  /** How the picture is known to have arrived; injected in tests. */
  check?: (image: HTMLImageElement) => Promise<unknown>;
}

/**
 * A picture from the site's CDN. The CDN drops files now and then, and plenty of entities have no icon at all, so a
 * picture that does not arrive leaves a stand-in of the same size — an item, gem, passive or rune shape — rather
 * than the browser's broken-image mark.
 */
export function Icon({ src, class: className, alt = '', kind, missing = 'box', loading = 'lazy', check = cachedFailure }: IconProps) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement | null>(null);

  useEffect(() => setFailed(false), [src]);

  // A cached refusal may have completed before onError was attached. Do not use decode() as a probe: it can reject
  // before a lazy request starts in some browsers, which would hide an image that could still load successfully.
  useEffect(() => {
    const element = image.current;
    if (!element || failed) return;
    let watching = true;
    check(element).catch(() => watching && setFailed(true));
    return () => {
      watching = false;
    };
  }, [src, failed, check]);

  if (!src || failed) {
    if (missing === 'none') return null;
    const Shape = kind ? STAND_IN[kind] : ImageOff;
    return (
      <span class={`${className} icon--missing${kind ? ` icon--${kind}` : ''}`} aria-hidden="true">
        <Shape />
      </span>
    );
  }

  return <img ref={image} class={className} src={src} alt={alt} loading={loading} onError={() => setFailed(true)} />;
}
