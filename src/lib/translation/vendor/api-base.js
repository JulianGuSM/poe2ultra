/**
 * 两个 API 形态（Chat Completions / Responses）共用的底层：
 * 端点拼接、错误翻译成人话、超时与取消。
 */

export class TranslateError extends Error {
  constructor(message, { status = 0, hint = '' } = {}) {
    super(message);
    this.name = 'TranslateError';
    this.status = status;
    this.hint = hint;
  }
}

const STATUS_HINTS = {
  400: '请求格式有误，请检查模型名、参数与接口形态是否匹配。',
  401: 'API Key 无效或已失效，请到设置页重新填写。',
  402: '账户余额不足，请先到 DeepSeek 平台充值。',
  403: '没有访问该模型的权限，请更换模型。',
  404: '接口地址不存在，请检查 Base URL 与 API 形态（Responses 用 /responses）。',
  422: '请求参数不合法，请检查参数与提示词。',
  429: '请求过于频繁，已被限流，请稍后再试。',
  500: 'DeepSeek 服务端错误，请稍后重试。',
  503: 'DeepSeek 服务暂时过载，请稍后重试。',
};

/**
 * 把用户填的 Base URL 归一化成具体端点。
 * 已经写了另一个形态的端点时会被替换，避免「切了形态其实没切地址」。
 */
export function buildEndpoint(baseUrl, mode = 'chat') {
  const suffix = mode === 'responses' ? '/responses' : '/chat/completions';
  const otherSuffix = mode === 'responses' ? '/chat/completions' : '/responses';

  const raw = String(baseUrl || '').trim();
  if (!raw) throw new TranslateError('尚未配置接口地址（Base URL）。');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TranslateError(`接口地址不合法：${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TranslateError('接口地址必须是 http(s) 协议。');
  }

  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith(otherSuffix)) path = path.slice(0, -otherSuffix.length);
  if (!path.endsWith(suffix)) path += suffix;

  url.pathname = path;
  url.hash = '';
  return url.toString();
}

export function endpointOrigin(baseUrl) {
  try {
    return `${new URL(String(baseUrl).trim()).origin}/*`;
  } catch {
    return '';
  }
}

/** 区分「超时」和「用户取消」，两者都以 AbortError 形式冒出来。 */
export function toAbortError(controller, timeoutMs) {
  const reason = controller.signal.reason;
  if (reason instanceof Error && reason.message === 'timeout') {
    return new TranslateError(
      `请求超时（${Math.round(timeoutMs / 1000)} 秒），可在设置页调大超时时间，或缩短选中的文本。`
    );
  }
  return new TranslateError('已取消翻译。');
}

async function readErrorBody(res) {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return json?.error?.message || json?.message || text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return '';
  }
}

/** HTTP 状态码不是 2xx 时抛出带引导的异常。 */
export async function assertOk(res) {
  if (res.ok) return;
  const detail = await readErrorBody(res);
  const hint = STATUS_HINTS[res.status] || '请检查接口地址、模型名与账号状态。';
  throw new TranslateError(`请求失败（HTTP ${res.status}）：${detail || hint}`, {
    status: res.status,
    hint,
  });
}

/** 解析用户填的 JSON 对象（请求头 / 请求体 / 工具声明）。 */
export function parseJsonObject(raw, label) {
  const text = String(raw || '').trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new TranslateError(`${label}不是合法 JSON：${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TranslateError(`${label}必须是 JSON 对象。`);
  }
  return parsed;
}

/** 解析工具声明：允许对象或对象数组。 */
export function parseJsonToolList(raw, label) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new TranslateError(`${label}不是合法 JSON：${err.message}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];
  throw new TranslateError(`${label}必须是 JSON 对象或对象数组。`);
}

/** 思考模式语义（两种 API 形态各自映射成自己的线格式）。 */
export function thinkingModeOf(settings = {}) {
  const mode = settings.thinkingMode;
  return mode === 'disabled' || mode === 'enabled' ? mode : 'default';
}

export function effortOf(settings = {}) {
  return ['low', 'high', 'max'].includes(settings.reasoningEffort)
    ? settings.reasoningEffort
    : 'high';
}

/**
 * 统一的 POST 流程：建超时/取消控制器 → fetch → 交给 handler 处理响应 → 收尾清理。
 * handler 里的异常会被分类：AbortError / 控制器已 abort 一律转成可读的取消或超时提示。
 */
export async function withRequest(options, handler) {
  const {
    endpoint,
    apiKey,
    body,
    extraHeaders = {},
    timeoutMs = 90000,
    signal,
    debug,
  } = options;

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extraHeaders };
  await debug?.data('request', { endpoint, method: 'POST', headers, body });
  const timeout = Math.max(5000, Number(timeoutMs) || 90000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  const onOuterAbort = () => controller.abort(new Error('aborted'));
  const detach = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  };

  if (signal) {
    if (signal.aborted) controller.abort(new Error('aborted'));
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    detach();
    if (err?.name === 'AbortError') throw toAbortError(controller, timeout);
    throw new TranslateError(
      `无法连接到 ${endpoint}：${err?.message || err}。请检查网络或代理设置。`
    );
  }

  try {
    if (debug) {
      await debug.data('http', { status: res.status, statusText: res.statusText, url: res.url, headers: Object.fromEntries(res.headers.entries()) });
      if (res.body) {
        // Tap the stream as it is consumed: capture full SSE/JSON/error bodies without a second network request.
        const decoder = new TextDecoder();
        const body = res.body.pipeThrough(new TransformStream({
          transform(chunk, controller) { debug.chunk('http', decoder.decode(chunk, { stream: true })); controller.enqueue(chunk); },
          flush() { const tail = decoder.decode(); if (tail) debug.chunk('http', tail); },
        }));
        res = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
    }
    return await handler(res, controller, timeout);
  } catch (err) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw toAbortError(controller, timeout);
    }
    throw err;
  } finally {
    detach();
  }
}

/**
 * 带超时与取消的 GET（抓 poe2db 术语页用）。
 * 与 withRequest 的区别：不带鉴权、不做 JSON 序列化、不把 4xx 当异常抛，
 * 由调用方自己看 res.status（poe2db 用 404 表示该术语页不存在）。
 */
export async function httpGet(url, { signal, timeoutMs = 15000, headers = {} } = {}) {
  const timeout = Math.max(3000, Number(timeoutMs) || 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  const onOuterAbort = () => controller.abort(new Error('aborted'));
  const detach = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  };

  if (signal) {
    if (signal.aborted) controller.abort(new Error('aborted'));
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml', ...headers },
      credentials: 'omit', // 不带 cookie，只是读公开页面
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw toAbortError(controller, timeout);
    throw new TranslateError(`无法访问 ${url}：${err?.message || err}。请检查网络或代理设置。`);
  } finally {
    detach();
  }
}

/**
 * 逐行消费 SSE。两种形态的事件体都是 `data: {json}`，只是事件类型不同，
 * 所以把「拆行」这件事共用，具体语义交给 onEvent。
 */
export async function consumeSse(res, onEvent) {
  if (!res.body) throw new TranslateError('服务端未返回流式响应体。');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return; // 半包/心跳等无法解析的行直接忽略
    }
    onEvent(json);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) handleLine(buffer);
}
