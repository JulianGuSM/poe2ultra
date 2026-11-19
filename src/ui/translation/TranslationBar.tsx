import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, TriangleAlert, X } from 'lucide-preact';
import { formatCny } from '@/lib/translation/vendor/pricing.js';
import type { useTranslation } from './useTranslation';
import type { TranslationStage } from '@/lib/translation/activity';

const stages: Record<TranslationStage, string> = {
  checking: '正在检查缓存', queued: '排队中，等待其他页面的当前批次完成', glossary: '正在匹配本地术语',
  context: '正在准备术语上下文（可能包含 poe2db / Tavily 查询）', requesting: '已发送请求，等待 DeepSeek 返回',
  reasoning: 'DeepSeek 正在思考', receiving: '正在接收译文', validating: '正在读取两套译文', saving: '正在写入本地缓存',
};
const duration = (seconds: number) => seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
const format = (value: number) => value.toLocaleString('zh-CN');
const ringLength = 2 * Math.PI * 14;

/** Compact toolbar control; the ring opens translation details and actions. */
export function TranslationBar({ translation: t }: { translation: ReturnType<typeof useTranslation> }) {
  const [open, setOpen] = useState(false);
  const [toastLeaving, setToastLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    };
    const closeOutside = (event: PointerEvent) => {
      if (root.current && !event.composedPath().includes(root.current)) setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape, true);
    document.addEventListener('pointerdown', closeOutside, true);
    return () => {
      document.removeEventListener('keydown', closeOnEscape, true);
      document.removeEventListener('pointerdown', closeOutside, true);
    };
  }, [open]);

  const noticeId = t.retranslationNotice?.id;
  useEffect(() => {
    if (!noticeId) return;
    const exit = window.setTimeout(() => setToastLeaving(true), 4200);
    const dismiss = window.setTimeout(t.dismissRetranslationNotice, 4500);
    setToastLeaving(false);
    return () => { window.clearTimeout(exit); window.clearTimeout(dismiss); };
  }, [noticeId]);

  const complete = t.state.completed === t.state.total;
  const completeProgress = t.state.total > 0 && complete;
  const percent = t.state.total ? Math.min(100, Math.floor(t.state.completed / t.state.total * 1000) / 10) : 0;
  const saved = `${format(t.state.completed)} / ${format(t.state.total)} 个文字块`;
  const status = t.checking ? '正在读取缓存…'
    : t.busy ? `翻译进度 ${percent}% · 已缓存 ${saved}`
    : t.state.total === 0 ? '没有需要翻译的英文内容'
    : complete ? `简中、繁中均已缓存 · ${format(t.state.total)} 个文字块`
    : `已缓存 ${saved} · 待翻译 ${format(t.missingChars)} 字符`;
  const startLabel = (t.state.completed > 0 || t.attempted) && !complete ? '继续翻译剩余内容' : '开始翻译 · 简中 + 繁中';

  return <div ref={root} class={`translation${t.error || t.warning ? ' translation--attention' : ''}${completeProgress ? ' translation--complete' : ''}`}>
    <button type="button" class="translation__ring-button" aria-label="翻译进度与费用" aria-expanded={open}
      aria-controls={open ? 'translation-details' : undefined} title={`${percent}% · 已缓存 ${saved}；点击查看翻译详情`}
      onClick={() => setOpen(!open)}>
      <svg class="translation__ring" viewBox="0 0 36 36" role="progressbar" aria-label="已缓存翻译进度"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% · 已缓存 ${saved}`}>
        <circle class="translation__ring-track" cx="18" cy="18" r="14" />
        <circle class="translation__ring-value" cx="18" cy="18" r="14" transform="rotate(-90 18 18)" stroke-dasharray={ringLength} stroke-dashoffset={ringLength * (1 - percent / 100)} />
        <text x="18" y="18" text-anchor="middle" dominant-baseline="central" aria-hidden="true">{t.checking ? '…' : `${Math.round(percent)}%`}</text>
      </svg>
    </button>
    <div class="translation__languages" role="group" aria-label="Guide language">
      {(['en', 'cn', 'tw'] as const).map((locale, i) => <button key={locale} type="button" aria-pressed={t.locale === locale}
        title={['英文原文', '在英文原文下方显示简体中文翻译，适配国服', '在英文原文下方显示繁体中文翻译，适配国际服'][i]}
        onClick={() => t.choose(locale)}>{['英', '简', '繁'][i]}</button>)}
    </div>
    <button type="button" class="translation__retranslate-toggle" aria-pressed={t.retranslateMode}
      title={t.retranslateMode ? '关闭文字块重译按钮' : '显示文字块重译按钮'} onClick={t.toggleRetranslate}>重译</button>
    {open && <section class="translation__details" id="translation-details" role="dialog" aria-modal="false" aria-label="翻译详情">
      <div class="translation__details-header"><strong>翻译详情</strong><button type="button" class="translation__close" aria-label="关闭翻译详情" title="关闭翻译详情 (Esc)" onClick={() => setOpen(false)}><X size={16} aria-hidden="true" /></button></div>
      <p class="translation__summary">已缓存 <strong>{saved}</strong> · {percent}%</p>
      <p class="translation__cost">{!t.guideCost ? t.checking ? '正在读取费用记录…' : '费用记录暂不可用，请刷新攻略页面重试。'
        : !t.guideCost.requests ? '尚无费用记录；旧版翻译费用无法追溯。'
        : t.guideCost.priced === 0 ? `累计 ${format(t.guideCost.requests)} 次模型响应，均未返回用量，无法估算费用。`
          : `累计费用估算 ≈${formatCny(t.guideCost.cny)} · ${format(t.guideCost.requests)} 次模型响应中 ${format(t.guideCost.priced)} 次返回了用量${t.guideCost.priced < t.guideCost.requests ? '（实际费用可能更高）' : ''}。`}</p>
      <div class="translation__actions">
        {t.busy ? <button type="button" onClick={t.stop}>停止翻译</button> : <button type="button" class="translation__start" disabled={t.checking || complete}
          title="翻译所有构筑阶段并保存两套译文；未缓存内容可能产生 API 费用" onClick={t.translate}>{complete && !t.checking ? '已全部缓存' : startLabel}</button>}
        <button type="button" onClick={t.settings}>翻译设置</button>
      </div>
      <p class="translation__status" aria-live="polite" title="统计所有构筑阶段的去重文字块，包含正文、技能、装备和扩展提示框；不是请求次数或 token 数。">{status}</p>
      {t.busy && t.activity && <div class="translation__activity">
        <p><span class="translation__pulse" aria-hidden="true" />{t.activity.batch ? `第 ${t.activity.batch} / ${t.activity.batches} 批 · ` : ''}{stages[t.activity.stage]}{t.activity.receivedChars ? ` · 已接收 ${format(t.activity.receivedChars)} 字符` : ''}</p>
        <p class="translation__hint">总用时 {duration(t.timing.elapsed)} · 当前阶段 {duration(t.timing.stageElapsed)}{t.retryingKeys.length ? '' : ' · 每批保存后更新百分比'}</p>
      </div>}
      {t.busy && t.retryingKeys.length > 0 && <div class="translation__retranslation-progress" aria-live="polite">
        <div class="translation__retranslation-label">正在重译 {format(t.retryingKeys.length)} 个文字块 · {t.activity ? stages[t.activity.stage] : '正在启动'}</div>
        <div class="translation__retranslation-track" role="progressbar" aria-label="文字块重译进度" aria-valuetext={`${format(t.retryingKeys.length)} 个文字块处理中`}>
          <span />
        </div>
        <p class="translation__hint">完成后会自动更新当前攻略和缓存译文。</p>
      </div>}
      {!t.busy && t.attempted && t.cost && <p class="translation__run-cost">{t.cost.requests === 0
        ? '本次未调用模型，费用估算 ¥0'
        : t.cost.priced === 0 ? '本次模型请求未返回 token 用量，无法估算费用'
          : `本次翻译费用估算 ${t.cost.text} · ${format(t.cost.priced)} / ${format(t.cost.requests)} 次模型请求返回了用量（实际扣费以服务商账单为准）`}</p>}
      {!t.checking && !t.busy && !t.error && t.state.total > 0 && t.state.completed === 0 && <p class="translation__hint">
        还没有中文译文。「简 / 繁」只切换原文下方的已有译文；请点击“开始翻译”生成并缓存两版译文。
      </p>}
      {!t.checking && !t.busy && t.state.completed > 0 && !complete && t.locale !== 'en' && <p class="translation__hint">未翻译的内容暂时显示英文；点击“继续翻译剩余内容”补齐，已缓存部分不会重复翻译。</p>}
      {(t.error || t.warning) && <p class="translation__message" role={t.error ? 'alert' : undefined}>{t.error || t.warning}</p>}
    </section>}
    {t.retranslationNotice && <div class={`translation-toast translation-toast--${t.retranslationNotice.kind}${toastLeaving ? ' translation-toast--leaving' : ''}`} role={t.retranslationNotice.kind === 'error' ? 'alert' : 'status'} aria-live={t.retranslationNotice.kind === 'error' ? 'assertive' : 'polite'}>
      <span class="translation-toast__icon" aria-hidden="true">{t.retranslationNotice.kind === 'success' ? <Check size={15} /> : <TriangleAlert size={15} />}</span>
      <span class="translation-toast__text">{t.retranslationNotice.text}</span>
      <button type="button" class="translation-toast__close" aria-label="关闭通知" onClick={t.dismissRetranslationNotice}><X size={15} aria-hidden="true" /></button>
    </div>}
  </div>;
}
