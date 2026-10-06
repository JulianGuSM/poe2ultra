import { describe, expect, it } from 'vitest';
import { parseBatch } from './protocol';
import type { Segment } from './plan';

describe('JSON output parsing', () => {
  it.each([null, {}, 7, ['译文', 7], []])('reports missing or nontext translations (%#)', cn => {
    const split: Segment = { kind: 'prose', texts: ['Use ', 'a skill.'], protected: [] };
    let failure: any;
    try { parseBatch(JSON.stringify({ translations: [{ id: 0, cn, tw: '使用技能' }] }), [split]); }
    catch (error) { failure = error; }
    expect(failure.message).toContain('本批第 1 个文字块，简中');
    expect(failure.details).toMatchObject({ code: 'block_translation', locale: 'cn', segmentId: 0, sourceText: 'Use a skill.' });
  });
  const source: Segment = { kind: 'prose', texts: ['Use the skill.'], protected: [] };
  const valid = JSON.stringify({ translations: [{ id: 0, cn: ['使用技能。'], tw: ['使用技能。'] }] });
  it.each([valid, '\uFEFF' + valid, '```json\n' + valid + '\n```', '译文如下：\n```json\n' + valid + '\n```\n翻译完毕。'])('accepts a complete object without discarding any translated fields (%#)', raw => {
    expect(parseBatch(raw, [source])[0]?.cn).toEqual(['使用技能。']);
  });
  it('handles escaped quotes, backslashes, newlines and braces inside translated strings', () => {
    const cn = '技能说："开始"；符号 { [ ] } \\ 路径\n下一行';
    const raw = JSON.stringify({ translations: [{ id: 0, cn: [cn], tw: [cn] }] });
    expect(parseBatch('译文：' + raw + '\n完成', [source])[0]?.cn).toEqual([cn]);
  });
  it.each([
    ['', '空内容'],
    ['【简中】使用技能。【繁中】使用技能。', '不是 JSON 对象'],
    [valid.slice(0, -3), '没有完整闭合'],
    [valid.replace('使用技能。', '使用"技能"。'), 'JSON 语法错误'],
    [valid + valid, '多份结果'],
    ['[' + valid + ', broken]', 'JSON 语法错误'],
    [valid.replace('使用技能。', '使用\n技能。'), 'JSON 语法错误'],
  ])('rejects malformed content with actionable diagnostics (%#)', (raw, reason) => {
    expect(() => parseBatch(raw, [source])).toThrow(reason);
    expect(() => parseBatch(raw, [source])).toThrow('之前已保存的译文仍保留');
  });
  it('still checks both languages and block IDs after extracting a wrapped object', () => {
    const numbered: Segment = { kind: 'prose', texts: ['Gain 25% damage.'], protected: [] };
    expect(parseBatch('结果：' + valid, [numbered])[0]?.cn).toEqual(['使用技能。']);
    expect(() => parseBatch('结果：' + valid.replace('"id":0', '"id":1'), [source])).toThrow('编号无效');
    expect(() => parseBatch('结果：' + valid.replace('"tw":["使用技能。"]', '"tw":[]'), [source])).toThrow('未返回有效译文');
  });
});
