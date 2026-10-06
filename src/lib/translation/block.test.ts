import { expect, it } from 'vitest';
import { parseBatch } from './protocol';
import { GUIDE_SYSTEM_PROMPT } from './guide-prompt.js';
it('accepts natural whole-block translations without numeric or formatting-span validation', () => {
  const batch = [{ kind: 'prose' as const, texts: ['Act ', '1', ': Buffed in 0.5.'], protected: [1] }];
  const raw = JSON.stringify({ translations: [{ id: 0, cn: '第一章：在 0.5 版本中加强。', tw: '第一章：在 0.5 版本中加強。' }] });
  expect(parseBatch(raw, batch)).toEqual([{ cn: ['第一章：在 0.5 版本中加强。'], tw: ['第一章：在 0.5 版本中加強。'] }]);
  expect(GUIDE_SYSTEM_PROMPT).not.toContain('⟦N');
  expect(GUIDE_SYSTEM_PROMPT).not.toContain('spanCount');
});
