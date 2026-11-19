/**
 * 设置页逻辑。
 */
import { PLACEHOLDERS, groupDirectHits, poe2dbLocaleLabel } from '../../lib/selection/prompt.js';
import { defaultSettings as DEFAULTS } from '../../lib/translation/settings';
import { getSettings, saveSettings, resetSettings, maskKey } from './store.js';
import { buildEndpoint, endpointOrigin } from '../../lib/translation/vendor/api-base.js';
import { buildBody as buildChatBody } from '../../lib/translation/vendor/deepseek.js';
import { buildBody as buildResponsesBody } from '../../lib/translation/vendor/responses.js';
import { compactRows, parseGlossaryCsv, parseGlossaryText } from '../../lib/translation/vendor/glossary.js';
import { initDebugPanel } from './debug.js';
import { CACHE_BACKUP_MAX_BYTES, validateCacheBackup } from '../../lib/translation/cache-backup';
import { sitePermissionOrigins } from '../../lib/selection/site-patterns';

const $ = (id) => document.getElementById(id);

const CHECKBOXES = [
  'showButton', 'autoTranslate', 'keepSource', 'autoClosePanel', 'showPrompt',
  'dualOutput', 'debugEnabled',
  'showContext', 'poe2dbDirectEnabled', 'tavilyEnabled',
];
const TEXTS = [
  'apiKey', 'baseUrl', 'model', 'targetLang', 'systemPrompt', 'userPrompt',
  'extraHeaders', 'customBody', 'chinaTradeLeague',
  'tavilyApiKey', 'tavilyDomains', 'poe2dbLocales',
  'customTermAliases',
  'selectionMatchPatterns',
];
const NUMBERS = [
  'temperature', 'maxTokens', 'panelWidth', 'maxChars',
  'tavilyMaxResults', 'poe2dbMaxTerms', 'poe2dbRequestBudget',
];

/** 模式说明里用到的端点，供界面提示与预览共用。 */
function currentEndpoint(settings) {
  try {
    return buildEndpoint(settings.baseUrl, settings.apiMode === 'chat' ? 'chat' : 'responses');
  } catch {
    return '';
  }
}

let lastFocusedTextarea = null;
let saveTimer = 0;

/* ------------------------------------------------------- 保存状态跟踪 */

// 表单填好之前一律不写 storage：否则一旦在加载途中触发保存，
// 会把「还没填入的默认空值」整份刷进配置，把用户的设置清掉。
let formReady = false;
let saving = false;
let autoSaveTimer = 0;
let lastSavedSnapshot = '';

function setSaveState(text, kind = '') {
  const el = $('save-state');
  if (!el) return;
  el.textContent = text;
  el.className = `save-state ${kind}`.trim();
}

/* ------------------------------------------------------------ 表单读写 */

function collectForm() {
  const patch = {};
  for (const id of TEXTS) patch[id] = $(id).value.trim();
  for (const id of CHECKBOXES) patch[id] = $(id).checked;
  for (const id of NUMBERS) patch[id] = Number($(id).value);
  patch.theme = $('theme').value;
  patch.thinkingMode = $('thinkingMode').value;
  patch.reasoningEffort = $('reasoningEffort').value;
  patch.apiMode = $('apiMode').value;
  patch.timeoutMs = Math.round(Number($('timeoutSec').value) * 1000);
  patch.advancedSettingsEnabled = $('btn-enable-advanced').getAttribute('aria-pressed') === 'true';

  // 数值兜底，避免用户清空输入框后存进 NaN
  for (const key of ['temperature', 'maxTokens', 'panelWidth', 'maxChars', 'timeoutMs', 'tavilyMaxResults']) {
    if (!Number.isFinite(patch[key])) patch[key] = DEFAULTS[key];
  }
  return patch;
}

function syncTargetLanguageControl() {
  const value = $('targetLang').value || '简体中文';
  $('targetLangLabel').textContent = value;
  $('targetLangTrigger').disabled = $('dualOutput').checked;
  for (const option of document.querySelectorAll('[data-target-lang]')) {
    option.setAttribute('aria-selected', String(option.dataset.targetLang === value));
  }
}

function fillForm(s) {
  for (const id of TEXTS) $(id).value = s[id] ?? '';
  for (const id of CHECKBOXES) $(id).checked = Boolean(s[id]);
  for (const id of NUMBERS) $(id).value = s[id];
  $('theme').value = s.theme;
  $('thinkingMode').value = s.thinkingMode;
  $('reasoningEffort').value = s.reasoningEffort;
  $('apiMode').value = s.apiMode;
  $('timeoutSec').value = Math.round((s.timeoutMs || 90000) / 1000);
  setAdvancedSettingsEnabled(Boolean(s.advancedSettingsEnabled));
  syncTargetLanguageControl();
  renderKeyState(s.apiKey);
  renderThinkingState();
  renderApiModeState();
  renderTermState();
  checkPermission(s.baseUrl);
}

/** API 形态联动：端点提示、旧模型名告警。 */
function renderApiModeState() {
  const s = collectForm();
  const isResponses = s.apiMode !== 'chat';
  const endpoint = currentEndpoint(s);

  $('api-mode-state').textContent = endpoint
    ? `实际请求：POST ${endpoint}`
    : '接口地址还不能解析，请检查 Base URL。';

  const legacy = /^deepseek-(chat|reasoner)$/i.test(String(s.model || '').trim());
  const modelHint = $('model-hint');
  if (isResponses && legacy) {
    modelHint.className = 'hint bad';
    modelHint.textContent = '请确认接口服务商支持该模型与 Responses API；如请求报错，可调整模型或切换 Chat Completions。';
  } else {
    modelHint.className = 'hint';
    modelHint.textContent = isResponses ? '' : '模型可用性取决于当前接口服务商。';
  }
}

