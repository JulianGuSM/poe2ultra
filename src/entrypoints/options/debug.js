import { DebugStore, DEBUG_LIMIT } from '../../lib/translation/debug';
import { FetchDiagnosticsStore, FETCH_DIAGNOSTICS_LIMIT } from '../../lib/page/fetch-diagnostics';
import { copyText } from '../../lib/ui/clipboard';

const formatTime = value => new Date(value).toLocaleString('zh-CN');
const shortId = value => {
  const id = String(value || '');
  return id.length > 18 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id;
};

function appendBadge(parent, label, state) {
  const badge = document.createElement('span');
  badge.className = 'debug-status-badge';
  badge.dataset.status = state;
  badge.textContent = label;
  parent.append(badge);
}

function appendTranslationEntry(parent, record) {
  const top = document.createElement('span');
  top.className = 'debug-option-top';
  const time = document.createElement('span');
  time.className = 'debug-option-time';
  time.textContent = formatTime(record.startedAt);
  const batch = document.createElement('span');
  batch.className = 'debug-option-batch';
  batch.textContent = `第 ${record.batch}/${record.batches} 批`;
  const statuses = { running: ['进行中', 'running'], success: ['成功', 'success'], error: ['失败', 'error'], cancelled: ['已取消', ''] };
  const [label, state] = statuses[record.status] || [record.status || '未知', ''];
  top.append(time, batch);
  appendBadge(top, label, state);
  const id = document.createElement('span');
  id.className = 'debug-option-id';
  id.title = record.id;
  id.textContent = record.id ? `批次 ID · ${shortId(record.id)}` : '';
  parent.replaceChildren(top, id);
}

function appendFetchEntry(parent, session) {
  const top = document.createElement('span');
  top.className = 'debug-option-top';
  const time = document.createElement('span');
  time.className = 'debug-option-time';
  time.textContent = formatTime(session.startedAt);
  const last = session.attempts.at(-1);
  const status = last?.status
    ? [`HTTP ${last.status}`, last.status >= 200 && last.status < 300 ? 'success' : 'error']
    : last?.error ? ['失败', 'error'] : ['请求中', 'running'];
  top.append(time);
  appendBadge(top, status[0], status[1]);
  const url = document.createElement('span');
  url.className = 'debug-option-url';
  url.title = session.url;
  url.textContent = session.url || '';
  const id = document.createElement('span');
  id.className = 'debug-option-id';
  id.title = session.id;
  id.textContent = session.id ? `记录 ID · ${shortId(session.id)}` : '';
  parent.replaceChildren(top, url, id);
}

function createPicker(triggerId, optionsId, selectId, appendEntry) {
  const trigger = document.getElementById(triggerId);
  const options = document.getElementById(optionsId);
  const select = document.getElementById(selectId);
  const picker = trigger.closest('.debug-picker');
  const setOpen = open => {
    trigger.setAttribute('aria-expanded', String(open));
    options.hidden = !open;
  };
  trigger.addEventListener('click', () => setOpen(trigger.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('click', event => {
    if (!picker.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      trigger.focus();
    }
  });
  return (items, selectedId) => {
    options.replaceChildren();
    for (const item of items) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'debug-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(item.id === selectedId));
      appendEntry(option, item);
      option.addEventListener('click', () => {
        select.value = item.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        setOpen(false);
        trigger.focus();
      });
      options.append(option);
    }
    trigger.disabled = items.length === 0;
    const current = document.getElementById(triggerId.replace('-trigger', '-current'));
    current.replaceChildren();
    const selected = items.find(item => item.id === selectedId);
    if (selected) appendEntry(current, selected);
    else current.textContent = '暂无记录';
  };
}

function setupAccordion(buttonId, panelId) {
  const button = document.getElementById(buttonId);
  const panel = document.getElementById(panelId);
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-hidden', String(!open));
    panel.inert = !open;
    panel.classList.toggle('is-open', open);
  });
}

