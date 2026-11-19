// Exercise the actual production worker with a simulated Chrome API and network.
// No network requests or user credentials are used. Run after `npm run build`.
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { GUIDE_SYSTEM_PROMPT } from '../src/lib/translation/guide-prompt.js';

const manifest = JSON.parse(readFileSync('.output/chrome-mv3/manifest.json', 'utf8'));
assert.equal(manifest.name, 'poe2ultra');
assert.equal(manifest.options_ui.open_in_tab, true);
assert.ok(manifest.background.service_worker);
assert.ok(!manifest.content_scripts?.some(entry => entry.js?.some(file => file.includes('selection'))), 'Selection translator must not be statically injected into web pages');
assert.ok(existsSync('.output/chrome-mv3/selection.js'), 'The dynamically registered selection script must be packaged');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const local = {};
const chrome = {
  runtime: { id: 'poe2ultra-test', getURL: path => `chrome-extension://poe2ultra-test/${path.replace(/^\//, '')}`,
    onMessage: event(), onConnect: event(), onInstalled: event(), onStartup: event(), openOptionsPage: async () => {} },
  action: { onClicked: event() },
  contextMenus: { onClicked: event(), removeAll: callback => callback(), remove: (id, callback) => callback?.(), create: () => {} },
  commands: { onCommand: event() },
  permissions: { contains: async () => true, request: async () => true, onAdded: event(), onRemoved: event() },
  tabs: { query: async () => [], sendMessage: async () => {} },
  scripting: { executeScript: async () => {}, getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
  storage: { onChanged: event(), local: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, local[key]])); },
    async set(values) { Object.assign(local, values); },
    async remove(keys) { for (const key of keys) delete local[key]; },
  } },
};
let calls = 0;
let lastRequestBody;
let incompleteResponsesRemaining = 0;
const debugConsole = [];
const fetchMock = async (url, init) => {
  if (url === chrome.runtime.getURL('data/poe2_terms.json')) return new Response(readFileSync('public/data/poe2_terms.json', 'utf8'));
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
  const incomplete = isGuide && incompleteResponsesRemaining > 0;
  if (incomplete) incompleteResponsesRemaining--;
  const content = isGuide ? JSON.stringify({ translations: [{ id: 0, cn: '使用深渊巫妖造成25%伤害。', ...(incomplete ? {} : { tw: '使用深淵妖巫造成25%傷害。' }) }] }) : '【简中】\n深渊巫妖造成25%伤害。\n【繁中】\n深淵妖巫造成25%傷害。';
  const usage = { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 900 };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: ${JSON.stringify({ usage })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
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
async function cacheMessage(action, backup) {
  return new Promise(resolve => chrome.runtime.onMessage.listeners.forEach(listener => listener({ type: 'translation-cache', action, backup },
    { id: chrome.runtime.id, url: chrome.runtime.getURL('/options.html'), tab: { id: 7 } }, resolve)));
}
let lastJobMessages = [];
async function job(type, segments, hostname = 'mobalytics.gg') {
  const messages = [];
  lastJobMessages = messages;
  const port = { name: 'poe2ultra-translation', sender: { id: chrome.runtime.id, url: `https://${hostname}/poe-2/builds/test-guide` },
    onMessage: event(), onDisconnect: event(), disconnect() { throw Error('Valid guide port was rejected'); },
    postMessage(message) { messages.push(message); } };
  chrome.runtime.onConnect.listeners.forEach(listener => listener(port));
  port.onMessage.listeners[0]({ type, segments });
  for (let i = 0; i < 200; i++) {
    const last = messages.at(-1);
    if (last?.type === 'error') throw new Error(last.text);
    if (last?.type === 'done' || last?.type === 'partial') {
      const progress = messages.findLast(m => m.type === 'progress');
      if (last.type === 'done' && type === 'translate' && segments[0]?.kind === 'prose' && !progress.cached) {
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
  for (const message of [{ type: 'translation-settings', action: 'get' }, { type: 'translation-cache', action: 'export' }, { type: 'translation-debug', action: 'clear' }, { type: 'get-settings' }, { type: 'save-settings', patch: { apiKey: 'attacker' } }]) {
    listener(message, { id: chrome.runtime.id, url: 'https://mobalytics.gg/poe-2/builds/test-guide' }, () => { leaked = true; });
  }
}
assert.equal(leaked, false);
const segments = [{ kind: 'prose', texts: ['Use Abyssal Lich for 25% damage.'], protected: [] }];
assert.equal((await job('inspect', segments)).completed, 0);
assert.equal(calls, 0);
assert.equal((await job('translate', segments, 'www.mobalytics.gg')).completed, 1);
assert.equal(calls, 1);
assert.equal(lastJobMessages.findLast(message => message.type === 'cost').requests, 1);
assert.equal(lastJobMessages.findLast(message => message.type === 'cost').priced, 1);
assert.match(lastJobMessages.findLast(message => message.type === 'cost').text, /^≈¥/);
assert.equal(lastJobMessages.findLast(message => message.type === 'guide-cost').summary.requests, 1);
assert.ok(lastJobMessages.findLast(message => message.type === 'guide-cost').summary.cny > 0);
startWorker();
const restored = await job('translate', segments);
assert.equal(restored.completed, 1);
assert.equal(restored.cached, 1);
assert.equal(calls, 1);
assert.equal(lastJobMessages.findLast(message => message.type === 'cost').requests, 0);
assert.equal(lastJobMessages.findLast(message => message.type === 'guide-cost').summary.requests, 1, 'Expense history must survive worker restart');
assert.equal(Object.values(restored.records)[0].tw[0], '使用深淵妖巫造成25%傷害。');
const firstCsv = await cacheMessage('export-csv');
assert.equal(firstCsv.count, 1);
assert.ok(firstCsv.csv.startsWith('\uFEFF英语原文,简中,繁中\r\n'));
assert.ok(firstCsv.csv.includes('Use Abyssal Lich for 25% damage.,使用深渊巫妖造成25%伤害。,使用深淵妖巫造成25%傷害。'));
const exported = (await cacheMessage('export')).backup;
assert.equal(exported.records.length, 1);
assert.equal(exported.records[0][1].source, 'Use Abyssal Lich for 25% damage.');
assert.equal(exported.guideCosts.length, 1);
assert.ok(!JSON.stringify(exported).includes('test-placeholder'));
assert.equal((await settingsMessage({ action: 'clear' })).count, 0);
await job('inspect', segments);
assert.equal(lastJobMessages.findLast(message => message.type === 'guide-cost').summary.requests, 1, 'Clearing translations keeps expense history');
assert.equal((await cacheMessage('import', { ...exported, schemaVersion: 99 })).error.includes('受支持'), true);
await settingsMessage({ action: 'save', settings: { ...saved.settings, model: 'temporary-other-model' } });
assert.equal((await job('inspect', segments)).cached, 0);
const restoredBackup = await cacheMessage('import', exported);
assert.equal(restoredBackup.imported.added, 1);
assert.equal(restoredBackup.importedCosts.added, 0, 'Importing the same receipt must not add cost again');
assert.equal(restoredBackup.importedCosts.kept, 1);
assert.equal((await settingsMessage({ action: 'get' })).settings.model, exported.settings.model);
const imported = await job('translate', segments);
assert.equal(imported.cached, 1);
assert.equal(calls, 1, 'Imported translations must be reused without another paid request');
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
const combinedCsv = await cacheMessage('export-csv');
assert.equal(combinedCsv.count, 3);
assert.ok(combinedCsv.csv.includes('Abyssal Lich grants 25% damage.,深渊巫妖造成25%伤害。,深淵妖巫造成25%傷害。'));
assert.ok(!combinedCsv.csv.includes('test-placeholder'));
assert.ok(!manifest.content_scripts?.some(entry => entry.js?.includes('selection.js')));
assert.equal(manifest.commands['translate-selection'].suggested_key.default, 'Alt+Q');
await settingsMessage({ action: 'save', settings: { ...saved.settings, debugEnabled: true,
  systemPrompt: 'SELECTION ONLY SYSTEM', userPrompt: 'SELECTION ONLY USER {{text}}' } });
await job('translate', segments);
assert.equal(calls, 2, 'Enabling debug or editing selection prompts must not invalidate paid guide caches');
const malformed = [{ kind: 'prose', texts: ['Use Abyssal Lich for 25% damage.', 'Stay safe.'], protected: [] }];
incompleteResponsesRemaining = 1;
assert.equal((await job('translate', malformed)).completed, 0);
assert.equal(lastJobMessages.at(-1).type, 'partial');
assert.match(lastJobMessages.at(-1).firstError, /未返回有效译文[\s\S]*繁中[\s\S]*调试记录/);
assert.equal(calls, 3, 'Failed validation must not trigger an automatic retry');
assert.equal(lastJobMessages.findLast(message => message.type === 'guide-cost').summary.requests, 2, 'Malformed paid output must be recorded');
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
await settingsMessage({ action: 'save', settings: { ...saved.settings, debugEnabled: false } });
const longSegments = ['A', 'B'].map(letter => ({ kind: 'prose', texts: [`Use Abyssal Lich for 25% damage. ${letter.repeat(3350)}`], protected: [] }));
incompleteResponsesRemaining = 1;
const partial = await job('translate', longSegments);
assert.equal(partial.completed, 1, 'The later batch must complete when the first response is malformed and Debug is off');
assert.equal(lastJobMessages.at(-1).type, 'partial');
assert.equal(lastJobMessages.findLast(message => message.type === 'cost').requests, 2);
assert.equal(lastJobMessages.findLast(message => message.type === 'cost').priced, 2);
const retried = await job('translate', longSegments);
assert.equal(retried.completed, 2, 'Retry must fill only the failed batch');
assert.equal(retried.cached, 1);
assert.equal(lastJobMessages.findLast(message => message.type === 'cost').requests, 1);
console.log('Production bundle passed: guide and selection translation, cumulative CSV, durable per-guide cost receipts and backup, Debug-independent batch failure recovery, persistent cache, debug diagnostics and credential redaction.');
