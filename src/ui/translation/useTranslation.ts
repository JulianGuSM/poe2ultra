import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { Build } from '@/lib/build/model';
import { planTranslation, segmentKey, type Locale, type Records } from '@/lib/translation/plan';
import type { Progress } from '@/lib/translation/engine';
import { SETTINGS_KEY } from '@/lib/translation/settings';
import type { Activity } from '@/lib/translation/activity';
import type { GuideCostSummary } from '@/lib/translation/cache';

const LOCALE_KEY = 'poe2ultra.translation.locale';
interface CostStatus { text: string; requests: number; priced: number }
export interface RetranslationNotice { id: number; kind: 'success' | 'warning' | 'error'; text: string }
export function useTranslation(source: Build) {
  const plan = useMemo(() => planTranslation(source), [source]);
  const [locale, setLocale] = useState<Locale>('en');
  const [state, setState] = useState<Progress>({ records: {}, total: plan.segments.length, completed: 0, cached: 0 });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [initialCacheRead, setInitialCacheRead] = useState(true);
  const [cacheReadProgress, setCacheReadProgress] = useState({ checked: 0, total: plan.segments.length });
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [cost, setCost] = useState<CostStatus | null>(null);
  const [guideCost, setGuideCost] = useState<GuideCostSummary | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [retryingKeys, setRetryingKeys] = useState<string[]>([]);
  const [retranslationNotice, setRetranslationNotice] = useState<RetranslationNotice | null>(null);
  const [retranslateMode, setRetranslateMode] = useState(false);
  const [timing, setTiming] = useState({ elapsed: 0, stageElapsed: 0 });
  const started = useRef(0), stageStarted = useRef(0), stageKey = useRef('');
  const retranslation = useRef({ active: false, count: 0 });
  const send = useRef<(type: string, keys?: string | string[]) => void>(() => {});

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setTiming({ elapsed: Math.floor((Date.now() - started.current) / 1000), stageElapsed: Math.floor((Date.now() - stageStarted.current) / 1000) }), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    let disposed = false;
    let port: ReturnType<typeof browser.runtime.connect> | undefined;
    let running = false;
    let inspecting = false;
    let refreshAfterRun = false;
    let queuedRetranslation: string[] | null = null;
    setInitialCacheRead(true);
    setState({ records: {}, total: plan.segments.length, completed: 0, cached: 0 });
    setCacheReadProgress({ checked: 0, total: plan.segments.length });
    setError(''); setWarning(''); setBusy(false); setChecking(true); setRetranslationNotice(null); retranslation.current = { active: false, count: 0 };
    setActivity(null); setTiming({ elapsed: 0, stageElapsed: 0 }); setCost(null); setGuideCost(null); setAttempted(false); setRetryingKeys([]); setRetranslateMode(false);
    const connect = () => {
      if (port) return port;
      const next = browser.runtime.connect({ name: 'poe2ultra-translation' });
      port = next;
      next.onMessage.addListener(message => {
        if (disposed) return;
        if (message.type === 'progress') {
          setState(message);
          if (inspecting) setInitialCacheRead(false);
        }
        if (message.type === 'inspect-progress') setCacheReadProgress({ checked: message.checked, total: message.total });
        if (message.type === 'activity' && running) {
          const key = `${message.batch ?? 0}:${message.stage}`;
          if (key !== stageKey.current) {
            stageStarted.current = Date.now(); stageKey.current = key;
            setTiming(previous => ({ ...previous, stageElapsed: 0 }));
          }
          setActivity(message);
        }
        if (message.type === 'warning' && !retranslation.current.active) setWarning(message.text);
        if (message.type === 'cost' && !retranslation.current.active) setCost({ text: message.text, requests: message.requests, priced: message.priced });
        if (message.type === 'guide-cost') setGuideCost(message.summary);
        if (message.type === 'batch-error' && !retranslation.current.active) setWarning(`第 ${message.batch} / ${message.batches} 批输出无效，正在继续处理后续批次。`);
        if (['done', 'partial', 'error', 'cancelled'].includes(message.type)) {
          if (inspecting) setInitialCacheRead(false);
          if (message.type === 'done' && inspecting && queuedRetranslation) {
            inspecting = false; setChecking(false);
            const keys = queuedRetranslation;
            queuedRetranslation = null;
            queueMicrotask(() => { if (!disposed) post('retranslate', keys); });
            return;
          }
          setBusy(false); setChecking(false); running = false; inspecting = false;
          setRetryingKeys([]);
          queuedRetranslation = null;
          if (retranslation.current.active) {
            const count = retranslation.current.count;
            const notice: RetranslationNotice = message.type === 'done'
              ? { id: Date.now(), kind: 'success', text: `已重译 ${count.toLocaleString('zh-CN')} 个文字块` }
              : message.type === 'partial'
                ? { id: Date.now(), kind: 'warning', text: `重译部分完成：${message.failedBatches} 批未成功。${message.firstError ?? ''}` }
                : message.type === 'cancelled'
                  ? { id: Date.now(), kind: 'warning', text: '已停止重译，已完成的文字块已保存。' }
                  : { id: Date.now(), kind: 'error', text: `重译失败：${message.text ?? '请稍后重试。'}` };
            setRetranslationNotice(notice);
            retranslation.current = { active: false, count: 0 };
          } else {
            if (message.type === 'error') setError(message.text);
            if (message.type === 'partial') setWarning(`本轮有 ${message.failedBatches} 批模型输出未通过检查，后续批次已继续处理。点击“继续翻译剩余内容”重试未缓存内容。\n首个错误：${message.firstError}`);
            if (message.type === 'cancelled') setWarning('已停止翻译。完成的批次已缓存，可以继续翻译剩余内容。');
          }
          if (refreshAfterRun) { refreshAfterRun = false; queueMicrotask(() => { if (!disposed) post('inspect'); }); }
        }
      });
      next.onDisconnect.addListener(() => {
        port = undefined;
        if (disposed) return;
        if ((running || inspecting) && retranslation.current.active) {
          setRetranslationNotice({ id: Date.now(), kind: 'error', text: '重译连接中断。已完成的文字块已保存。' });
          retranslation.current = { active: false, count: 0 };
        } else if (running) setError('翻译连接中断。已完成的译文已保存，请点击开始或继续翻译。');
        if (inspecting) setInitialCacheRead(false);
        setBusy(false); setChecking(false); running = false; inspecting = false; queuedRetranslation = null; setRetryingKeys([]);
      });
      return next;
    };
    const post = (type: string, keys?: string | string[]) => {
      try {
        const requestedKeys = type === 'retranslate' ? (Array.isArray(keys) ? keys : keys ? [keys] : []) : [];
        const requestedSegments = type === 'retranslate' ? requestedKeys.map(key => plan.segments.find(segment => segmentKey(segment) === key)) : [];
        if (type === 'retranslate' && (!requestedSegments.length || requestedSegments.some(segment => !segment))) throw new Error('找不到要重译的文字块，请刷新攻略页面后重试。');
        if (type === 'retranslate' && inspecting) {
          queuedRetranslation = requestedKeys;
          retranslation.current = { active: true, count: requestedKeys.length };
          setError(''); setWarning(''); setCost(null); setAttempted(true); setBusy(true); setRetryingKeys(requestedKeys);
          started.current = stageStarted.current = Date.now(); stageKey.current = '0:checking';
          setActivity({ stage: 'checking' }); setTiming({ elapsed: 0, stageElapsed: 0 });
          return;
        }
        if (type === 'translate' || type === 'retranslate') {
          if (running) return;
          if (type === 'retranslate') retranslation.current = { active: true, count: requestedKeys.length };
          setError(''); setWarning(''); setCost(null); setAttempted(true); running = true; setBusy(true);
          if (type === 'retranslate') setRetryingKeys(requestedKeys);
          started.current = stageStarted.current = Date.now(); stageKey.current = '0:checking';
          setActivity({ stage: 'checking' }); setTiming({ elapsed: 0, stageElapsed: 0 });
        }
        if (type === 'inspect') { if (running || inspecting) return; inspecting = true; setChecking(true); }
        connect().postMessage({ type, ...(['inspect', 'translate', 'retranslate'].includes(type) ? { segments: plan.segments } : {}), ...(requestedSegments.length ? { retranslationSegments: requestedSegments } : {}) });
      } catch {
        if (type === 'retranslate') {
          setRetranslationNotice({ id: Date.now(), kind: 'error', text: '无法启动重译。请重新加载扩展并刷新攻略页面后重试。' });
          retranslation.current = { active: false, count: 0 };
        } else setError('无法启动文字块重译。请重新加载扩展并刷新攻略页面后重试。');
        setBusy(false); setChecking(false); running = false; inspecting = false; queuedRetranslation = null; setRetryingKeys([]); port = undefined;
      }
    };
    send.current = post;
    try {
      void browser.storage.local.get(LOCALE_KEY).then(saved => {
        const value = saved[LOCALE_KEY];
        if (!disposed && (value === 'en' || value === 'cn' || value === 'tw')) setLocale(value);
      }).catch(() => {});
    } catch {
      // A tab can outlive an extension reload; keep the default locale in its invalidated context.
    }
    post('inspect');
    const timer = setInterval(() => { if (running || inspecting) post('ping'); }, 20000);
    const refresh = () => post('inspect');
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && [SETTINGS_KEY, 'glossaryOverride', 'poe2ultra.translation.cache-revision'].some(key => key in changes)) {
        if (running || inspecting) refreshAfterRun = true;
        else refresh();
      }
    };
    window.addEventListener('focus', refresh);
    let storageListenerAdded = false;
    try {
      browser.storage.onChanged.addListener(changed);
      storageListenerAdded = true;
    } catch {
      // The content script can still render cached build data after the extension context is invalidated.
    }
    return () => {
      disposed = true;
      clearInterval(timer);
      try { port?.disconnect(); } catch { /* The runtime may already be gone. */ }
      window.removeEventListener('focus', refresh);
      if (storageListenerAdded) {
        try { browser.storage.onChanged.removeListener(changed); } catch { /* The runtime may already be gone. */ }
      }
    };
  }, [plan]);

  const choose = (next: Locale) => {
    setLocale(next);
    try { void browser.storage.local.set({ [LOCALE_KEY]: next }).catch(() => {}); } catch { /* Extension reload; keep this choice for the current render. */ }
  };
  const build = source;
  const missingChars = plan.segments.filter(s => !state.records[segmentKey(s)]).reduce((sum, s) => sum + s.texts.join('').length, 0);
  return { build, plan, locale, choose, state, busy, checking, initialCacheRead, cacheReadProgress, error, warning, missingChars, activity, timing, cost, guideCost, attempted, retryingKeys, retranslationNotice, dismissRetranslationNotice: () => setRetranslationNotice(null), retranslateMode,
    translate: () => { if (locale === 'en') choose('cn'); send.current('translate'); },
    retranslate: (keys: string[]) => send.current('retranslate', keys),
    toggleRetranslate: () => setRetranslateMode(value => !value),
    stop: () => send.current('cancel'), settings: () => send.current('options') };
}
