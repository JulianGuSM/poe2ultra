import { expect, it } from 'vitest';
import { buildGuidePrompt, GUIDE_SYSTEM_PROMPT } from './guide-prompt.js';
import { composePrompt, DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT } from '../selection/prompt.js';
import { buildBody as chat } from './vendor/deepseek.js';
import { buildBody as responses } from './vendor/responses.js';
import { defaultSettings } from './settings';

it.each([chat, responses])('sends the exact guide system text without selection or glossary rule injection (%#)', client => {
  const settings = { ...defaultSettings, systemPrompt: 'SELECTION ONLY SYSTEM', userPrompt: 'SELECTION ONLY USER {{text}}', glossaryStrict: true, dualOutput: true };
  const input = { text: 'Original 0.5', terms: [{ en: 'Lich', zh_cn: '巫妖', zh_tw: '妖巫' }], direct: [], sources: [] };
  const prompt = buildGuidePrompt([{ id: 0, text: input.text }], input);
  const body = client(settings, input, prompt);
  expect(body.instructions ?? body.messages[0].content).toBe(GUIDE_SYSTEM_PROMPT);
  const user = body.input ?? body.messages.at(-1).content;
  expect(JSON.parse(user).segments).toEqual([{ id: 0, text: 'Original 0.5' }]);
  expect(user).toContain('巫妖');
  expect(user).toContain('妖巫');
  expect(JSON.stringify(body)).not.toContain('SELECTION ONLY');
  expect(GUIDE_SYSTEM_PROMPT).not.toMatch(/JSON|格式|标签|规则：|Translate each/);
});

it('keeps default selection behavior in its own composer, including optional dual-language output', () => {
  const settings = { ...defaultSettings, systemPrompt: DEFAULT_SYSTEM_PROMPT, userPrompt: DEFAULT_USER_PROMPT };
  const dual = composePrompt(settings, { text: 'Use a skill.' });
  expect(dual.systemText).toContain('【简中】');
  expect(dual.systemText).toContain('【繁中】');
  expect(dual.systemText).not.toContain('Build 攻略翻译专家');
  const single = composePrompt({ ...settings, dualOutput: false, targetLang: '日本語', systemPrompt: 'custom selection' }, { text: 'Use a skill.' });
  expect(single.systemText).toBe('custom selection');
  expect(single.userText).toContain('日本語');
  expect(single.userText).toContain('Use a skill.');
});