/**
 * 思考模式相关联动：
 * - 强度只在「开启」时有效
 * - 思考模式下 temperature 不生效（官方文档明确说明），所以置灰并说明
 */
function renderThinkingState() {
  const mode = $('thinkingMode').value;
  const thinkingOn = mode !== 'disabled';
  $('reasoningEffort').disabled = mode !== 'enabled';
  $('reasoningEffort').style.opacity = mode === 'enabled' ? '1' : '.55';

  $('temperature').disabled = thinkingOn;
  $('temperature').style.opacity = thinkingOn ? '.55' : '1';

  const state = $('thinking-state');
  state.className = 'hint';
  const isResponses = $('apiMode').value !== 'chat';
  if (mode === 'disabled') {
    state.textContent = isResponses
      ? '已显式关闭思考：请求会带 {"reasoning":{"effort":"none"}}，速度最快、最省。'
      : '已显式关闭思考：请求会带 {"thinking":{"type":"disabled"}}，速度最快、最省。';
  } else if (mode === 'enabled') {
    state.textContent = isResponses
      ? `已显式开启思考，请求会带 {"reasoning":{"effort":"${$('reasoningEffort').value}"}}；思维链 token 按输出价计费。`
      : `已显式开启思考，请求会带 {"thinking":{"type":"enabled"}} + reasoning_effort=${$('reasoningEffort').value}；思维链 token 按输出价计费。`;
  } else {
    state.textContent = '不发送思考参数，由服务端决定。需要控制成本时可以显式关闭。';
  }

  $('temperature-hint').textContent = thinkingOn
    ? '思考模式下该值不生效（官方：设置不报错但会被忽略）；想让它生效请把思考模式设为「关闭」。'
    : '非思考模式下生效；DeepSeek 早期文档对翻译场景建议 1.3。';
}

function setAdvancedSettingsEnabled(enabled) {
  const button = $('btn-enable-advanced');
  if (!button) return;
  button.setAttribute('aria-pressed', String(enabled));
  button.textContent = enabled ? '关闭高阶设置' : '开启高阶设置';
  for (const panel of document.querySelectorAll('[data-advanced-controls]')) {
    panel.setAttribute('aria-disabled', String(!enabled));
    panel.inert = !enabled;
  }
}

/** 术语表 + Tavily 的状态展示。 */
async function renderTermState() {
  const s = collectForm();
  const stats = $('glossary-stats');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'glossary-stats' });
    if (res?.ok) {
      const d = res.data;
      stats.textContent = `当前术语库版本：${d.version}`;
    }
  } catch {
    stats.textContent = '术语表状态读取失败。';
  }

  const tavilyState = $('tavily-state');
  if (!String(s.tavilyApiKey || '').trim()) {
    tavilyState.className = 'hint bad';
    tavilyState.textContent = '未填写 Tavily API Key，术语表没覆盖时不会联网补充。';
  } else {
    tavilyState.className = 'hint ok';
    tavilyState.textContent = `已配置：${maskKey(s.tavilyApiKey)}（仅存于本机）`;
  }

  try {
    const cache = await chrome.runtime.sendMessage({ type: 'tavily-cache-stats' });
    $('tavily-cache-state').textContent = `本地已缓存 ${cache?.data?.entries ?? 0} 条检索结果（有效期 14 天）。`;
  } catch {
    $('tavily-cache-state').textContent = '';
  }

  try {
    const cache = await chrome.runtime.sendMessage({ type: 'poe2db-cache-stats' });
    $('poe2db-cache-state').textContent = `本地已缓存 ${cache?.data?.entries ?? 0} 个 poe2db 页面/404 结果（有效期 14 天）。`;
  } catch {
    $('poe2db-cache-state').textContent = '';
  }
}

let canonicalGlossaryTerms = [];
let selectedCustomCanonical = null;
let customTermDialogMode = 'add';
function customAliasRows() {
  const rows = JSON.parse($('customTermAliases').value || '[]');
  if (!Array.isArray(rows)) throw new Error('映射内容必须是 JSON 数组。');
  return rows;
}

function completeCustomAlias(row) {
  const canonical = canonicalGlossaryTerms.find(term => term.en.toLowerCase() === String(row.canonical || '').toLowerCase());
  return {
    canonical: row.canonical || '',
    alias: row.alias || '',
    cn: row.cn || canonical?.cn || '',
    tw: row.tw || canonical?.tw || '',
  };
}

function renderCustomTermAliases() {
  const list = $('customTermAliasList');
  list.replaceChildren();
  let rows;
  try { rows = customAliasRows(); } catch (error) { list.textContent = `自定义术语 JSON 格式有误：${error.message}`; return; }
  if (!rows.length) {
    list.textContent = '尚未添加自定义术语。';
    return;
  }
  for (const [index, row] of rows.entries()) {
    const item = document.createElement('div');
    item.className = 'custom-term-alias-row';
    const description = document.createElement('div');
    description.className = 'custom-term-alias-description';
    const title = document.createElement('strong');
    title.textContent = row.alias || '(空 alias)';
    const canonical = document.createElement('span');
    canonical.textContent = `${row.canonical || ''} · ${completeCustomAlias(row).cn || '暂无简中'} / ${completeCustomAlias(row).tw || '暂无繁中'}`;
    description.append(title, canonical);
    const actions = document.createElement('div');
    actions.className = 'custom-term-alias-actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'btn tiny';
    view.textContent = '查看';
    view.addEventListener('click', () => openCustomTermView(completeCustomAlias(row)));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn tiny danger';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      const next = customAliasRows();
      next.splice(index, 1);
      $('customTermAliases').value = JSON.stringify(next, null, 2);
      $('customTermAliases').dispatchEvent(new Event('input', { bubbles: true }));
      renderCustomTermAliases();
    });
    actions.append(view, remove);
    item.append(description, actions);
    list.append(item);
  }
}

