// Adapter around Julian's existing translator. The copied API and terminology modules
// retain their original behavior; page translation sends complete text blocks and keeps a batch-to-block mapping.
import { DEFAULTS } from './vendor/defaults.js';
import { translate as chat } from './vendor/deepseek.js';
import { translate as responses } from './vendor/responses.js';
import { loadGlossary } from './vendor/glossary.js';
import { collectContext } from './context.js';
import { parseBatch } from './protocol';
import { buildGuidePrompt } from './guide-prompt.js';

export { defaultSettings } from './settings';

export async function translateBatch(batch, configured, signal, report = () => {}, suppliedGlossary, debug) {
  const extra = JSON.parse(configured.customBody || '{}');
  // Full-page output must obey the structural protocol; selection keeps the original overrides.
  for (const key of ['messages', 'input', 'instructions', 'text', 'response_format']) delete extra[key];
  // JSON mode is an API constraint, not just a prompt instruction. Keep it scoped to guides.
  // https://api-docs.deepseek.com/guides/json_mode/
  // https://api-docs.deepseek.com/api/create-response/
  if (configured.apiMode === 'chat') extra.response_format = { type: 'json_object' };
  else extra.text = { format: { type: 'json_object' } };
  const settings = { ...DEFAULTS, ...configured, dualOutput: false, customBody: JSON.stringify(extra),
    targetLang: '简中与繁中两套独立译文（JSON 对象）',
  };
  const warnings = [];
  report({ stage: 'glossary' });
  let glossary;
  if (settings.glossaryEnabled) {
    try { glossary = suppliedGlossary ?? await loadGlossary(); }
    catch { throw new Error('内置术语库读取失败，尚未发出翻译请求。请重新加载扩展后重试。'); }
  }
  const categories = settings.glossaryCategories.split(/[,\s]+/).filter(Boolean);
  const exact = new Map([...(glossary?.index.en.values() ?? [])].filter(e => e.c && e.t && (!categories.length || categories.includes(e.k))).map(e => [e.e.trim().toLowerCase(), e]));
  const name = text => exact.get(text.trim().toLowerCase());
  const local = text => { const term = name(text); return term ? { cn: text.replace(text.trim(), term.c), tw: text.replace(text.trim(), term.t) } : null; };
  const result = new Array(batch.length);
  const missing = [], positions = [];
  batch.forEach((segment, i) => {
    const translated = local(segment.texts.join(''));
    if (translated) result[i] = { cn: [translated.cn], tw: [translated.tw] };
    else { missing.push(segment); positions.push(i); }
  });
  await debug?.data('providerInput', { segments: missing, sourcePositions: positions, localTranslations: result });
  if (!missing.length) {
    await debug?.data('result', { translations: result, modelRequest: false, warnings });
    return { translations: result, warnings, usage: null };
  }
  if (!settings.apiKey.trim()) throw new Error('请在“翻译设置”中填写 DeepSeek API Key 并保存。');
  const text = missing.map(s => s.texts.join('')).join('\n');
  report({ stage: 'context' });
  const context = await collectContext(settings, { text }, signal, glossary);
  warnings.push(...context.warnings);
  signal.throwIfAborted();
  const input = { text: JSON.stringify({ segments: missing.map((s, id) => ({ id, text: s.texts.join('') })) }),
    title: 'Path of Exile 2 build guide', url: '', pageLang: 'en', ...context };
  const prompt = buildGuidePrompt(missing.map((s, id) => ({ id, text: s.texts.join('') })), context);
  report({ stage: 'requesting' });
  await debug?.data('modelInput', { input, prompt, warnings });
  let receivedChars = 0, lastUpdate = 0, lastStage = '';
  const streamActivity = stage => {
    const now = Date.now();
    if (stage !== lastStage || now - lastUpdate >= 200) {
      lastStage = stage; lastUpdate = now;
      report({ stage, receivedChars });
    }
  };
  const response = await (settings.apiMode === 'chat' ? chat : responses)({ settings, input, signal, debug, prompt,
    onChunk: chunk => { debug?.chunk('text', chunk); receivedChars += chunk.length; streamActivity('receiving'); },
    onReasoning: chunk => { debug?.chunk('reasoning', chunk); streamActivity('reasoning'); },
  });
  await debug?.data('response', response);
  report({ stage: 'validating', receivedChars: response.text.length });
  if (response.finishReason !== 'stop') {
    const detail = response.finishReason === 'length'
      ? '已达到输出 token 上限，请在翻译设置中调高“最大输出 token”或关闭思考模式。'
      : `结束原因：${response.finishReason || '未收到完成标记'}。请检查接口是否返回了完整响应。`;
    throw new Error(`模型未完整返回两套译文，本批未缓存。${detail}之前已保存的译文仍保留。`);
  }
  const parsed = parseBatch(response.text, missing);
  parsed.forEach((translation, i) => {
    result[positions[i]] = translation;
  });
  await debug?.data('result', { translations: result, warnings, usage: response.usage, modelRequest: true });
  return { translations: result, warnings, usage: response.usage };
}
