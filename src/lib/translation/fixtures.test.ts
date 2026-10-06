import { describe, expect, it } from 'vitest';
import { FIXTURE_SLUGS, loadFixture } from '../../../tests/fixtures/load';
import { parseBuild } from '../build/parse-build';
import { planTranslation, applyTranslations, segmentKey } from './plan';
import { validateSegments } from './protocol';
import { formatRoute } from '../ui/route';

describe('translation coverage of upstream guide fixtures', () => {
  for (const file of FIXTURE_SLUGS) {
    it(`covers ${file} while retaining navigation and game identifiers`, () => {
      const fixture = loadFixture(file);
      const build = parseBuild(fixture.build, fixture.staticData);
      const plan = planTranslation(build);
      expect(() => validateSegments(plan.segments)).not.toThrow();
      const records = Object.fromEntries(plan.segments.map(s => [segmentKey(s), { cn: s.texts.map(t => '简' + t), tw: s.texts.map(t => '繁' + t) }]));
      const translated = applyTranslations(build, plan, records, 'cn');
      expect(translated.author).toBe(build.author);
      expect(translated.variants.map(v => v.id)).toEqual(build.variants.map(v => v.id));
      expect(Object.keys(translated.entities)).toEqual(Object.keys(build.entities));
      for (const [i, variant] of translated.variants.entries()) {
        expect(variant.skills.map(s => s.gem.slug)).toEqual(build.variants[i]!.skills.map(s => s.gem.slug));
        expect(variant.equipment.map(s => s.item.tradeUrl)).toEqual(build.variants[i]!.equipment.map(s => s.item.tradeUrl));
        expect(formatRoute({ tab: 'skills', variantId: variant.id }, build)).toContain('skills');
      }
    });
  }
});