function searchCanonicalTerms() {
  const query = $('customTermModalSearch').value.trim().toLocaleLowerCase();
  const results = $('customTermModalResults');
  const state = $('customTermModalState');
  results.replaceChildren();
  if (!query) {
    state.textContent = '请输入简体中文搜索词。';
    return;
  }
  const matches = canonicalGlossaryTerms
    .filter(term => (term.cn || '').toLocaleLowerCase().includes(query))
    .sort((a, b) => Number((b.cn || '').toLocaleLowerCase().startsWith(query)) - Number((a.cn || '').toLocaleLowerCase().startsWith(query)) || a.en.localeCompare(b.en))
    .slice(0, 30);
  if (!matches.length) {
    state.textContent = '没有找到对应的官方术语简中译名。';
    return;
  }
  state.textContent = `搜索到 ${matches.length === 30 ? '30 条以上' : `${matches.length} 条`}，选择对应标准术语：`;
  for (const term of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'term-search-result';
    button.setAttribute('role', 'option');
    const cn = document.createElement('strong');
    cn.textContent = term.cn || term.en;
    const en = document.createElement('span');
    en.textContent = term.en;
    const category = document.createElement('small');
    category.textContent = `${term.tw || ''}${term.category ? ` · ${term.category}` : ''}`;
    button.append(cn, en, category);
    button.addEventListener('click', () => {
      const alias = $('customTermModalAlias').value.trim();
      if (!alias) {
        state.textContent = '请先填写 alias，再选择标准术语。';
        $('customTermModalAlias').focus();
        return;
      }
      selectedCustomCanonical = { canonical: term.en, alias, cn: term.cn || '', tw: term.tw || '' };
      $('customTermModalJson').textContent = JSON.stringify(selectedCustomCanonical, null, 2);
      $('customTermModalJson').hidden = false;
      $('btn-custom-term-save').disabled = false;
      state.textContent = `已选择：${term.en}`;
    });
    results.append(button);
  }
}

function openCustomTermAdd() {
  customTermDialogMode = 'add';
  selectedCustomCanonical = null;
  $('custom-term-dialog-title').textContent = '添加自定义术语';
  $('custom-term-dialog-desc').textContent = '填写作者的非标准写法，再搜索并选择官方术语。';
  $('custom-term-editor-fields').hidden = false;
  $('customTermModalAlias').value = '';
  $('customTermModalSearch').value = '';
  $('customTermModalResults').replaceChildren();
  $('customTermModalState').textContent = '输入简体中文后点击搜索。';
  $('customTermModalJson').textContent = '';
  $('customTermModalJson').hidden = true;
  $('btn-custom-term-save').hidden = false;
  $('btn-custom-term-save').disabled = true;
  $('custom-term-dialog').showModal();
  $('customTermModalAlias').focus();
}

function openCustomTermView(mapping) {
  customTermDialogMode = 'view';
  selectedCustomCanonical = mapping;
  $('custom-term-dialog-title').textContent = '查看自定义术语';
  $('custom-term-dialog-desc').textContent = '该记录保存的标准术语、别名和简繁译名。';
  $('custom-term-editor-fields').hidden = true;
  $('customTermModalJson').textContent = JSON.stringify(mapping, null, 2);
  $('customTermModalJson').hidden = false;
  $('btn-custom-term-save').hidden = true;
  $('custom-term-dialog').showModal();
}

async function saveCustomTermMapping() {
  if (customTermDialogMode !== 'add' || !selectedCustomCanonical) return;
  const button = $('btn-custom-term-save');
  if (saving) {
    toast('设置正在保存，请稍后再保存这条映射。', 'bad');
    return;
  }
  const rows = customAliasRows();
  const key = selectedCustomCanonical.alias.trim().toLocaleLowerCase();
  const existing = rows.findIndex(row => String(row.alias || '').trim().toLocaleLowerCase() === key);
  const mapping = { ...selectedCustomCanonical };
  if (existing >= 0) rows[existing] = mapping;
  else rows.push(mapping);
  $('customTermAliases').value = JSON.stringify(rows, null, 2);
  $('customTermAliases').dispatchEvent(new Event('input', { bubbles: true }));
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = 0;
  button.disabled = true;
  button.textContent = '保存中…';
  const saved = await save({ auto: true });
  button.textContent = '保存映射';
  if (!saved) {
    button.disabled = false;
    toast('映射尚未保存，请检查设置页的保存状态后重试。', 'bad');
    return;
  }
  $('custom-term-dialog').close();
  renderCustomTermAliases();
  toast(`已保存：${mapping.alias} → ${mapping.canonical}`, 'ok');
}

