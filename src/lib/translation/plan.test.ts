import { describe, expect, it } from 'vitest';
import type { Build } from '../build/model';
import { applyTranslations, planTranslation, segmentKey } from './plan';

const paragraph = { type: 'paragraph', children: [
  { type: 'text', text: 'Use ', format: 1 },
  { type: 'link', url: 'https://example.com/item', children: [{ type: 'static-data-widget', id: 'gem-id', label: 'Abyssal Lich', groupId: 'activeSkillGems' }] },
  { type: 'text', text: ' for damage.' },
  { type: 'text', text: '/command', format: 16 },
] };
export function exampleBuild() {
  return { id: 'build-id', title: 'Guide', author: 'Author stays English', videoUrl: 'https://example.com/video',
    sections: [{ id: 'overview', title: 'Overview', content: { root: { type: 'root', children: [paragraph] } } }],
    variants: [
      { id: 'act-1', title: 'Act 1', skillNotes: { root: { children: [paragraph] } } },
      { id: 'endgame', title: 'Endgame', equipmentNotes: { root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hidden variant notes' }] }] } } },
    ], entities: { 'gem-id': { kind: 'gem', gem: { slug: 'gem-id', name: 'Abyssal Lich', iconUrl: 'https://example.com/a.png' } } },
  } as unknown as Build;
}

describe('structured guide translation', () => {
  it('collects all variants and entity tooltips, deduplicates paragraphs, and excludes metadata', () => {
    const plan = planTranslation(exampleBuild());
    const source = JSON.stringify(plan.segments);
    expect(source).toContain('Hidden variant notes');
    expect(source).not.toContain('Author stays English');
    expect(source).not.toContain('https://');
    expect(source).not.toContain('gem-id');
    expect(plan.segments.filter(s => s.texts.includes('Use '))).toHaveLength(1);
    expect(plan.segments.find(s => s.texts.includes('Use '))?.protected).toEqual([3]);
  });
  it('restores both independent translations without modifying links, IDs, styles or the original', () => {
    const build = exampleBuild();
    const plan = planTranslation(build);
    const segment = plan.segments.find(s => s.texts.includes('Use '))!;
    const records = { [segmentKey(segment)]: { cn: ['使用', '深渊巫妖', '造成伤害。', '/command'], tw: ['使用', '深淵妖巫', '造成傷害。', '/command'] } };
    const translated = applyTranslations(build, plan, records, 'tw');
    const content = JSON.stringify(translated.sections[0]?.content);
    expect(content).toContain('深淵妖巫');
    expect(content).toContain('https://example.com/item');
    expect(content).toContain('"format":1');
    expect(content).toContain('gem-id');
    expect(JSON.stringify(build)).toContain('Abyssal Lich');
    expect(applyTranslations(build, plan, records, 'en')).toBe(build);
  });
  it('invalidates only changed source segments', () => {
    const build = exampleBuild();
    const before = planTranslation(build).segments.map(segmentKey);
    build.title = 'Changed guide';
    const after = planTranslation(build).segments.map(segmentKey);
    expect(after.filter(key => !before.includes(key))).toHaveLength(1);
  });
});
