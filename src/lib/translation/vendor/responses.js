/**
 * Responses 客户端（OpenAI Responses API 格式，端点 /responses）。
 *
 * 与 Chat Completions 的三个关键差异：
 *  1. 系统提示词走顶层 `instructions`，用户内容走 `input`
 *  2. 思考模式是 `{"reasoning": {"effort": "none|low|high|max"}}`
 *  3. 流式事件是语义化的：response.output_text.delta / response.reasoning_text.delta /
 *     response.completed…，没有 data: [DONE]
 *
 * 不在请求体里声明服务端搜索工具（web_search 等）：DeepSeek 官方兼容性表把内置工具
 * 标为「忽略」，声明了也不生效。术语补充改由本地术语表 + Tavily(poe2db.tw) 完成，
 * 见 glossary.js / tavily.js，以及 selection/prompt.js 中的划词提示词。
 */
import { composePrompt } from '../../selection/prompt.js';
import {
  TranslateError,
  assertOk,
  buildEndpoint,
  consumeSse,
  effortOf,
  parseJsonObject,
  thinkingModeOf,
  withRequest,
} from './api-base.js';

/** 组装思考模式参数：none 关闭思考，其余为强度。 */
export function buildReasoningParams(settings = {}) {
  const mode = thinkingModeOf(settings);
  if (mode === 'disabled') return { reasoning: { effort: 'none' } };
  if (mode === 'enabled') return { reasoning: { effort: effortOf(settings) } };
  return {}; // 跟随服务端默认（官方当前=开启、强度 high）
}

/**
 * 组装完整请求体；设置页的「预览最终请求」也调用它。
 * @param {{systemText: string, userText: string} | null} [prompt]
 */
export function buildBody(settings, input, prompt = null) {
  const stream = settings.stream !== false;
  const { systemText, userText } = prompt ?? composePrompt(settings, input);

  const body = {
    model: String(settings.model || '').trim() || 'deepseek-flash',
    input: userText,
    temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 1.3,
    max_output_tokens: Math.max(1, Number(settings.maxTokens) || 8192),
    stream,
    ...(systemText ? { instructions: systemText } : {}),
    ...buildReasoningParams(settings),
    ...parseJsonObject(settings.customBody, '自定义请求体'),
  };
  return body;
}

/** 把 Responses 的 usage 归一化成 Chat Completions 的字段名，费用估算与面板无需区分形态。 */
export function normalizeUsage(usage) {
  if (!usage) return null;
  if (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) return usage;

  const input = toInt(usage.input_tokens);
  const output = toInt(usage.output_tokens);
  const cached = toInt(usage.input_tokens_details?.cached_tokens);
  const reasoning = toInt(usage.output_tokens_details?.reasoning_tokens);

  return {
    prompt_tokens: input,
    completion_tokens: output,
    prompt_cache_hit_tokens: cached,
    prompt_cache_miss_tokens: Math.max(0, input - cached),
    total_tokens: toInt(usage.total_tokens) || input + output,
    completion_tokens_details: { reasoning_tokens: reasoning },
    prompt_tokens_details: { cached_tokens: cached },
    raw: usage,
  };
}

const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function normalizeCitation(annotation) {
  if (!annotation || typeof annotation !== 'object') return null;
  if (annotation.type && !/citation/i.test(String(annotation.type))) return null;
  const url = annotation.url || annotation.uri || '';
  if (!url) return null;
  return {
    url: String(url),
    title: String(annotation.title || annotation.name || url),
  };
}

/**
 * 从完整的 response 对象里取出译文、思维链、引用来源。
 * 非流式响应、以及流式最后的 response.completed 都用它。
 */
export function extractResponse(json) {
  let text = '';
  let reasoning = '';
  const citations = [];

  for (const item of json?.output || []) {
    if (!item || typeof item !== 'object') continue;

    if (item.type === 'reasoning') {
      for (const part of item.content || []) {
        if (part?.type === 'reasoning_text') reasoning += part.text || '';
      }
      continue;
    }

    if (item.type === 'message') {
      for (const part of item.content || []) {
        if (part?.type !== 'output_text') continue;
        text += part.text || '';
        for (const annotation of part.annotations || []) {
          const cite = normalizeCitation(annotation);
          if (cite) citations.push(cite);
        }
      }
    }
  }

  return {
    text: text.trim(),
    reasoning: reasoning.trim(),
    citations: dedupeCitations(citations),
  };
}