async function setupCustomTermEditor() {
  $('customTermAliases').addEventListener('input', renderCustomTermAliases);
  $('btn-custom-term-add').addEventListener('click', openCustomTermAdd);
  $('btn-custom-term-search').addEventListener('click', searchCanonicalTerms);
  $('btn-custom-term-save').addEventListener('click', saveCustomTermMapping);
  $('btn-custom-term-cancel').addEventListener('click', () => $('custom-term-dialog').close());
  $('btn-custom-term-close').addEventListener('click', () => $('custom-term-dialog').close());
  $('customTermModalAlias').addEventListener('input', () => {
    if (!selectedCustomCanonical) return;
    selectedCustomCanonical.alias = $('customTermModalAlias').value.trim();
    $('customTermModalJson').textContent = JSON.stringify(selectedCustomCanonical, null, 2);
    $('btn-custom-term-save').disabled = !selectedCustomCanonical.alias;
  });
  $('customTermModalSearch').addEventListener('input', () => {
    selectedCustomCanonical = null;
    $('customTermModalResults').replaceChildren();
    $('customTermModalJson').hidden = true;
    $('btn-custom-term-save').disabled = true;
    $('customTermModalState').textContent = '输入简体中文后点击搜索。';
  });
  $('customTermModalSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); searchCanonicalTerms(); }
  });
  renderCustomTermAliases();
  try {
    canonicalGlossaryTerms = await optionsRequest({ type: 'glossary-canonical-options' });
    renderCustomTermAliases();
  } catch (error) {
    $('custom-term-dialog-desc').textContent = `官方术语读取失败：${error.message}`;
  }
}

function renderKeyState(key) {
  const el = $('key-state');
  if (!key) {
    el.className = 'hint bad';
    el.textContent = '尚未填写 API 密钥；划词翻译和未缓存攻略的模型翻译需要密钥。';
  } else {
    el.className = 'hint ok';
    el.textContent = `已保存：${maskKey(key)}（仅存于本机）`;
  }
}

async function checkPermission(baseUrl) {
  const el = $('perm-state');
  const origin = endpointOrigin(baseUrl);
  if (!el) return;
  if (!origin) {
    el.textContent = '';
    return;
  }
  try {
    const granted = await chrome.permissions.contains({ origins: [origin] });
    if (granted) {
      el.textContent = '';
    } else {
      el.className = 'hint';
      el.textContent = `当前地址 ${origin.replace('/*', '')} 还没有访问授权，点“保存设置”时会弹出确认。`;
    }
  } catch {
    el.textContent = '';
  }
}

/* --------------------------------------------------------------- 保存 */

function validateJsonFields(patch) {
  for (const [key, label] of [
    ['extraHeaders', '额外请求头'],
    ['customBody', '额外请求体'],
  ]) {
    const raw = patch[key];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('必须是 JSON 对象');
      }
    } catch (err) {
      throw new Error(`${label} 不是合法的 JSON 对象：${err.message}`);
    }
  }
}

/**
 * 保存配置。
 * @param {{auto?: boolean}} options auto=true 表示由自动保存触发：
 *   不申请域名权限（没有用户手势，申请必然失败），校验失败也只更新状态而不是弹 toast。
 */
async function save({ auto = false } = {}) {
  if (!formReady) return false;
  if (saving) {
    // 上一次保存还没回来：稍后重试，避免这次改动被丢掉
    if (auto) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = window.setTimeout(() => {
        autoSaveTimer = 0;
        save({ auto: true });
      }, 300);
    }
    return false;
  }

  const patch = collectForm();
  try {
    validateJsonFields(patch);
    sitePermissionOrigins(patch.selectionMatchPatterns);
  } catch (err) {
    if (auto) setSaveState('未保存：设置格式有误', 'bad');
    else toast(err.message, 'bad');
    return false;
  }
  if (!patch.userPrompt) patch.userPrompt = DEFAULTS.userPrompt;

  const snapshot = JSON.stringify(patch);
  // 站点匹配规则和自定义中转域名：在用户手势中统一申请权限，自动保存时跳过
  let sitePermissionGranted = false;
  const siteOrigins = sitePermissionOrigins(patch.selectionMatchPatterns);
  if (!auto) {
    const requestedOrigins = [...siteOrigins];
    const origin = endpointOrigin(patch.baseUrl);
    const isOfficial = origin === 'https://api.deepseek.com/*';
    if (origin && !isOfficial) requestedOrigins.push(origin);
    if (requestedOrigins.length) {
      try {
        await chrome.permissions.request({ origins: [...new Set(requestedOrigins)] });
      } catch {
        /* 站点权限状态会在保存后提示；接口权限会在翻译时提示 */
      }
    }
  }
  sitePermissionGranted = !siteOrigins.length || await chrome.permissions.contains({ origins: siteOrigins });
  if (snapshot === lastSavedSnapshot) {
    setSaveState(sitePermissionGranted ? '已保存' : '已保存；网站权限未全部授予，部分规则暂未生效', sitePermissionGranted ? '' : 'bad');
    checkPermission(patch.baseUrl);
    return true;
  }


  saving = true;
  setSaveState(auto ? '自动保存中…' : '保存中…', 'pending');
  try {
    await saveSettings(patch);
    lastSavedSnapshot = snapshot;
    renderKeyState(patch.apiKey);
    checkPermission(patch.baseUrl);
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setSaveState(sitePermissionGranted ? `已保存 ${time}` : '已保存；网站权限未全部授予，部分规则暂未生效', sitePermissionGranted ? 'ok' : 'bad');
    if (!auto) toast(sitePermissionGranted ? '设置已保存' : '设置已保存，但部分网站权限未授予，相应规则暂未生效', sitePermissionGranted ? 'ok' : 'bad');
    return true;
  } catch (err) {
    setSaveState('保存失败', 'bad');
    toast(err.message || String(err), 'bad');
    return false;
  } finally {
    saving = false;
  }
}

/* ------------------------------------------------------------ 自动保存 */

function isDirtyForm() {
  try {
    return JSON.stringify(collectForm()) !== lastSavedSnapshot;
  } catch {
    return false;
  }
}

