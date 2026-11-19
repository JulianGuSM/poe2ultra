// Adapter around Julian's existing translator. The copied API and terminology modules
// retain their original behavior; page translation sends complete text blocks and keeps a batch-to-block mapping.
import { DEFAULTS } from './vendor/defaults.js';
import { translate as chat } from './vendor/deepseek.js';
import { translate as responses } from './vendor/responses.js';
import { loadGlossary } from './vendor/glossary.js';
import { collectContext } from './context.js';
import { parseBatch } from './protocol';
import { buildGuidePrompt } from './guide-prompt.js';

const skippableOutputError = error => Object.assign(error, { recoverableBatch: true });
const errorMessage = error => error instanceof Error ? error.message : String(error);

function buildFormatRepairPrompt(prompt, invalidOutput, validationError) {
  const source = JSON.parse(prompt.userText);
  return {
    systemText: `${prompt.systemText}\n\n输出修复任务：上一轮译文未通过格式校验。请依据用户消息中的原始 segments 与 output_format，修正并重新输出完整结果。保留原译文内容中正确的翻译，只修复 JSON 结构、字段类型、段落数量或 id 对应关系。只输出符合 schema 的 JSON 对象，不要解释、不要 Markdown。`,
    userText: JSON.stringify({
      original_request: source,
      validation_error: validationError,
      invalid_output: invalidOutput,
      repair_instruction: '请返回一个完整、可解析且符合 original_request.output_format.schema 的 JSON 对象。',
    }),
  };
}

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
  const exact = new Map([...(glossary?.index.en.values() ?? [])].filter(e => e.c && e.t).map(e => [e.e.trim().toLowerCase(), e]));
  const name = text => exact.get(text.trim().toLowerCase());
  const local = text => { const term = name(text); return term ? { cn: text.replace(text.trim(), term.c), tw: text.replace(text.trim(), term.t) } : null; };
  const result = new Array(batch.length);
  const missing = [], positions = [];
  batch.forEach((segment, i) => {
    const translated = segment.widgetEntities?.length ? null : local(segment.texts.join(''));
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
  const promptSegments = missing.map((s, id) => ({ id, text: s.texts.join(''),
    ...(s.widgetEntities?.length ? { entities: s.widgetEntities.map(({ index, label, group }) => ({ index, label, group })) } : {}) }));
  const input = { text: JSON.stringify({ segments: promptSegments }),
    title: 'Path of Exile 2 build guide', url: '', pageLang: 'en', ...context };
  const prompt = buildGuidePrompt(promptSegments, context);
  const requestModel = async (requestPrompt, attempt) => {
    let receivedChars = 0, lastUpdate = 0, lastStage = '';
    const streamActivity = stage => {
      const now = Date.now();
      if (stage !== lastStage || now - lastUpdate >= 200) {
        lastStage = stage; lastUpdate = now;
        report({ stage, receivedChars });
      }
    };
    report({ stage: 'requesting' });
    await debug?.data(attempt === 1 ? 'modelInput' : 'repairInput', { input, prompt: requestPrompt, warnings });
    const response = await (settings.apiMode === 'chat' ? chat : responses)({ settings, input, signal, debug, prompt: requestPrompt,
      onChunk: chunk => { debug?.chunk('text', chunk); receivedChars += chunk.length; streamActivity('receiving'); },
      onReasoning: chunk => { debug?.chunk('reasoning', chunk); streamActivity('reasoning'); },
    });
    await debug?.data(attempt === 1 ? 'response' : 'repairResponse', response);
    // Each model call is billed independently, including a formatting repair.
    report({ stage: 'validating', receivedChars: response.text.length, modelRequest: true, usage: response.usage ?? null });
    if (response.finishReason !== 'stop') {
      const detail = response.finishReason === 'length'
        ? '已达到输出 token 上限，请在翻译设置中调高“最大输出 token”或关闭思考模式。'
        : `结束原因：${response.finishReason || '未收到完成标记'}。请检查接口是否返回了完整响应。`;
      throw new Error(`模型未完整返回两套译文。${detail}`);
    }
    return response;
  };

  let response = await requestModel(prompt, 1);
  let parsed;
  try {
    parsed = parseBatch(response.text, missing);
  } catch (initialError) {
    const validationError = errorMessage(initialError);
    await debug?.data('formatValidationError', { attempt: 1, message: validationError });
    let repairResponse;
    try {
      const repairPrompt = buildFormatRepairPrompt(prompt, response.text, validationError);
      repairResponse = await requestModel(repairPrompt, 2);
    } catch (repairRequestError) {
      if (signal.aborted) throw repairRequestError;
      const error = new Error(`模型输出未通过格式校验，已自动请求修复，但修复请求失败。本批未缓存。格式问题：${validationError} 修复请求：${errorMessage(repairRequestError)} 之前已保存的译文仍保留。`);
      Object.assign(error, { cause: repairRequestError, details: { code: 'format_repair_request_failed', validationError } });
      throw skippableOutputError(error);
    }
    try {
      parsed = parseBatch(repairResponse.text, missing);
      response = repairResponse;
      await debug?.data('formatRepair', { status: 'repaired' });
    } catch (repairValidationError) {
      const repairMessage = errorMessage(repairValidationError);
      await debug?.data('formatRepair', { status: 'failed', firstError: validationError, repairError: repairMessage });
      const error = new Error(`模型输出格式校验失败；自动修复后仍不符合要求。本批未缓存。首次校验：${validationError} 修复后：${repairMessage} 之前已保存的译文仍保留。`);
      Object.assign(error, { cause: repairValidationError, details: { code: 'format_repair_failed', validationError, repairError: repairMessage } });
      throw skippableOutputError(error);
    }
  }
  parsed.forEach((translation, i) => {
    result[positions[i]] = translation;
  });
  await debug?.data('result', { translations: result, warnings, usage: response.usage, modelRequest: true });
  return { translations: result, warnings, usage: response.usage };
}