/** Read logs directly from the extension origin, keeping full exports off runtime message size limits. */
export function initDebugPanel() {
  const store = new DebugStore();
  const $ = id => document.getElementById(id);
  let records = [];
  setupAccordion('debug-details-toggle', 'debug-details-panel');
  const debugToggle = $('debugEnabled');
  const debugContent = $('translation-debug-content');
  const syncDebugContent = () => { debugContent.hidden = !debugToggle.checked; };
  debugToggle.addEventListener('change', syncDebugContent);
  syncDebugContent();
  const batchPicker = createPicker('debug-batch-trigger', 'debug-batch-options', 'debug-batch', appendTranslationEntry);
  function showSelected() {
    const record = records.find(record => record.id === $('debug-batch').value);
    $('debug-preview').textContent = record ? JSON.stringify(record, null, 2) : '暂无记录。开启 Debug 模式并保存设置，再回到攻略继续翻译。';
    const copyButton = $('btn-debug-copy');
    if (copyButton) copyButton.disabled = !record;
    batchPicker(records.slice().reverse(), record?.id || '');
  }
  async function refresh() {
    const selected = $('debug-batch').value;
    records = await store.list();
    $('debug-state').textContent = `已存 ${records.length} 条记录`;
    $('debug-batch').replaceChildren();
    for (const record of [...records].reverse()) {
      const option = document.createElement('option');
      option.value = record.id;
      option.textContent = `${formatTime(record.startedAt)} · 第 ${record.batch}/${record.batches} 批 · ${record.status} · ${shortId(record.id)}`;
      $('debug-batch').append(option);
    }
    $('debug-batch').value = records.some(record => record.id === selected) ? selected : (records.at(-1)?.id || '');
    $('btn-debug-export').disabled = records.length === 0;
    showSelected();
  }
  const safely = action => async () => {
    try { await action(); } catch (error) { $('debug-state').textContent = `调试日志操作失败：${error.message || error}`; }
  };
  $('debug-batch').addEventListener('change', showSelected);
  $('btn-debug-copy')?.addEventListener('click', safely(async () => {
    const record = records.find(record => record.id === $('debug-batch').value);
    if (!record) return;
    if (!await copyText(JSON.stringify(record, null, 2))) throw new Error('复制失败，请检查浏览器剪贴板权限后重试。');
    $('debug-state').textContent = '已复制所选批次的完整输入、输出与日志。';
  }));
  $('btn-debug-refresh').addEventListener('click', safely(refresh));
  $('btn-debug-export').addEventListener('click', safely(async () => {
    await refresh();
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), retentionBatches: DEBUG_LIMIT, records }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `poe2ultra-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  $('btn-debug-clear').addEventListener('click', safely(async () => {
    if (!window.confirm('确定清空调试日志？已缓存的简中、繁中译文不会被清除。')) return;
    const result = await chrome.runtime.sendMessage({ type: 'translation-debug', action: 'clear' });
    if (!result?.ok) throw new Error(result?.error || '清空失败');
    await refresh();
  }));
  initFetchDiagnosticsPanel();
  void safely(refresh)();
}

function initFetchDiagnosticsPanel() {
  const store = new FetchDiagnosticsStore();
  const $ = id => document.getElementById(id);
  if (!$('fetch-debug-state')) return;
  let sessions = [];
  setupAccordion('fetch-details-toggle', 'fetch-details-panel');
  const expandedToggle = $('fetchDebugExpanded');
  const fetchContent = $('fetch-debug-content');
  const syncFetchContent = () => { fetchContent.hidden = !expandedToggle.checked; };
  expandedToggle.addEventListener('change', syncFetchContent);
  syncFetchContent();
  const sessionPicker = createPicker('fetch-debug-session-trigger', 'fetch-debug-session-options', 'fetch-debug-session', appendFetchEntry);
  const selected = () => sessions.find(session => session.id === $('fetch-debug-session').value);
  const showSelected = () => {
    const session = selected();
    $('fetch-debug-preview').textContent = session ? JSON.stringify(session, null, 2) : '暂无页面请求记录。';
    $('btn-fetch-debug-copy').disabled = !session;
    sessionPicker(sessions.slice().reverse(), session?.id || '');
  };
  async function refresh() {
    const selectedId = $('fetch-debug-session').value;
    sessions = await store.list();
    $('fetch-debug-state').textContent = `已存 ${sessions.length} 条记录`;
    $('fetch-debug-session').replaceChildren();
    for (const session of [...sessions].reverse()) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = `${formatTime(session.startedAt)} · ${session.attempts.at(-1)?.status ? `HTTP ${session.attempts.at(-1).status}` : '请求中'} · ${shortId(session.id)}`;
      $('fetch-debug-session').append(option);
    }
    $('fetch-debug-session').value = sessions.some(session => session.id === selectedId) ? selectedId : sessions.at(-1)?.id || '';
    $('btn-fetch-debug-export').disabled = sessions.length === 0;
    showSelected();
  }
  const safely = action => async () => {
    try { await action(); } catch (error) { $('fetch-debug-state').textContent = `页面请求日志操作失败：${error.message || error}`; }
  };
  $('fetch-debug-session').addEventListener('change', showSelected);
  $('btn-fetch-debug-refresh').addEventListener('click', safely(refresh));
  $('btn-fetch-debug-copy').addEventListener('click', safely(async () => {
    const session = selected();
    if (session && !await copyText(JSON.stringify(session, null, 2))) throw new Error('复制失败，请检查浏览器剪贴板权限后重试。');
    $('fetch-debug-state').textContent = '已复制所选攻略页面请求日志。';
  }));
  $('btn-fetch-debug-export').addEventListener('click', safely(async () => {
    await refresh();
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), retentionSessions: FETCH_DIAGNOSTICS_LIMIT, sessions }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `poe2ultra-page-fetch-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  $('btn-fetch-debug-clear').addEventListener('click', safely(async () => {
    if (!window.confirm('确定清空攻略页面请求日志？')) return;
    await store.clear();
    await refresh();
  }));
  void safely(refresh)();
}