function scheduleAutoSave() {
  if (!formReady) return;
  if (!isDirtyForm()) {
    setSaveState('已保存', 'ok');
    return;
  }
  setSaveState('有未保存的更改…', 'pending');
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = 0;
    save({ auto: true });
  }, 600);
}

/** 关页面前把待保存的改动补一次（尽力而为）。 */
function flushAutoSave() {
  if (!formReady || !autoSaveTimer) return;
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = 0;
  save({ auto: true });
}

/* ---------------------------------------------------------- 测试连接 */

async function testConnection() {
  const btn = $('btn-test');
  const patch = collectForm();
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    const origin = endpointOrigin(patch.baseUrl);
    if (origin && !await chrome.permissions.contains({ origins: [origin] })) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error('尚未授权访问此接口。');
    }
    const res = await chrome.runtime.sendMessage({ type: 'test-connection', patch });
    if (!res?.ok) throw new Error(res?.error || '未知错误');
    const { data } = res;
    const result = `测试连接成功 · ${data.model} · ${data.elapsedMs}ms\n\n${data.sample || '接口已返回有效响应。'}`;
    toast(result, 'ok', Math.min(12000, Math.max(5000, 3000 + result.length * 70)));
    console.info('[DeepSeek 测试连接]', data);
  } catch (err) {
    toast(`连接失败：${err.message || err}`, 'bad');
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

/* -------------------------------------------------------------- 预览 */

/**
 * 预览直接用真实客户端组装请求体，避免预览和实际发出的内容不一致
 * （尤其是 API 形态、思考模式参数、术语表上下文这几处）。
 */
const PREVIEW_SAMPLE = 'Abyssal Lich grants Minion Instability, and increases Damage of Minions by 20%.';

async function preview() {
  const s = collectForm();
  const box = $('preview');
  box.hidden = false;
  box.textContent = '正在抽取术语…';

  const input = {
    text: PREVIEW_SAMPLE,
    title: '示例页面标题',
    url: 'https://example.com/article',
    pageLang: 'en',
    terms: [],
    sources: [],
  };

  // 术语表命中的条目会真的写进提示词，所以预览也现场抽一次
  try {
    const res = await chrome.runtime.sendMessage({ type: 'glossary-test', text: PREVIEW_SAMPLE });
    if (res?.ok) input.terms = res.data.terms || [];
  } catch {
    /* 抽不到就按没有术语预览 */
  }

  let endpoint = '';
  let body;
  try {
    endpoint = currentEndpoint(s);
    body = s.apiMode === 'chat' ? buildChatBody(s, input) : buildResponsesBody(s, input);
  } catch (err) {
    box.textContent = `无法组装请求：${err.message || err}`;
    return;
  }

  const headers = [
    'Content-Type: application/json',
    `Authorization: Bearer ${s.apiKey ? maskKey(s.apiKey) : '(未填写 API Key)'}`,
  ];
  try {
    for (const [k, v] of Object.entries(JSON.parse(s.extraHeaders || '{}'))) {
      headers.push(`${k}: ${v}`);
    }
  } catch {
    headers.push('(自定义请求头不是合法 JSON，保存时会被拦下)');
  }

  box.textContent =
    `POST ${endpoint}\n${headers.join('\n')}\n\n` +
    JSON.stringify(body, null, 2) +
    `\n\n// 示例原文：${PREVIEW_SAMPLE}` +
    `\n// 形态：${s.apiMode === 'chat' ? 'Chat Completions' : 'Responses API'}` +
    `\n// 思考模式：${s.thinkingMode}` +
    `\n// 本地术语表命中：${input.terms.length} 条` +
    `\n// Tavily 补充：${s.tavilyEnabled ? `开启（${s.tavilyDomains}，max ${s.tavilyMaxResults}）——检索结果会在运行时追加` : '关闭'}`;
}

/* ------------------------------------------------- 术语表 / Tavily 操作 */

function readFileText(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    reader.readAsText(file, 'utf-8');
  });
}

function updateGlossaryImportProgress(status, percent) {
  $('glossary-import-status').textContent = status;
  $('glossary-import-percent').textContent = `${percent}%`;
  $('glossary-import-bar').value = percent;
}

async function importGlossaryFile(file) {
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  updateGlossaryImportProgress('读取文件…', 0);
  const text = await readFileText(file, fraction => updateGlossaryImportProgress('读取文件…', Math.round(fraction * 20)));
  let rows;
  if (isCsv) {
    updateGlossaryImportProgress('解析 CSV…', 20);
    rows = await parseGlossaryCsv(text, percent => updateGlossaryImportProgress('解析 CSV…', 20 + Math.round(percent * 0.6)));
  } else {
    updateGlossaryImportProgress('解析术语表…', 80);
    rows = parseGlossaryText(text);
  }
  if (!rows.length) throw new Error('没有解析到任何术语');
  updateGlossaryImportProgress('转换术语数据…', 85);
  const compact = compactRows(rows);
  if (!compact.entries.length) throw new Error('术语条目都缺少 en/zh_cn/zh_tw 字段');
  compact.meta.importedAt = new Date().toISOString();
  compact.meta.fileName = file.name;
  updateGlossaryImportProgress('保存到浏览器本地…', 92);
  await optionsRequest({ type: 'import-glossary', glossary: compact });
  await renderTermState();
  updateGlossaryImportProgress(`完成：${compact.entries.length.toLocaleString('zh-CN')} 条`, 100);
  return compact;
}

