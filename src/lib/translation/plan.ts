import type { Build } from '../build/model';

export type Locale = 'en' | 'cn' | 'tw';
export interface Segment { kind: 'term' | 'prose'; texts: string[]; protected: number[] }
export interface Translation { cn: string[]; tw: string[] }
export interface CachedTranslation extends Translation { source?: string }
export type Records = Record<string, Translation>;
type Path = (string | number)[];
interface Slot { key: string; paths: Path[] }
export interface TranslationPlan { segments: Segment[]; slots: Slot[] }
export const segmentKey = (segment: Segment) => JSON.stringify(segment);

// Only human-readable fields of the normalized build. Never traverse the website DOM,
// author identity, URLs, slugs, enum values, item classes used as identifiers, or raw static data.
const TEXT_FIELDS = new Set(['title', 'name', 'className', 'ascendancy', 'parentName', 'itemClassName',
  'description', 'flavourText', 'act', 'area', 'reward', 'label', 'value']);
const TEXT_ARRAYS = new Set(['modifiers', 'implicits', 'effects', 'qualityEffects', 'tags', 'buildTypes']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const translatable = (text: string) => /[a-z]/i.test(text) && !/^\s*(https?:\/\/|www\.)\S+\s*$/i.test(text);

export function planTranslation(build: Build): TranslationPlan {
  const unique = new Map<string, Segment>();
  const slots: Slot[] = [];
  function add(texts: string[], paths: Path[], protectedIndices: number[] = [], kind: Segment['kind'] = 'prose') {
    if (!texts.some((text, i) => !protectedIndices.includes(i) && translatable(text))) return;
    const segment = { kind, texts, protected: protectedIndices };
    const key = segmentKey(segment);
    unique.set(key, segment);
    slots.push({ key, paths });
  }
  function rich(node: unknown, path: Path) {
    if (!object(node)) return;
    if (['paragraph', 'heading', 'listitem'].includes(String(node.type))) {
      const texts: string[] = [], paths: Path[] = [], protectedIndices: number[] = [];
      function inlines(child: unknown, at: Path) {
        if (!object(child)) return;
        if (child.type === 'list') { rich(child, at); return; }
        const field = child.type === 'static-data-widget' ? 'label' : child.type === 'text' ? 'text' : null;
        if (field && typeof child[field] === 'string') {
          if ((Number(child.format) & 16) !== 0 || !translatable(child[field])) protectedIndices.push(texts.length);
          texts.push(child[field]); paths.push([...at, field]);
        } else if (Array.isArray(child.children)) child.children.forEach((c, i) => inlines(c, [...at, 'children', i]));
      }
      if (Array.isArray(node.children)) node.children.forEach((c, i) => inlines(c, [...path, 'children', i]));
      add(texts, paths, protectedIndices);
    } else if (Array.isArray(node.children)) node.children.forEach((c, i) => rich(c, [...path, 'children', i]));
  }
  function walk(value: unknown, path: Path, field = '') {
    if (typeof value === 'string') {
      if (TEXT_FIELDS.has(field) || TEXT_ARRAYS.has(field)) add([value], [path], [], ['name', 'className', 'ascendancy', 'parentName'].includes(field) ? 'term' : 'prose');
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i], field));
    else if (object(value)) {
      if ('root' in value) rich(value.root, [...path, 'root']);
      else Object.entries(value).forEach(([key, child]) => walk(child, [...path, key], key));
    }
  }
  walk(build, []);
  return { segments: [...unique.values()], slots };
}

/** Translate a display copy; structural fields and the English source never change. */
export function applyTranslations(build: Build, plan: TranslationPlan, records: Records, locale: Locale): Build {
  if (locale === 'en' || !Object.keys(records).length) return build;
  const copy = structuredClone(build);
  for (const slot of plan.slots) {
    const strings = records[slot.key]?.[locale];
    if (!strings || strings.length !== slot.paths.length) continue;
    slot.paths.forEach((path, i) => {
      let parent: any = copy;
      for (const part of path.slice(0, -1)) parent = parent[part];
      parent[path.at(-1)!] = strings[i];
    });
  }
  return copy;
}
