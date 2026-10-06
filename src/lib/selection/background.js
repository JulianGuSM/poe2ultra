import { collectContext } from '../translation/context.js';
import { requireEndpointPermission } from '../translation/preferences';
/**
 * Service Worker：唯一持有 API Key 的地方，负责调用 DeepSeek 接口。
 * 与页面之间用长连接 Port 通信，以便把流式结果边收边推。
 */
import { defaultSettings as DEFAULTS, normalizeSettings, validateSettings, selectionSettings } from '../translation/settings';
import { getSettings, saveSettings, resetSettings } from '../translation/preferences';
import { TranslateError, buildEndpoint, endpointOrigin } from '../translation/vendor/api-base.js';
import { translate as translateChat, buildBody as buildChatBody } from '../translation/vendor/deepseek.js';
import { translate as translateResponses, buildBody as buildResponsesBody } from '../translation/vendor/responses.js';
import { describePrompt, describeGlossaryState, groupDirectHits } from '../translation/vendor/context.js';
import { DUAL_TARGET_SHORT, formatDualForCopy, isDualOutput, parseDualOutput } from '../translation/vendor/dual.js';
import { estimateCost } from '../translation/vendor/pricing.js';
import {
  buildIndex,
  buildSearchQuery,
  extractCandidates,
  extractTerms,
  invalidateGlossary,
  loadGlossary,
  OVERRIDE_KEY,
} from '../translation/vendor/glossary.js';
import { clearTavilyCache, searchTavily, tavilyCacheSize } from '../translation/vendor/tavily.js';
import {
  EN_LOCALE,
  buildTermUrl,
  clearPoe2dbCache,
  directLocaleOrder,
  lookupTerms,
  poe2dbCacheSize,
} from '../translation/vendor/poe2db.js';

const PORT_NAME = 'poe2ultra-selection';
const MENU_ID = 'poe2ultra-translate-selection';
const CONTENT_SCRIPT = 'content-scripts/selection.js';

/** 按设置里的 API 形态挑客户端；两种形态对外接口完全一致。 */
function pickClient(settings) {
  return settings.apiMode === 'chat' ? translateChat : translateResponses;
}

/** 与客户端同一套 buildBody，用来还原「实际发出去的那份 prompt」。 */
function pickBodyBuilder(settings) {
  return settings.apiMode === 'chat' ? buildChatBody : buildResponsesBody;
}

/**
 * 组装要展示给用户的最终 prompt。
 * 走的是客户端同一个 buildBody，所以展示内容与实际请求体一致；
 * 即使「自定义请求体」覆盖了 messages/input，也会如实反映。
 */
function promptViewOf(settings, input) {
  const mode = settings.apiMode === 'chat' ? 'chat' : 'responses';
  try {
    const body = pickBodyBuilder(settings)(settings, input);
    const { system, user } = describePrompt(body);
    return { mode, system, user, error: '' };
  } catch (err) {
    return { mode, system: '', user: '', error: String(err?.message || err) };
  }
}

function endpointOf(settings) {
  return buildEndpoint(settings.baseUrl, settings.apiMode === 'chat' ? 'chat' : 'responses');
}

const parseLocaleList = (raw, fallback = 'us,cn,tw') =>
  String(raw ?? fallback)
    .split(/[,\s]+/)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

/**
 * 术语增强：本地术语表 → poe2db 直查（按术语构造页面 URL）→ Tavily 兜底。
 * 任何一步失败都不应该让翻译失败，只记一条 warning。
 */
/* ------------------------------------------------------------------ 安装 */

export function registerSelection() {
chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '翻译选中文本（DeepSeek）',
      contexts: ['selection'],
    });
  });


});

/* ---------------------------------------------------------------- 上下文菜单 */

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  dispatchTranslateToTab(tab, info.frameId, info.selectionText || '');
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'translate-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) dispatchTranslateToTab(tab, undefined, '');
});

async function dispatchTranslateToTab(tab, frameId, selectionText) {
  const message = { type: 'translate-selection-command', text: selectionText };
  const options = frameId === undefined ? {} : { frameId };
  try {
    await chrome.tabs.sendMessage(tab.id, message, options);
  } catch {
    // 页面在扩展安装前就打开了，按需注入一次内容脚本再重试
    try {
      await chrome.scripting.executeScript({
        target: frameId === undefined ? { tabId: tab.id } : { tabId: tab.id, frameIds: [frameId] },
        files: [CONTENT_SCRIPT],
      });
      await chrome.tabs.sendMessage(tab.id, message, options);
    } catch {
      /* chrome:// 等受限页面，忽略 */
    }
  }
}