async function runGlossaryTest() {
  const box = $('glossary-preview');
  const text = window.prompt('输入要测试抽取的文字（会显示本地术语表的命中结果）', PREVIEW_SAMPLE);
  if (text === null) return;
  const s = collectForm();
  box.hidden = false;
  box.textContent = '抽取消中…';
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'glossary-test',
      text,
    });
    if (!res?.ok) throw new Error(res?.error || '未知错误');
    const { terms, source, size, aliasCount = 0 } = res.data;
    const lines = terms.map(
      (t, i) => `${i + 1}. ${t.en} → ${t.zh_cn}${t.zh_tw && t.zh_tw !== t.zh_cn ? ` / ${t.zh_tw}` : ''}（${t.category}）${t.source ? `\n   ${t.source}` : ''}`
    );
    box.textContent =
      `原文：${text}\n来源：${source === 'imported' ? '已导入的官方术语表' : '内置术语表'}（${size} 条），自定义别名 ${aliasCount} 条\n` +
      `命中 ${terms.length} 条：\n${lines.join('\n') || '（无）'}`;
  } catch (err) {
    box.textContent = `抽取失败：${err.message || err}`;
  }
}

async function runTavilyTest() {
  const btn = $('btn-tavily-test');
  const box = $('glossary-preview');
  const patch = collectForm();
  const query = window.prompt('要检索的关键词', 'Abyssal Lich');
  if (query === null) return;

  btn.disabled = true;
  box.hidden = false;
  box.textContent = '检索中…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'tavily-test', query, patch });
    if (!res?.ok) throw new Error(res?.error || '未知错误');
    const { results, elapsedMs, query: used } = res.data;
    box.textContent =
      `Tavily 查询：${used}\n站点限定：${patch.tavilyDomains} · max ${patch.tavilyMaxResults} · 耗时 ${elapsedMs}ms\n\n` +
      (results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n') || '（没有结果）');
    await renderTermState();
  } catch (err) {
    box.textContent = `检索失败：${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------- 测试 poe2db 直查 */

async function runPoe2dbTest() {
  const btn = $('btn-poe2db-test');
  const box = $('glossary-preview');
  const patch = collectForm();
  const term = window.prompt('要直查的术语（英文原名，如 Abyssal Lich）', 'Abyssal Lich');
  if (term === null) return;

  btn.disabled = true;
  box.hidden = false;
  box.textContent = '直查中…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'poe2db-test', term, patch });
    if (!res?.ok) throw new Error(res?.error || '未知错误');
    const { tried, hits, requested, notes } = res.data;
    const groups = groupDirectHits(hits);
    box.textContent =
      `术语：${term}\n语言路径：${patch.poe2dbLocales}\n按尝试顺序构造出的 URL：\n` +
      tried
        .map((t, i) => `  ${i + 1}. ${t.url}${t.fallback ? '（兜底：中文页都没命中时才抓）' : ''}`)
        .join('\n') +
      `\n\n实际发出请求 ${requested} 次\n` +
      (groups.length
        ? groups
            .map(
              (g) =>
                `命中：${g.term} → ${g.entries
                  .map((h) => `${h.name}（${poe2dbLocaleLabel(h.locale)}）`)
                  .join(' / ')}` +
                g.entries.map((h) => `\n  ${h.url}`).join('')
            )
            .join('\n')
        : '未命中：这些 URL 都返回 404（该术语页面 slug 与显示名不同源，运行时会回退到 Tavily）') +
      (notes?.length ? `\n\n备注：\n${notes.map((n) => `  - ${n}`).join('\n')}` : '');
    await renderTermState();
  } catch (err) {
    box.textContent = `直查失败：${err.message || err}`;
  } finally {
    btn.disabled = false;
  }
}

/* -------------------------------------------------------------- 其他 */

function toast(message, kind = '', durationOverride = null) {
  const el = $('toast');
  $('toast-message').textContent = message;
  el.querySelector('.toast-icon').textContent = kind === 'bad' ? '!' : '✓';
  const duration = durationOverride ?? (kind === 'bad' ? 6000 : 2600);
  el.style.setProperty('--toast-duration', `${duration}ms`);
  el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  el.setAttribute('aria-live', kind === 'bad' ? 'assertive' : 'polite');
  el.className = `toast ${kind}`.trim();
  el.hidden = false;
  window.clearTimeout(saveTimer);
  void el.offsetWidth;
  el.classList.add('is-visible');
  saveTimer = window.setTimeout(() => {
    el.classList.remove('is-visible');
    saveTimer = window.setTimeout(() => { el.hidden = true; }, 350);
  }, duration);
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  scheduleAutoSave(); // 程序化赋值不触发 input 事件
}

function buildChips() {
  const box = $('placeholder-chips');
  for (const { token, desc } of PLACEHOLDERS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = token;
    chip.title = desc;
    chip.addEventListener('click', () => {
      const target = lastFocusedTextarea || $('userPrompt');
      insertAtCursor(target, token);
    });
    box.appendChild(chip);
  }
}

/* ------------------------------------------------------------ 吸顶顶栏 */

/** 滚过哨兵就给顶栏加 .stuck（显示分隔线与投影）。 */
function setupStickyHeader() {
  const sentinel = $('top-sentinel');
  const header = document.querySelector('.top');
  if (!sentinel || !header || typeof IntersectionObserver !== 'function') return;
  new IntersectionObserver(
    ([entry]) => header.classList.toggle('stuck', !entry.isIntersecting),
    { threshold: 0 }
  ).observe(sentinel);
}

/* -------------------------------------------------------------- 启动 */

function setupSettingsTabs() {
  const tabs = [...document.querySelectorAll('[data-settings-tab]')];
  const panels = [...document.querySelectorAll('[data-settings-panel]')];
  if (!tabs.length || !panels.length) return;

  const activate = (index, focus = false) => {
    const active = tabs[index];
    if (!active) return;
    const key = active.dataset.settingsTab;
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== key; });
    if (focus) active.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(index));
    tab.addEventListener('keydown', event => {
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(next, true);
    });
  });

  const selectedIndex = Math.max(0, tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'));
  activate(selectedIndex);
}

function setupTargetLanguageControl() {
  const control = $('targetLangControl');
  const trigger = $('targetLangTrigger');
  const menu = $('targetLangOptions');
  const close = (focusTrigger = false) => {
    control.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-hidden', 'true');
    if (focusTrigger) trigger.focus();
  };
  const open = () => {
    if (trigger.disabled) return;
    control.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-hidden', 'false');
  };

  trigger.addEventListener('click', () => {
    if (control.classList.contains('is-open')) close();
    else open();
  });
  trigger.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' || trigger.disabled) return;
    event.preventDefault();
    open();
    const selected = menu.querySelector('[aria-selected="true"]') || menu.querySelector('[data-target-lang]');
    selected?.focus();
  });
  menu.addEventListener('click', event => {
    const option = event.target.closest('[data-target-lang]');
    if (!option) return;
    const value = $('targetLang');
    value.value = option.dataset.targetLang;
    syncTargetLanguageControl();
    value.dispatchEvent(new Event('input', { bubbles: true }));
    value.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  });
  menu.addEventListener('keydown', event => {
    const options = [...menu.querySelectorAll('[data-target-lang]')];
    const index = options.indexOf(document.activeElement);
    let next = index;
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    options[next]?.focus();
  });
  document.addEventListener('click', event => {
    if (!control.contains(event.target)) close();
  });
}

async function init() {
  setupSettingsTabs();
  buildChips();
  setupStickyHeader();
  fillForm(await getSettings());
  setupTargetLanguageControl();
  $('dualOutput').addEventListener('change', syncTargetLanguageControl);
  await refreshGuideCache();
  initDebugPanel();

  // 表单已经填入真实配置，此后才允许写 storage
  formReady = true;
  lastSavedSnapshot = JSON.stringify(collectForm());
  setSaveState('已保存');

  // 勾选框 / 输入框改动后自动落库：不用再记得点「保存设置」
  // （工具栏弹窗里的开关本来就是即改即存，这里对齐）
  const form = document.querySelector('.wrap');
  form.addEventListener('input', scheduleAutoSave);
  form.addEventListener('change', scheduleAutoSave);
  $('btn-enable-advanced').addEventListener('click', () => {
    setAdvancedSettingsEnabled($('btn-enable-advanced').getAttribute('aria-pressed') !== 'true');
    scheduleAutoSave();
  });
  window.addEventListener('beforeunload', flushAutoSave);
  await setupCustomTermEditor();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutoSave();
  });

  for (const id of ['userPrompt', 'systemPrompt']) {
    $(id).addEventListener('focus', () => {
      lastFocusedTextarea = $(id);
    });
  }

  $('btn-guide-cache-clear').addEventListener('click', async () => {
    if (!confirm('确定清空所有攻略的简中、繁中缓存？重新翻译将再次调用 API。已记录的费用估算会保留。')) return;
    try { await optionsRequest({ type: 'translation-settings', action: 'clear' }, true); await refreshGuideCache(); toast('攻略翻译缓存已清空', 'ok'); }
    catch (error) { toast(error.message, 'bad'); }
  });
  let pendingBackup = null;
  $('btn-guide-cache-export').addEventListener('click', async () => {
    const button = $('btn-guide-cache-export');
    button.disabled = true;
    try {
      if (saving || (isDirtyForm() && !await save({ auto: true }))) throw new Error('请先保存当前设置，再导出缓存。');
      const { backup } = await optionsRequest({ type: 'translation-cache', action: 'export' }, true);
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      if (blob.size > CACHE_BACKUP_MAX_BYTES) throw new Error('备份超过 50 MB，当前版本无法安全导入。');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `poe2ultra-cache-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`已导出 ${backup.records.length.toLocaleString('zh-CN')} 条译文缓存和 ${(backup.guideCosts?.length ?? 0).toLocaleString('zh-CN')} 条费用记录`, 'ok');
    } catch (error) { toast(`导出失败：${error.message || error}`, 'bad'); }
    finally { button.disabled = false; }
  });
  $('btn-translations-csv-export')?.addEventListener('click', async () => {
    const button = $('btn-translations-csv-export');
    button.disabled = true;
    try {
      const { csv, count, unavailable } = await optionsRequest({ type: 'translation-cache', action: 'export-csv' }, true);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = `poe2ultra-translations-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const missing = unavailable ? `；另有 ${unavailable.toLocaleString('zh-CN')} 条旧缓存需重新打开相应攻略补记原文` : '';
      toast(`已导出 ${count.toLocaleString('zh-CN')} 条累计译文${missing}`, 'ok');
    } catch (error) { toast(`CSV 导出失败：${error.message || error}`, 'bad'); }
    finally { button.disabled = false; }
  });
  $('btn-guide-cache-import').addEventListener('click', () => $('guide-cache-file').click());
  $('guide-cache-file').addEventListener('change', async event => {
    pendingBackup = null;
    $('btn-guide-cache-import-confirm').hidden = true;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > CACHE_BACKUP_MAX_BYTES) throw new Error('备份超过 50 MB。');
      pendingBackup = validateCacheBackup(JSON.parse(await file.text()));
      $('guide-cache-import-preview').textContent = `${file.name}：${pendingBackup.records.length.toLocaleString('zh-CN')} 条双语译文、${(pendingBackup.guideCosts?.length ?? 0).toLocaleString('zh-CN')} 条费用记录。导入后合并现有缓存，并恢复匹配参数与术语表；当前 API Key 保留。`;
      $('guide-cache-import-preview').hidden = false;
      $('btn-guide-cache-import-confirm').hidden = false;
    } catch (error) {
      $('guide-cache-import-preview').textContent = `无法导入：${error.message || error}`;
      $('guide-cache-import-preview').hidden = false;
    } finally { event.target.value = ''; }
  });
  $('btn-guide-cache-import-confirm').addEventListener('click', async () => {
    if (!pendingBackup) return;
    const button = $('btn-guide-cache-import-confirm');
    button.disabled = true;
    try {
      window.clearTimeout(autoSaveTimer); autoSaveTimer = 0;
      if (saving) throw new Error('设置正在保存，请稍后重试。');
      const result = await optionsRequest({ type: 'translation-cache', action: 'import', backup: pendingBackup }, true);
      fillForm(result.settings);
      lastSavedSnapshot = JSON.stringify(collectForm());
      setSaveState('已恢复备份中的翻译参数', 'ok');
      pendingBackup = null;
      button.hidden = true;
      $('guide-cache-import-preview').textContent = `已恢复：新增 ${result.imported.added.toLocaleString('zh-CN')} 条译文、${result.importedCosts.added.toLocaleString('zh-CN')} 条费用记录；保留现有译文 ${result.imported.kept.toLocaleString('zh-CN')} 条。刷新攻略页面即可使用。`;
      await refreshGuideCache();
      toast('译文缓存导入完成', 'ok');
    } catch (error) { toast(`导入失败：${error.message || error}`, 'bad'); }
    finally { button.disabled = false; }
  });

  $('btn-save').addEventListener('click', () => save());
  $('btn-test').addEventListener('click', testConnection);
  $('btn-preview').addEventListener('click', preview);

  $('btn-toggle-key').addEventListener('click', () => {
    const input = $('apiKey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('btn-toggle-key').textContent = show ? '隐藏' : '显示';
  });

  for (const btn of document.querySelectorAll('[data-reset]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.reset;
      $(key).value = DEFAULTS[key];
      scheduleAutoSave(); // 程序化赋值不会触发 input 事件，手动排队保存
      toast('已填入默认提示词，正在保存');
    });
  }

  $('btn-reset-all').addEventListener('click', async () => {
    if (!window.confirm('确定恢复全部默认设置？API Key、自定义提示词都会被清空。')) return;
    const s = await resetSettings();
    fillForm(s);
    lastSavedSnapshot = JSON.stringify(collectForm());
    $('preview').hidden = true;
    setSaveState('已恢复默认设置', 'ok');
    toast('已恢复默认设置', 'ok');
  });

  // 快捷键：Ctrl/Cmd + S 保存
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });

  // 改地址后实时刷新授权提示
  $('baseUrl').addEventListener('blur', () => checkPermission($('baseUrl').value.trim()));

  // API 形态 / 地址 / 模型：联动端点提示与告警
  for (const id of ['apiMode', 'baseUrl', 'model']) {
    $(id).addEventListener('change', renderApiModeState);
    $(id).addEventListener('input', renderApiModeState);
  }

  // 术语表 / Tavily
  $('btn-glossary-test').addEventListener('click', runGlossaryTest);
  $('btn-glossary-import').addEventListener('click', () => $('glossary-file').click());
  $('glossary-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const importButton = $('btn-glossary-import');
    const progress = $('glossary-import-progress');
    progress.hidden = false;
    importButton.disabled = true;
    try {
      const compact = await importGlossaryFile(file);
      toast(`已导入 ${compact.entries.length} 条术语（${file.name}）`, 'ok');
    } catch (err) {
      $('glossary-import-status').textContent = `导入失败：${err.message || err}`;
      toast(`导入失败：${err.message || err}`, 'bad');
    } finally {
      importButton.disabled = false;
      event.target.value = '';
    }
  });
  $('btn-tavily-test').addEventListener('click', runTavilyTest);
  $('btn-poe2db-test').addEventListener('click', runPoe2dbTest);
  $('btn-poe2db-clear').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'clear-poe2db-cache' });
    await renderTermState();
    toast('已清空 poe2db 页面缓存', 'ok');
  });
  $('btn-tavily-clear').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'clear-tavily-cache' });
    await renderTermState();
    toast('已清空检索缓存', 'ok');
  });
  $('btn-toggle-tavily').addEventListener('click', () => {
    const input = $('tavilyApiKey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('btn-toggle-tavily').textContent = show ? '隐藏' : '显示';
  });
  for (const id of ['tavilyApiKey', 'tavilyEnabled', 'poe2dbDirectEnabled']) {
    $(id).addEventListener('change', renderTermState);
  }

  // 思考模式：联动强度选择框与温度输入框
  for (const id of ['thinkingMode', 'reasoningEffort']) {
    $(id).addEventListener('change', renderThinkingState);
  }

  // 换 API 形态后，思考模式的参数写法也跟着变
  $('apiMode').addEventListener('change', renderThinkingState);
}

async function optionsRequest(message, guide = false) {
  const res = await chrome.runtime.sendMessage(message);
  if (!res || res.error || (!guide && !res.ok)) throw new Error(res?.error || '扩展后台没有响应，请重新加载扩展。');
  return guide ? res : res.data;
}
async function refreshGuideCache() {
  const res = await optionsRequest({ type: 'translation-settings', action: 'get' }, true);
  $('guide-cache-state').textContent = `已保存 ${res.count.toLocaleString('zh-CN')} 个文字块的简中、繁中译文，无自动过期。`;
}
init().catch(error => toast(`设置加载失败：${error.message}`, 'bad'));
