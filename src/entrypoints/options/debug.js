import { DebugStore, DEBUG_LIMIT } from '../../lib/translation/debug';

/** Read logs directly from the extension origin, keeping full exports off runtime message size limits. */
export function initDebugPanel() {
  const store = new DebugStore();
  const $ = id => document.getElementById(id);
  let records = [];
  const status = { running: '进行中 / 上次未正常结束', success: '成功', error: '失败', cancelled: '已取消' };
  function showSelected() {
    const record = records.find(record => record.id === $('debug-batch').value);
    $('debug-preview').textContent = record ? JSON.stringify(record, null, 2) : '暂无记录。开启 Debug 模式并保存设置，再回到攻略继续翻译。';
  }
  async function refresh() {
    const selected = $('debug-batch').value;
    records = await store.list();
    $('debug-state').textContent = `已保存 ${records.length} 批调试记录，保留最近 ${DEBUG_LIMIT} 批。完整请求与返回请查看下方或导出 JSON。`;
    $('debug-batch').replaceChildren();
    for (const record of [...records].reverse()) {
      const option = document.createElement('option');
      option.value = record.id;
      option.textContent = `${new Date(record.startedAt).toLocaleString('zh-CN')} · 第 ${record.batch}/${record.batches} 批 · ${status[record.status] || record.status} · ${record.id}`;
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
  void safely(refresh)();
}
