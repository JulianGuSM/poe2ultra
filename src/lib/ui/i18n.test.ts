import { describe, expect, it } from 'vitest';
import { uiRequirements, uiText } from './i18n';

describe('extension UI localization', () => {
  it('uses independent Simplified and Traditional labels while preserving English', () => {
    expect(uiText('Gear', 'cn')).toBe('装备');
    expect(uiText('Gear', 'tw')).toBe('裝備');
    expect(uiText('Atlas Tree', 'cn')).toBe('异界天赋树');
    expect(uiText('Atlas Tree', 'tw')).toBe('輿圖天賦樹');
    expect(uiText('Additional Effects From Quality', 'tw')).toBe('品質附加效果');
    expect(uiText('Additional Effects From Quality', 'en')).toBe('Additional Effects From Quality');
    expect(uiText('Unrecognized game data', 'cn')).toBe('Unrecognized game data');
  });

  it('localizes fixed requirement names without changing their values', () => {
    expect(uiRequirements('Level 40, Intelligence 58', 'cn')).toBe('需求：等级 40, 智慧 58');
    expect(uiRequirements('Level 40, Intelligence 58', 'tw')).toBe('需求：等級 40, 智慧 58');
    expect(uiRequirements('Level 40, Intelligence 58', 'en')).toBe('Requires: Level 40, Intelligence 58');
  });
});
