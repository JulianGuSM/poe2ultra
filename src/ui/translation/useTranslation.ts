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
export function useTranslation(source: Build) {
  const plan = useMemo(() => planTranslation(source), [source]);
  const [locale, setLocale] = useState<Locale>('en');
  const [state, setState] = useState<Progress>({ records: {}, total: plan.segments.length, completed: 0, cached: 0 });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [activity, setActivity] = useState<Activity | null>(null);
  const [cost, setCost] = useState<CostStatus | null>(null);
  const [guideCost, setGuideCost] = useState<GuideCostSummary | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [timing, setTiming] = useState({ elapsed: 0, stageElapsed: 0 });
  const started = useRef(0), stageStarted = useRef(0), stageKey = useRef('');
  const send = useRef<(type: string) => void>(() => {});

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
    setState({ records: {}, total: plan.segments.length, completed: 0, cached: 0 });
    setError(''); setWarning(''); setBusy(false); setChecking(true);
    setActivity(null); setTiming({ elapsed: 0, stageElapsed: 0 }); setCost(null); setGuideCost(null); setAttempted(false);
    const connect = () => {
      if (port) return port;
      const next = browser.runtime.connect({ name: 'poe2ultra-translation' });
      port = next;
      next.onMessage.addListener(message => {
        if (disposed) return;
        if (message.type === 'progress') setState(message);
        if (message.type === 'activity' && running) {
          const key = `${message.batch ?? 0}:${message.stage}`;
          if (key !== stageKey.current) {
            stageStarted.current = Date.now(); stageKey.current = key;
            setTiming(previous => ({ ...previous, stageElapsed: 0 }));
          }
          setActivity(message);
        }
        if (message.type === 'warning') setWarning(message.text);
        if (message.type === 'cost') setCost({ text: message.text, requests: message.requests, priced: message.priced });
        if (message.type === 'guide-cost') setGuideCost(message.summary);
        if (message.type === 'batch-error') setWarning(`第 ${message.batch} / ${message.batches} 批输出无效，正在继续处理后续批次。`);
        if (['done', 'partial', 'error', 'cancelled'].includes(message.type)) {
          setBusy(false); setChecking(false); running = false; inspecting = false;
          if (message.type === 'error') setError(message.text);
          if (message.type === 'partial') setWarning(`本轮有 ${message.failedBatches} 批模型输出未通过检查，后续批次已继续处理。点击“继续翻译剩余内容”重试未缓存内容。\n首个错误：${message.firstError}`);
          if (message.type === 'cancelled') setWarning('已停止翻译。完成的批次已缓存，可以继续翻译剩余内容。');
          if (refreshAfterRun) { refreshAfterRun = false; queueMicrotask(() => { if (!disposed) post('inspect'); }); }
        }
      });
      next.onDisconnect.addListener(() => {
        port = undefined;
        if (disposed) return;
        if (running) setError('翻译连接中断。已完成的译文已保存，请点击开始或继续翻译。');
        setBusy(false); setChecking(false); running = false; inspecting = false;
      });
      return next;
    };
    const post = (type: string) => {
      try {
        if (type === 'translate') {
          if (running) return;
          setError(''); setWarning(''); setCost(null); setAttempted(true); running = true; setBusy(true);
          started.current = stageStarted.current = Date.now(); stageKey.current = '0:checking';
          setActivity({ stage: 'checking' }); setTiming({ elapsed: 0, stageElapsed: 0 });
        }
        if (type === 'inspect') { if (running || inspecting) return; inspecting = true; setChecking(true); }
        connect().postMessage({ type, ...(['inspect', 'translate'].includes(type) ? { segments: plan.segments } : {}) });
      } catch {
        setError('请先在扩展管理页重新加载 poe2ultra，再刷新此攻略页面。'); setBusy(false); setChecking(false); running = false; inspecting = false; port = undefined;
      }
    };
    send.current = post;
    void browser.storage.local.get(LOCALE_KEY).then(saved => {
      const value = saved[LOCALE_KEY];
      if (!disposed && (value === 'en' || value === 'cn' || value === 'tw')) setLocale(value);
    }).catch(() => {});
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
    browser.storage.onChanged.addListener(changed);
    return () => { disposed = true; clearInterval(timer); port?.disconnect(); window.removeEventListener('focus', refresh); browser.storage.onChanged.removeListener(changed); };
  }, [plan]);

  const choose = (next: Locale) => {
    setLocale(next);
    void browser.storage.local.set({ [LOCALE_KEY]: next }).catch(() => {});
  };
  const build = source;
  const missingChars = plan.segments.filter(s => !state.records[segmentKey(s)]).reduce((sum, s) => sum + s.texts.join('').length, 0);
  return { build, locale, choose, state, busy, checking, error, warning, missingChars, activity, timing, cost, guideCost, attempted,
    translate: () => { if (locale === 'en') choose('cn'); send.current('translate'); },
    stop: () => send.current('cancel'), settings: () => send.current('options') };
}