/* -------------------------------------------------------------- 长连接翻译 */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  if (port.sender?.id !== chrome.runtime.id || !/^https?:\/\//.test(port.sender?.url || '')) { port.disconnect(); return; }
  /** requestId -> AbortController */
  const jobs = new Map();

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'start' && jobs.size === 0 && typeof msg.requestId === 'string') {
      runJob(port, jobs, msg).catch(() => {});
    } else if (msg.type === 'abort') {
      jobs.get(msg.requestId)?.abort(new Error('aborted'));
    }
  });

  port.onDisconnect.addListener(() => {
    for (const controller of jobs.values()) controller.abort(new Error('aborted'));
    jobs.clear();
  });
});

async function runJob(port, jobs, msg) {
  const { requestId } = msg;
  const controller = new AbortController();
  jobs.set(requestId, controller);
  const startedAt = Date.now();

  const post = (payload) => {
    try {
      port.postMessage({ requestId, ...payload });
    } catch {
      /* 页面已关闭 */
    }
  };

  try {
    const settings = await getSettings();
    const text = String(msg.text || '');
    if (!text.trim()) throw new TranslateError('没有选中任何文本。');
    if (text.length > settings.maxChars) throw new TranslateError(`选中文本超过 ${settings.maxChars} 字符，请缩短选区。`);
    controller.signal.throwIfAborted();

    const permitError = await checkHostPermission(settings.baseUrl);
    if (permitError) throw permitError;

    post({
      type: 'started',
      model: settings.model,
      targetLang: isDualOutput(settings) ? DUAL_TARGET_SHORT : settings.targetLang,
      dual: isDualOutput(settings),
      apiMode: settings.apiMode,
    });

    // 先做术语增强，把命中的术语/来源推给面板，再让模型开始翻译
    const input = {
      text,
      title: String(msg.title || '').slice(0, 500),
      url: String(msg.url || '').slice(0, 2048),
      pageLang: msg.pageLang || '',
      terms: [],
      sources: [],
    };
    const context = await collectContext(settings, input, controller.signal);
    input.terms = context.terms;
    input.direct = context.direct;
    input.sources = context.sources;
    const showPrompt = settings.showPrompt !== false;
    const prompt = showPrompt ? promptViewOf(settings, input) : null;
    const glossary = {
      text: describeGlossaryState({
        ...context.glossary,
        directTried: context.directTried || 0,
        // 一个术语可能有 cn/tw 两条命中，状态行按「术语」计数才有意义
        directHit: groupDirectHits(context.direct).length,
        tavilyCount: context.sources.length,
      }),
      level: context.glossary.error ? 'bad' : context.glossary.matched > 0 ? 'hit' : '',
    };
    post({
      type: 'context',
      terms: settings.showContext === false ? [] : context.terms,
      direct: settings.showContext === false ? [] : context.direct,
      sources: settings.showContext === false ? [] : context.sources,
      warnings: context.warnings,
      notes: context.notes,
      glossarySource: context.glossarySource,
      glossary,
      prompt,
    });

    controller.signal.throwIfAborted();
    const result = await pickClient(settings)({
      settings,
      input,
      signal: controller.signal,
      onChunk: (chunk) => post({ type: 'chunk', delta: chunk }),
      onReasoning: (chunk) => post({ type: 'reasoning', delta: chunk }),
    });

    if (!result.text) {
      throw new TranslateError('模型没有返回任何内容，请检查提示词或换一个模型试试。');
    }
    const cost = settings.showCost === false ? null : estimateCost(result.usage, settings);
    // 双版本模式：把【简中】【繁中】两段拆开下发，面板分栏展示、各自复制
    const dual = isDualOutput(settings) ? parseDualOutput(result.text) : null;
    const warnings = [...context.warnings];
    if (isDualOutput(settings) && !dual) {
      warnings.push('模型没有按【简中】【繁中】分段输出，已按整段展示；可重试或检查提示词里的格式要求。');
    } else if (dual && !dual.ok) {
      warnings.push(`模型输出缺少「${dual.missing === 'cn' ? '简中' : '繁中'}」那一段，请重试。`);
    }
    post({
      type: 'done',
      text: result.text,
      dual,
      dualText: dual ? formatDualForCopy(dual) : '',
      reasoning: result.reasoning,
      usage: result.usage,
      cost: cost ? { cny: cost.cny, text: cost.text, label: cost.label, peak: cost.peak } : null,
      finishReason: result.finishReason || '',
      citations: result.citations || [],
      terms: settings.showContext === false ? [] : context.terms,
      direct: settings.showContext === false ? [] : context.direct,
      sources: settings.showContext === false ? [] : context.sources,
      glossary,
      prompt,
      warnings,
      notes: context.notes,
      model: result.model,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    // 只要是我们自己 abort 的（用户点停止 / 关闭面板 / 页面关闭），都算取消而不是失败
    const aborted = controller.signal.aborted;
    post({
      type: 'error',
      message: aborted ? '已取消翻译。' : err?.message || String(err),
      hint: aborted ? '' : err?.hint || '',
      aborted,
    });
  } finally {
    jobs.delete(requestId);
  }
}

/** 返回 null 表示有权限；否则返回一个带引导的错误。 */
async function checkHostPermission(baseUrl) {
  try { await requireEndpointPermission(baseUrl); return null; }
  catch (error) { return error; }
}

/** 术语表分类统计，给设置页显示。 */
function summarizeCategories(index) {
  const counts = new Map();
  for (const entry of index.en.values()) {
    counts.set(entry.k, (counts.get(entry.k) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}

/** 用户导入的术语表被替换/清除后，丢掉进程内索引缓存。 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && OVERRIDE_KEY in changes) invalidateGlossary();
});

/* ------------------------------------------------------------------ 消息 */

const MESSAGE_HANDLERS = {
  'get-selection-settings': async () => selectionSettings(await getSettings()),
  'import-glossary': async msg => {
    if (!msg.glossary?.entries?.length || msg.glossary.entries.length > 100000) throw new Error('术语表格式或条数无效。');
    buildIndex(msg.glossary);
    await chrome.storage.local.set({ [OVERRIDE_KEY]: msg.glossary });
    invalidateGlossary();
    return { ok: true };
  },
  'get-settings': () => getSettings(),
  'save-settings': (msg) => saveSettings(msg.patch || {}),
  'reset-settings': () => resetSettings(),
  'open-options': async () => {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },
  'ensure-host-permission': async (msg) => {
    const origin = endpointOrigin(msg.baseUrl || DEFAULTS.baseUrl);
    if (!origin) throw new Error('接口地址不合法。');
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return { granted: true };
    const granted = await chrome.permissions.request({ origins: [origin] });
    return { granted };
  },
  'glossary-stats': async () => {
    const override = await chrome.storage.local.get([OVERRIDE_KEY]);
    const imported = override?.[OVERRIDE_KEY];
    let bundled = { count: 0, maxEnWords: 0 };
    let loaded = null;
    try {
      loaded = await loadGlossary();
      bundled = loaded.meta;
    } catch {
      /* 读不到就报 0 */
    }
    return {
      activeSource: loaded?.source || '',
      bundled,
      indexSize: loaded?.index?.size || 0,
      collisions: loaded?.index?.collisions || 0,
      imported: imported
        ? { count: imported.meta?.count || imported.entries?.length || 0, importedAt: imported.meta?.importedAt || '' }
        : null,
      categories: loaded ? summarizeCategories(loaded.index) : [],
    };
  },
  'clear-glossary-override': async () => {
    await chrome.storage.local.remove([OVERRIDE_KEY]);
    invalidateGlossary();
    return { ok: true };
  },
  'glossary-test': async (msg) => {
    const loaded = await loadGlossary();
    const text = String(msg.text || '').trim();
    if (!text) throw new Error('请输入要测试的文字。');
    const categories = String(msg.categories || '')
      .split(/[,\s]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const terms = extractTerms(text, loaded.index, {
      maxTerms: Number(msg.maxTerms) || 20,
      categories: categories.length ? categories : null,
    });
    return { terms, source: loaded.source, size: loaded.index.size };
  },
  'tavily-test': async (msg) => {
    const settings = normalizeSettings({ ...(await getSettings()), ...(msg.patch || {}) });
    validateSettings(settings);
    const startedAt = Date.now();
    const { results, fromCache, query } = await searchTavily({
      apiKey: settings.tavilyApiKey,
      query: String(msg.query || 'Abyssal Lich'),
      maxResults: settings.tavilyMaxResults,
      domains: String(settings.tavilyDomains || 'poe2db.tw').split(/[,\s]+/),
      // 测试要和真实链路一致：同样按语言路径过滤、同样偏好目标语言
      locales: parseLocaleList(settings.poe2dbLocales),
      preferLocale: /繁|繁體/.test(String(settings.targetLang || '')) ? 'tw' : 'cn',
      useCache: false,
    });
    return { query, results, fromCache, elapsedMs: Date.now() - startedAt };
  },
  'tavily-cache-stats': async () => ({ entries: await tavilyCacheSize() }),
  'clear-tavily-cache': async () => ({ ok: await clearTavilyCache() }),
  'poe2db-test': async (msg) => {
    const settings = normalizeSettings({ ...(await getSettings()), ...(msg.patch || {}) });
    validateSettings(settings);
    const term = String(msg.term || '').trim();
    if (!term) throw new Error('请输入要测试的术语。');
    const locales = parseLocaleList(settings.poe2dbLocales);
    const preferLocale = /繁|繁體/.test(String(settings.targetLang || '')) ? 'tw' : 'cn';
    const { hits, requested, notes } = await lookupTerms([term], {
      locales,
      preferLocale,
      limit: 1,
      budget: 6,
      useCache: false, // 测试要真实访问
    });
    return {
      term,
      // 真实尝试顺序：中文页在前（cn/tw 都会抓），us 只在中译都没命中时兜底
      tried: directLocaleOrder(locales, preferLocale).map((locale) => ({
        locale,
        url: buildTermUrl(term, locale),
        fallback: locale === EN_LOCALE,
      })),
      hits,
      requested,
      notes,
    };
  },
  'poe2db-cache-stats': async () => ({ entries: await poe2dbCacheSize() }),
  'clear-poe2db-cache': async () => ({ ok: await clearPoe2dbCache() }),
  'test-connection': async (msg) => {
    const settings = normalizeSettings({ ...(await getSettings()), ...(msg.patch || {}) });
    validateSettings(settings);
    if (!String(settings.apiKey || '').trim()) {
      throw new TranslateError('请先填写 API Key 再测试。');
    }
    // 自建中转地址可能不在默认 host_permissions 里，测试前确保有权限
    const origin = endpointOrigin(settings.baseUrl);
    if (origin) {
      const has = await chrome.permissions.contains({ origins: [origin] });
      if (!has) await chrome.permissions.request({ origins: [origin] }).catch(() => {});
    }
    const startedAt = Date.now();
    // 用一段带真实游戏术语的样本文本，顺便验证「术语表 → Tavily → 模型」整条链路
    const input = {
      text: 'Abyssal Lich grants Minion Instability, and increases Damage of Minions by 20%.',
      title: '连接测试',
      url: '',
      pageLang: 'en',
      terms: [],
      sources: [],
    };
    const context = await collectContext(settings, input);
    input.terms = context.terms;
    input.direct = context.direct;
    input.sources = context.sources;

    const result = await pickClient(settings)({
      settings: { ...settings, stream: false, maxTokens: Math.min(settings.maxTokens || 256, 512) },
      input,
    });
    const cost = estimateCost(result.usage, settings);
    return {
      ok: true,
      model: result.model,
      apiMode: settings.apiMode,
      elapsedMs: Date.now() - startedAt,
      sample: result.text,
      endpoint: endpointOf(settings),
      usage: result.usage || null,
      citations: result.citations || [],
      terms: context.terms,
      sources: context.sources,
      warnings: context.warnings,
      glossarySource: context.glossarySource,
      cost: cost ? { cny: cost.cny, text: cost.text, label: cost.label, peak: cost.peak } : null,
    };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) return false;
  const fromOptions = sender.url === chrome.runtime.getURL('/options.html');
  const publicAction = ['get-selection-settings', 'open-options'].includes(msg?.type);
  if (!fromOptions && (!publicAction || !/^https?:\/\//.test(sender.url || ''))) return false;
  const handler = msg && MESSAGE_HANDLERS[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({
        ok: false,
        error: err?.message || String(err),
        hint: err?.hint || '',
        status: err?.status || 0,
      })
    );
  return true; // 异步响应
});

}