function dedupeCitations(list) {
  const seen = new Set();
  const out = [];
  for (const cite of list) {
    if (seen.has(cite.url)) continue;
    seen.add(cite.url);
    out.push(cite);
  }
  return out;
}

/** status / incomplete_details → 面板认识的 finishReason。 */
export function finishReasonOf(json) {
  if (json?.status === 'incomplete') {
    return json?.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'incomplete';
  }
  if (json?.status === 'completed') return 'stop';
  return '';
}

/**
 * 发起翻译请求。
 * @returns {Promise<{text:string, reasoning:string, usage:object|null, model:string, finishReason:string, citations:Array}>}
 */
export async function translate({ settings, input, onChunk = () => {}, onReasoning = () => {}, signal, debug, prompt = null }) {
  const apiKey = String(settings.apiKey || '').trim();
  if (!apiKey) {
    throw new TranslateError('尚未填写 API Key，请点击扩展图标 → 打开设置。', {
      hint: '在 https://platform.deepseek.com/api_keys 创建 Key。',
    });
  }

  const body = buildBody(settings, input, prompt);
  const model = body.model;

  return withRequest(
    {
      endpoint: buildEndpoint(settings.baseUrl, 'responses'),
      apiKey,
      body,
      extraHeaders: parseJsonObject(settings.extraHeaders, '自定义请求头'),
      timeoutMs: settings.timeoutMs,
      signal,
      debug,
    },
    async (res) => {
      try {
        await assertOk(res);
      } catch (err) {
        // Responses 文档只列出 deepseek-flash / deepseek-v4-pro，旧名可能直接被拒
        if (err?.status === 400 && /^deepseek-(chat|reasoner)$/i.test(model)) {
          err.hint =
            'Responses API 文档只列出 deepseek-flash / deepseek-v4-pro，当前模型名是旧名；' +
            '请到设置页把模型改成 deepseek-flash，或把 API 形态切回 Chat Completions。';
        }
        throw err;
      }

      if (!body.stream) {
        const json = await res.json();
        if (json?.status === 'failed') {
          throw new TranslateError(
            `响应失败：${json?.error?.message || json?.error?.code || '未知原因'}`
          );
        }
        const extracted = extractResponse(json);
        return {
          ...extracted,
          usage: normalizeUsage(json?.usage),
          model: json?.model || model,
          finishReason: finishReasonOf(json),
        };
      }

      let text = '';
      let reasoning = '';
      let usage = null;
      let usedModel = model;
      let finishReason = '';
      const citations = [];
      let finalResponse = null;

      await consumeSse(res, (event) => {
        const type = event?.type || '';

        if (type === 'response.output_text.delta') {
          const delta = event.delta || '';
          if (delta) {
            text += delta;
            onChunk(delta);
          }
          return;
        }
        if (type === 'response.reasoning_text.delta') {
          const delta = event.delta || '';
          if (delta) {
            reasoning += delta;
            onReasoning(delta);
          }
          return;
        }
        if (type === 'response.output_item.added' || type === 'response.output_item.done') {
          return;
        }
        if (/annotation\.added$/.test(type)) {
          const cite = normalizeCitation(event.annotation);
          if (cite) citations.push(cite);
          return;
        }
        if (type === 'response.failed') {
          throw new TranslateError(
            `响应失败：${event.response?.error?.message || event.response?.error?.code || '未知原因'}`
          );
        }
        if (type === 'response.completed' || type === 'response.incomplete') {
          finalResponse = event.response || null;
        }
      });

      if (finalResponse) {
        usedModel = finalResponse.model || usedModel;
        usage = normalizeUsage(finalResponse.usage);
        finishReason = finishReasonOf(finalResponse);
        const extracted = extractResponse(finalResponse);
        // 完整响应里的文本更权威，优先采用
        if (extracted.text) text = extracted.text;
        if (extracted.reasoning) reasoning = extracted.reasoning;
        citations.push(...extracted.citations);
      }

      return {
        text: text.trim(),
        reasoning: reasoning.trim(),
        usage,
        model: usedModel,
        finishReason,
        citations: dedupeCitations(citations),
      };
    }
  );
}
