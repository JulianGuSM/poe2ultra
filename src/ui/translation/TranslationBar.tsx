import type { useTranslation } from './useTranslation';
import type { TranslationStage } from '@/lib/translation/activity';

const stages: Record<TranslationStage, string> = {
  checking: '正在检查缓存', queued: '排队中，等待其他页面的当前批次完成', glossary: '正在匹配本地术语',
  context: '正在准备术语上下文（可能包含 poe2db / Tavily 查询）', requesting: '已发送请求，等待 DeepSeek 返回',
  reasoning: 'DeepSeek 正在思考', receiving: '正在接收译文', validating: '正在读取两套译文', saving: '正在写入本地缓存',
};
const duration = (seconds: number) => seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;

export function TranslationBar({ translation: t }: { translation: ReturnType<typeof useTranslation> }) {
  const complete = t.state.completed === t.state.total;
  const format = (value: number) => value.toLocaleString('zh-CN');
  const percent = t.state.total ? Math.min(100, Math.floor(t.state.completed / t.state.total * 1000) / 10) : 0;
  const saved = `${format(t.state.completed)} / ${format(t.state.total)} 个文字块`;
  const status = t.checking ? '正在读取缓存…'
    : t.busy ? `翻译进度 ${percent}% · 已缓存 ${saved}`
    : t.state.total === 0 ? '没有需要翻译的英文内容'
    : complete ? `简中、繁中均已缓存 · ${format(t.state.total)} 个文字块`
    : `已缓存 ${saved} · 待翻译 ${format(t.missingChars)} 字符`;
  const startLabel = t.state.completed > 0 && !complete ? '继续翻译剩余内容' : '开始翻译 · 简中 + 繁中';
  return <div class="translation">
    <div class="translation__bar">
      <div class="translation__languages" role="group" aria-label="Guide language">
        {(['en', 'cn', 'tw'] as const).map((locale, i) => <button key={locale} type="button" aria-pressed={t.locale === locale} title={locale === 'en' ? '显示英文原文' : '在原文下方显示已缓存译文；首次请点击“开始翻译”'} onClick={() => t.choose(locale)}>{['Original', '简中', '繁中'][i]}</button>)}
      </div>
      {t.busy ? <button type="button" onClick={t.stop}>停止翻译</button> : <button type="button" class="translation__start" disabled={t.checking || complete} title="翻译所有构筑阶段并保存两套译文；未缓存内容可能产生 API 费用" onClick={t.translate}>{complete && !t.checking ? '已全部缓存' : startLabel}</button>}
      <button type="button" onClick={t.settings}>翻译设置</button>
    </div>
    <p class="translation__status" aria-live="polite" title="统计所有构筑阶段的去重文字块，包含正文、技能、装备和扩展提示框；不是请求次数或 token 数。">{status}</p>
    {!t.checking && t.state.total > 0 && (t.busy || t.state.completed > 0 || t.error) && <div class="translation__progress" role="progressbar" aria-label="已缓存翻译进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% · 已缓存 ${saved}`}>
      <span style={{ width: `${percent}%` }} />
    </div>}
    {t.busy && t.activity && <div class="translation__activity">
      <p><span class="translation__pulse" aria-hidden="true" />{t.activity.batch ? `第 ${t.activity.batch} / ${t.activity.batches} 批 · ` : ''}{stages[t.activity.stage]}{t.activity.receivedChars ? ` · 已接收 ${format(t.activity.receivedChars)} 字符` : ''}</p>
      <p class="translation__hint">总用时 {duration(t.timing.elapsed)} · 当前阶段 {duration(t.timing.stageElapsed)} · 每批保存后更新百分比</p>
    </div>}
    {!t.checking && !t.busy && !t.error && t.state.total > 0 && t.state.completed === 0 && <p class="translation__hint">
      还没有中文译文。「简中 / 繁中」只切换原文下方的已有译文；请点击“开始翻译”生成并缓存两版译文。
    </p>}
    {!t.checking && !t.busy && t.state.completed > 0 && !complete && t.locale !== 'en' && <p class="translation__hint">未翻译的内容暂时显示英文；点击“继续翻译剩余内容”补齐，已缓存部分不会重复翻译。</p>}
    {(t.error || t.warning) && <p class="translation__message" role={t.error ? 'alert' : undefined}>{t.error || t.warning}</p>}
  </div>;
}
