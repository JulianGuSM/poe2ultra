/**
 * Chat Completions 客户端（OpenAI 兼容协议，端点 /chat/completions）。
 * 只被 background 使用：请求里带 API Key，绝不能放到页面上下文里发。
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

/**
 * 思考模式参数（Chat Completions 形态）。
 * 官方文档：`thinking.type` 默认 enabled、`reasoning_effort` 默认 high，
 * 因此「跟随默认」= 什么都不发，行为和服务端默认完全一致。
 */
export function buildThinkingParams(settings = {}) {
  const mode = thinkingModeOf(settings);
  if (mode === 'disabled') return { thinking: { type: 'disabled' } };
  if (mode === 'enabled') {
    return { thinking: { type: 'enabled' }, reasoning_effort: effortOf(settings) };
  }
  return {};
}

/**
 * 组装 messages（全文使用显式传入的提示词；划词使用 selection/prompt.js）。
 * @param {{systemText: string, userText: string} | null} [prompt]
 */
export function buildMessages(settings, input, prompt = null) {
  const { systemText, userText } = prompt ?? composePrompt(settings, input);
  const messages = [];
  if (systemText) messages.push({ role: 'system', content: systemText });
  messages.push({ role: 'user', content: userText });
  return messages;
}

/**
 * 组装完整请求体；设置页的「预览最终请求」也调用它，保证预览与真实请求一致。
 * @param {{systemText: string, userText: string} | null} [prompt]
 */
export function buildBody(settings, input, prompt = null) {
  const stream = settings.stream !== false;
  const body = {
    model: String(settings.model || '').trim() || 'deepseek-chat',
    messages: buildMessages(settings, input, prompt),
    temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 1.3,
    max_tokens: Math.max(1, Number(settings.maxTokens) || 8192),
    stream,
    ...buildThinkingParams(settings),
    ...parseJsonObject(settings.customBody, '自定义请求体'),
  };
  if (stream) body.stream_options = { include_usage: true };
  return body;
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
      endpoint: buildEndpoint(settings.baseUrl, 'chat'),
      apiKey,
      body,
      extraHeaders: parseJsonObject(settings.extraHeaders, '自定义请求头'),
      timeoutMs: settings.timeoutMs,
      signal,
      debug,
    },
    async (res) => {
      await assertOk(res);

      if (!body.stream) {
        const json = await res.json();
        const choice = json?.choices?.[0] || {};
        const message = choice.message || {};
        return {
          text: String(message.content || '').trim(),
          reasoning: String(message.reasoning_content || '').trim(),
          usage: json?.usage || null,
          model: json?.model || model,
          finishReason: choice.finish_reason || '',
          citations: [],
        };
      }

      let text = '';
      let reasoning = '';
      let usage = null;
      let usedModel = model;
      let finishReason = '';

      await consumeSse(res, (json) => {
        if (json.model) usedModel = json.model;
        if (json.usage) usage = json.usage;

        // usage 与 finish_reason 都挂在最后一个内容块上，必须先于 delta 判空处理
        const choice = json?.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const delta = choice?.delta;
        if (!delta) return;
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          onReasoning(delta.reasoning_content);
        }
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          onChunk(delta.content);
        }
      });

      return {
        text: text.trim(),
        reasoning: reasoning.trim(),
        usage,
        model: usedModel,
        finishReason,
        citations: [],
      };
    }
  );
}
