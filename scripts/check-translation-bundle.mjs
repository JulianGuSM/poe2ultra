// Exercise the actual production worker with a simulated Chrome API and network.
// No network requests or user credentials are used. Run after `npm run build`.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { GUIDE_SYSTEM_PROMPT } from '../src/lib/translation/guide-prompt.js';

const manifest = JSON.parse(readFileSync('.output/chrome-mv3/manifest.json', 'utf8'));
assert.equal(manifest.name, 'poe2ultra');
assert.equal(manifest.options_ui.open_in_tab, true);
assert.ok(manifest.background.service_worker);
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const local = {};
const chrome = {
  runtime: { id: 'poe2ultra-test', getURL: path => `chrome-extension://poe2ultra-test/${path.replace(/^\//, '')}`,
    onMessage: event(), onConnect: event(), onInstalled: event(), openOptionsPage: async () => {} },
  action: { onClicked: event() },
  contextMenus: { onClicked: event(), removeAll: callback => callback(), create: () => {} },
  commands: { onCommand: event() },
  permissions: { contains: async () => true, request: async () => true },
  tabs: { query: async () => [], sendMessage: async () => {} },
  scripting: { executeScript: async () => {} },
  storage: { onChanged: event(), local: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, local[key]])); },
    async set(values) { Object.assign(local, values); },
    async remove(keys) { for (const key of keys) delete local[key]; },
  } },
};
let calls = 0;
let lastRequestBody;
let incompleteResponse = false;
const debugConsole = [];
const fetchMock = async (url, init) => {
  if (url === chrome.runtime.getURL('data/glossary.json')) return new Response(readFileSync('public/data/glossary.json', 'utf8'));
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.equal(init.headers.Authorization, 'Bearer test-placeholder');
  const body = JSON.parse(init.body);
  lastRequestBody = body;
  assert.ok(body.messages.at(-1).content.includes('深渊巫妖'));
  assert.ok(body.messages.at(-1).content.includes('深淵妖巫'));
  const isGuide = !!body.response_format;
  if (isGuide) {
    assert.equal(body.messages[0].content, GUIDE_SYSTEM_PROMPT);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.ok(!body.messages.at(-1).content.includes('⟦N'));
    assert.ok(body.messages.at(-1).content.includes('25%'));
  }
  calls++;
  const content = isGuide ? JSON.stringify({ translations: [{ id: 0, cn: '使用深渊巫妖造成25%伤害。', ...(incompleteResponse ? {} : { tw: '使用深淵妖巫造成25%傷害。' }) }] }) : '【简中】\n深渊巫妖造成25%伤害。\n【繁中】\n深淵妖巫造成25%傷害。';
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
};
function startWorker() {
  chrome.runtime.onMessage = event(); chrome.runtime.onConnect = event();
  runInNewContext(readFileSync('.output/chrome-mv3/background.js', 'utf8'), {
    chrome, indexedDB, crypto: webcrypto, fetch: fetchMock, URL, Response, TextEncoder, TextDecoder,
    AbortController, TransformStream, setTimeout, clearTimeout,
    console: { ...console, info: (...args) => { if (args[0] === '[poe2ultra debug]') debugConsole.push(args); else console.info(...args); } },
  });
}
async function settingsMessage(message) {
  return new Promise(resolve => chrome.runtime.onMessage.listeners.forEach(listener => listener({ type: 'translation-settings', ...message },
    { id: chrome.runtime.id, url: chrome.runtime.getURL('/options.html'), tab: { id: 7 } }, resolve)));
}
async function job(type, segments, hostname = 'mobalytics.gg') {
  const messages = [];
  const port = { name: 'poe2ultra-translation', sender: { id: chrome.runtime.id, url: `https://${hostname}/poe-2/builds/test-guide` },
    onMessage: event(), onDisconnect: event(), disconnect() { throw Error('Valid guide port was rejected'); },
    postMessage(message) { messages.push(message); } };
  chrome.runtime.onConnect.listeners.forEach(listener => listener(port));
  port.onMessage.listeners[0]({ type, segments });
  for (let i = 0; i < 200; i++) {
    const last = messages.at(-1);
    if (last?.type === 'error') throw new Error(last.text);
    if (last?.type === 'done') {
      const progress = messages.findLast(m => m.type === 'progress');
      if (type === 'translate' && segments[0]?.kind === 'prose' && !progress.cached) {
        const stages = messages.filter(m => m.type === 'activity').map(m => m.stage);
        for (const stage of ['context', 'requesting', 'receiving', 'validating', 'saving']) assert.ok(stages.includes(stage), `Missing live activity: ${stage}`);
      }
      return progress;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Worker job did not complete');
}
startWorker();
const original = await settingsMessage({ action: 'get' });
assert.equal(original.settings.apiKey, '');
const saved = await settingsMessage({ action: 'save', settings: { ...original.settings, apiKey: 'test-placeholder', apiMode: 'chat', poe2dbDirectEnabled: false } });
assert.equal(saved.settings.apiMode, 'chat');
let leaked = false;
for (const listener of chrome.runtime.onMessage.listeners) {
  for (const message of [{ type: 'translation-settings', action: 'get' }, { type: 'translation-debug', action: 'clear' }, { type: 'get-settings' }, { type: 'save-settings', patch: { apiKey: 'attacker' } }]) {
    listener(message, { id: chrome.runtime.id, url: 'https://mobalytics.gg/poe-2/builds/test-guide' }, () => { leaked = true; });
  }
}
assert.equal(leaked, false);
const segments = [{ kind: 'prose', texts: ['Use Abyssal Lich for 25% damage.'], protected: [] }];
assert.equal((await job('inspect', segments)).completed, 0);
assert.equal(calls, 0);
assert.equal((await job('translate', segments, 'www.mobalytics.gg')).completed, 1);
assert.equal(calls, 1);
startWorker();
const restored = await job('translate', segments);
assert.equal(restored.completed, 1);
assert.equal(restored.cached, 1);
assert.equal(calls, 1);
assert.equal(Object.values(restored.records)[0].tw[0], '使用深淵妖巫造成25%傷害。');
const termOnly = [{ kind: 'term', texts: ['Abyssal Lich'], protected: [] }];
assert.equal((await job('translate', termOnly)).completed, 1);
assert.equal(calls, 1);
const uiSettings = await new Promise(resolve => chrome.runtime.onMessage.listeners.forEach(listener => listener({ type: 'get-selection-settings' }, { id: chrome.runtime.id, url: 'https://example.com/' }, resolve)));
assert.equal(uiSettings.ok, true);
assert.equal(uiSettings.data.showButton, true);
assert.ok(!JSON.stringify(uiSettings).includes('test-placeholder'));
const selectionMessages = [];
const selectionPort = { name: 'poe2ultra-selection', sender: { id: chrome.runtime.id, url: 'https://example.com/' },
  onMessage: event(), onDisconnect: event(), disconnect() { throw Error('Selection port rejected'); }, postMessage(message) { selectionMessages.push(message); } };
chrome.runtime.onConnect.listeners.forEach(listener => listener(selectionPort));
selectionPort.onMessage.listeners[0]({ type: 'start', requestId: 'test-selection', text: 'Abyssal Lich grants 25% damage.', title: 'Test', url: 'https://example.com/', pageLang: 'en' });
for (let i = 0; i < 200 && !['done', 'error'].includes(selectionMessages.at(-1)?.type); i++) await new Promise(resolve => setTimeout(resolve, 5));
const selected = selectionMessages.at(-1);
assert.equal(selected.type, 'done', JSON.stringify(selected));
assert.equal(selected.dual.cn, '深渊巫妖造成25%伤害。');
assert.equal(selected.dual.tw, '深淵妖巫造成25%傷害。');
assert.ok(selectionMessages.some(m => m.type === 'chunk'));
assert.equal(calls, 2);
assert.ok(manifest.content_scripts.some(entry => entry.matches.includes('https://*/*') && entry.js.includes('content-scripts/selection.js')));
assert.equal(manifest.commands['translate-selection'].suggested_key.default, 'Alt+Q');
await settingsMessage({ action: 'save', settings: { ...saved.settings, debugEnabled: true,
  systemPrompt: 'SELECTION ONLY SYSTEM', userPrompt: 'SELECTION ONLY USER {{text}}' } });
await job('translate', segments);
assert.equal(calls, 2, 'Enabling debug or editing selection prompts must not invalidate paid guide caches');
const malformed = [{ kind: 'prose', texts: ['Use Abyssal Lich for 25% damage.', 'Stay safe.'], protected: [] }];
incompleteResponse = true;
await assert.rejects(job('translate', malformed), /未返回有效译文[\s\S]*繁中[\s\S]*调试记录/);
assert.equal(calls, 3, 'Failed validation must not trigger an automatic retry');
async function readDebug() {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('poe2ultra-translation-debug', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  return new Promise((resolve, reject) => { const tx = db.transaction('batches'); const r = tx.objectStore('batches').getAll(); tx.oncomplete = () => { resolve(r.result); db.close(); }; tx.onabort = () => reject(tx.error); });
}
startWorker();
const traces = await readDebug();
assert.equal(traces.length, 1);
assert.equal(traces[0].status, 'error');
assert.deepEqual(traces[0].data.request.body, lastRequestBody);
assert.equal(traces[0].data.http.status, 200);
assert.ok(traces[0].stream.http.includes('data: [DONE]'));
assert.equal(traces[0].error.details.code, 'block_translation');
assert.equal(traces[0].error.details.locale, 'tw');
assert.ok(!JSON.stringify(traces).includes('test-placeholder'));
assert.ok(!JSON.stringify(debugConsole).includes('test-placeholder'));
assert.equal((await job('inspect', malformed)).completed, 0);
console.log('Production bundle passed: guide and selection translation, persistent cache, whole-block translation and missing-output diagnostics, full debug request/HTTP/model output, failure diagnostics, credential redaction, worker restart and debug cache compatibility.');
