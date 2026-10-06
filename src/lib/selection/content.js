import { selectedRange } from './selection';
/**
 * 内容脚本：划词 → 浮标 → 翻译面板。
 * 说明：这是普通脚本（非 ES Module），只读取自己需要的几个配置键，
 *       真正带 API Key 的请求一律交给 background 处理。
 */
export function startSelection() {
  if (window.__poe2UltraSelectionLoaded) return;
  window.__poe2UltraSelectionLoaded = true;
  if (window.top !== window.self) return;

  /* ------------------------------------------------------------ 配置 */

  const LOCAL_DEFAULTS = {
    autoTranslate: false,
    showButton: true,
    keepSource: true,
    autoClosePanel: false,
    theme: 'auto',
    panelWidth: 400,
    maxChars: 8000,
    targetLang: '简体中文',
    dualOutput: true,
  };

  let settings = { ...LOCAL_DEFAULTS };

  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get-selection-settings' });
      const stored = response?.ok ? response.data : {};
      settings = { ...LOCAL_DEFAULTS, ...stored };
    } catch {
      /* 用默认值兜底 */
    }
    renderTheme();
    renderWidth();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('poe2ultra.translation.settings' in changes)) return;
    void loadSettings().then(() => { if (!settings.showButton && !settings.autoTranslate) hideButton(); });
  });

  function resolvedTheme() {
    if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /* ------------------------------------------------------------ 样式 */

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer {
      position: fixed; inset: 0; z-index: 2147483647;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 14px; line-height: 1.65;
      --ds-bg: #ffffff; --ds-fg: #1f2430; --ds-sub: #6b7280; --ds-line: #e5e7eb;
      --ds-soft: #f5f6fa; --ds-accent: #4d6bfe; --ds-accent-fg: #ffffff;
      --ds-danger: #d93025; --ds-shadow: 0 12px 32px rgba(17, 24, 39, .18);
    }
    .layer[data-theme="dark"] {
      --ds-bg: #1c1f27; --ds-fg: #e8eaf0; --ds-sub: #9aa3b2; --ds-line: #333846;
      --ds-soft: #242833; --ds-accent: #7d92ff; --ds-accent-fg: #14161c;
      --ds-danger: #ff6b6b; --ds-shadow: 0 12px 32px rgba(0, 0, 0, .5);
    }

    .fab {
      position: fixed; pointer-events: auto; display: none;
      width: 30px; height: 30px; padding: 0; border: 0; border-radius: 9px;
      background: linear-gradient(160deg, #4d6bfe, #2a3fbb);
      color: #fff; cursor: pointer; box-shadow: 0 4px 14px rgba(45, 65, 180, .45);
      align-items: center; justify-content: center;
      transition: transform .12s ease;
    }
    .fab.show { display: inline-flex; }
    .fab:hover { transform: translateY(-1px) scale(1.06); }
    .fab svg { width: 19px; height: 19px; display: block; }

    .panel {
      position: fixed; pointer-events: auto; display: none;
      width: 400px; max-height: 72vh;
      background: var(--ds-bg); color: var(--ds-fg);
      border: 1px solid var(--ds-line); border-radius: 14px;
      box-shadow: var(--ds-shadow); overflow: hidden;
      flex-direction: column;
    }
    .panel.show { display: flex; }

    .hd {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 10px 9px 12px; cursor: grab;
      background: var(--ds-soft); border-bottom: 1px solid var(--ds-line);
      user-select: none;
    }
    .hd.dragging { cursor: grabbing; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ds-accent); flex: 0 0 auto; }
    .brand { font-weight: 600; font-size: 13px; letter-spacing: .2px; }
    .meta { color: var(--ds-sub); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .spacer { flex: 1 1 auto; }

    .icon-btn {
      border: 0; background: transparent; color: var(--ds-sub); cursor: pointer;
      width: 24px; height: 24px; border-radius: 7px; font-size: 15px; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
    }
    .icon-btn:hover { background: var(--ds-line); color: var(--ds-fg); }

    .body { padding: 12px; overflow: auto; overscroll-behavior: contain; }
    .body::-webkit-scrollbar { width: 8px; }
    .body::-webkit-scrollbar-thumb { background: var(--ds-line); border-radius: 4px; }

    details.src { margin: 0 0 10px; border: 1px dashed var(--ds-line); border-radius: 9px; padding: 6px 9px; }
    details.src summary { cursor: pointer; color: var(--ds-sub); font-size: 12px; }
    .src-text {
      margin-top: 6px; white-space: pre-wrap; word-break: break-word;
      color: var(--ds-sub); font-size: 13px; max-height: 140px; overflow: auto;
    }

    details.sources { margin: 10px 0 0; border: 1px dashed var(--ds-line); border-radius: 9px; padding: 6px 9px; }
    details.sources summary { cursor: pointer; color: var(--ds-sub); font-size: 12px; }
    .source-list { margin: 6px 0 0; padding-left: 20px; }
    .source-list li { margin: 3px 0; font-size: 12.5px; line-height: 1.5; }
    .source-list a { color: var(--ds-accent); text-decoration: none; word-break: break-all; }
    .source-list a:hover { text-decoration: underline; }

    details.terms { margin: 10px 0 0; border: 1px dashed var(--ds-line); border-radius: 9px; padding: 6px 9px; }
    details.terms summary { cursor: pointer; color: var(--ds-sub); font-size: 12px; }
    .term-list { margin: 6px 0 0; padding-left: 18px; }
    .term-list li { margin: 3px 0; font-size: 12.5px; line-height: 1.5; word-break: break-word; }
    .term-list .en { color: var(--ds-sub); }
    .term-list .zh { color: var(--ds-fg); font-weight: 600; }
    .term-list .zh.missing { color: var(--ds-sub); font-weight: 400; }
    .term-list .sep { color: var(--ds-sub); }
    .term-list .cat { color: var(--ds-sub); font-size: 11.5px; }
    .term-list a { color: var(--ds-accent); text-decoration: none; font-size: 11.5px; }
    .term-list a:hover { text-decoration: underline; }

    details.direct { margin: 10px 0 0; border: 1px dashed var(--ds-line); border-radius: 9px; padding: 6px 9px; }
    details.direct summary { cursor: pointer; color: var(--ds-sub); font-size: 12px; }
    .direct-list { margin: 6px 0 0; padding-left: 18px; }
    .direct-list li { margin: 3px 0; font-size: 12.5px; line-height: 1.5; word-break: break-word; }
    .direct-list .term { color: var(--ds-sub); }
    .direct-list .name { color: var(--ds-fg); font-weight: 600; }
    .direct-list .loc { color: var(--ds-sub); font-size: 11.5px; }
    .direct-list a { color: var(--ds-accent); text-decoration: none; font-size: 11.5px; }
    .direct-list a.page-link { margin-left: 7px; }
    .direct-list a:hover { text-decoration: underline; }

    .warn-line { margin: 10px 0 0; color: var(--ds-danger); font-size: 12px; white-space: pre-wrap; }

    .glossary-state {
      margin: 8px 0 0; color: var(--ds-sub); font-size: 11.5px; line-height: 1.45;
      border-left: 2px solid var(--ds-line); padding-left: 8px;
    }
    .glossary-state.bad { color: var(--ds-danger); border-left-color: var(--ds-danger); }
    .glossary-state.hit { border-left-color: var(--ds-accent); }

    details.prompt { margin: 10px 0 0; border: 1px dashed var(--ds-line); border-radius: 9px; padding: 6px 9px; }
    details.prompt summary { cursor: pointer; color: var(--ds-sub); font-size: 12px; }
    .prompt-actions { display: flex; justify-content: flex-end; margin: 6px 0 2px; }
    .prompt-label {
      margin: 8px 0 3px; color: var(--ds-sub); font-size: 11px;
      text-transform: uppercase; letter-spacing: .5px;
    }
    .prompt-text {
      margin: 0; padding: 7px 9px; border-radius: 7px; background: var(--ds-soft);
      white-space: pre-wrap; word-break: break-word;
      font-family: ui-monospace, Consolas, "Microsoft YaHei", monospace;
      font-size: 11.5px; line-height: 1.55; max-height: 220px; overflow: auto;
    }
    .prompt-text.empty { color: var(--ds-sub); font-style: italic; }

    .thinking { margin: 0 0 10px; background: var(--ds-soft); border-radius: 9px; padding: 8px 10px; }
    .thinking .label { color: var(--ds-sub); font-size: 12px; margin-bottom: 4px; }
    .thinking .text {
      margin: 0; white-space: pre-wrap; word-break: break-word;
      font-family: inherit; font-size: 12.5px; color: var(--ds-sub); max-height: 150px; overflow: auto;
    }

    .result { white-space: pre-wrap; word-break: break-word; min-height: 22px; }
    .result.pending::after {
      content: ''; display: inline-block; width: 7px; height: 15px;
      margin-left: 2px; vertical-align: -2px; background: var(--ds-accent);
      animation: ds-blink 1s steps(2, start) infinite;
    }
    @keyframes ds-blink { to { visibility: hidden; } }

    /* 双版本译文：简中 / 繁中各一块，各自带复制按钮 */
    .dual { display: flex; flex-direction: column; gap: 10px; }
    .dual-block {
      border: 1px solid var(--ds-line); border-radius: 9px; padding: 7px 9px 8px;
      background: var(--ds-soft);
    }
    .dual-head {
      display: flex; align-items: center; gap: 8px; margin-bottom: 5px;
      color: var(--ds-sub); font-size: 11.5px; font-weight: 600;
    }
    .dual-head .tag {
      border: 1px solid var(--ds-line); border-radius: 6px; padding: 0 6px;
      font-weight: 500; background: var(--ds-bg);
    }
    .dual-head .grow { flex: 1 1 auto; }
    .dual-text { white-space: pre-wrap; word-break: break-word; }

    .err { color: var(--ds-danger); white-space: pre-wrap; word-break: break-word; }
    .err .hint { display: block; margin-top: 6px; color: var(--ds-sub); font-size: 12.5px; }
    .err .ops { margin-top: 8px; }

    .ft {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-top: 1px solid var(--ds-line); background: var(--ds-soft);
    }
    .status {
      flex: 1 1 auto; color: var(--ds-sub); font-size: 11.5px; line-height: 1.4;
      overflow: hidden; word-break: break-word;
    }

    .btn {
      border: 1px solid var(--ds-line); background: var(--ds-bg); color: var(--ds-fg);
      border-radius: 8px; padding: 4px 10px; font-size: 12.5px; cursor: pointer; white-space: nowrap;
    }
    .btn:hover { border-color: var(--ds-accent); color: var(--ds-accent); }
    .btn.tiny { padding: 1px 7px; font-size: 11.5px; border-radius: 6px; font-weight: 400; }
    .btn.primary { background: var(--ds-accent); border-color: var(--ds-accent); color: var(--ds-accent-fg); }
    .btn.primary:hover { color: var(--ds-accent-fg); filter: brightness(1.06); }
    .btn[disabled] { opacity: .5; cursor: default; }
    .btn[hidden] { display: none; }
  `;

  /* ------------------------------------------------------------ DOM */

  const host = document.createElement('div');
  host.id = '__poe2ultra_selection_host__';
  host.setAttribute('data-poe2ultra-selection', '');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${STYLES}</style>
    <div class="layer" data-theme="light">
      <button class="fab" type="button" title="翻译选中文本（Alt+Q）" aria-label="翻译选中文本">
        <!-- Material Design 官方 translate 图标（实心路径，小尺寸下依然清晰） -->
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="m12.87 15.07-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7 1.62-4.33L19.12 17h-3.24z"/>
        </svg>
      </button>
      <section class="panel" role="dialog" aria-label="DeepSeek 翻译结果">
        <header class="hd">
          <span class="dot"></span>
          <span class="brand">DeepSeek 翻译</span>
          <span class="meta"></span>
          <span class="spacer"></span>
          <button class="icon-btn close" type="button" title="关闭（Esc）">✕</button>
        </header>
        <div class="body">
          <details class="src" hidden>
            <summary></summary>
            <div class="src-text"></div>
          </details>
          <div class="thinking" hidden>
            <div class="label">思考过程</div>
            <pre class="text"></pre>
          </div>
          <div class="result"></div>
          <div class="glossary-state" hidden></div>
          <details class="terms" hidden>
            <summary></summary>
            <ul class="term-list"></ul>
          </details>
          <details class="direct" hidden>
            <summary></summary>
            <ul class="direct-list"></ul>
          </details>
          <details class="sources" hidden>
            <summary></summary>
            <ol class="source-list"></ol>
          </details>
          <details class="prompt" hidden>
            <summary></summary>
            <div class="prompt-actions">
              <button class="btn tiny copy-prompt" type="button">复制完整 prompt</button>
            </div>
            <div class="prompt-label">system</div>
            <pre class="prompt-text sys"></pre>
            <div class="prompt-label">user</div>
            <pre class="prompt-text usr"></pre>
          </details>
        </div>
        <footer class="ft">
          <span class="status"></span>
          <button class="btn stop" type="button" hidden>停止</button>
          <button class="btn retry" type="button" hidden>重试</button>
          <button class="btn primary copy" type="button" hidden>复制译文</button>
        </footer>
      </section>
    </div>
  `;

  const layer = shadow.querySelector('.layer');
  const fab = shadow.querySelector('.fab');
  const panel = shadow.querySelector('.panel');
  const header = shadow.querySelector('.hd');
  const metaEl = shadow.querySelector('.meta');
  const closeBtn = shadow.querySelector('.close');
  const srcBox = shadow.querySelector('details.src');
  const srcSummary = shadow.querySelector('details.src summary');
  const srcText = shadow.querySelector('.src-text');
  const thinkBox = shadow.querySelector('.thinking');
  const thinkLabel = shadow.querySelector('.thinking .label');
  const thinkText = shadow.querySelector('.thinking .text');
  const resultEl = shadow.querySelector('.result');
  const glossaryStateEl = shadow.querySelector('.glossary-state');
  const termsBox = shadow.querySelector('details.terms');
  const termsSummary = shadow.querySelector('details.terms summary');
  const termList = shadow.querySelector('.term-list');
  const directBox = shadow.querySelector('details.direct');
  const directSummary = shadow.querySelector('details.direct summary');
  const directList = shadow.querySelector('.direct-list');
  const sourcesBox = shadow.querySelector('details.sources');
  const sourcesSummary = shadow.querySelector('details.sources summary');
  const sourceList = shadow.querySelector('.source-list');
  const promptBox = shadow.querySelector('details.prompt');
  const promptSummary = shadow.querySelector('details.prompt summary');
  const promptSys = shadow.querySelector('.prompt-text.sys');
  const promptUsr = shadow.querySelector('.prompt-text.usr');
  const promptCopyBtn = shadow.querySelector('.copy-prompt');
  let warnLine = null;
  const statusEl = shadow.querySelector('.status');
  const stopBtn = shadow.querySelector('.stop');
  const retryBtn = shadow.querySelector('.retry');
  const copyBtn = shadow.querySelector('.copy');

  function mount() {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }
  mount();

  function renderTheme() {
    layer.dataset.theme = resolvedTheme();
  }
  function renderWidth() {
    panel.style.width = `${Math.min(Math.max(Number(settings.panelWidth) || 400, 280), 900)}px`;
  }

  /* ------------------------------------------------------------ 选区 */

  let selectionInfo = null;
  let autoTimer = 0;

  const isOurs = (node) => {
    if (!node) return false;
    const root = node.getRootNode?.();
    return root === shadow || node === host;
  };

  function readSelection() {
    const guideRoot = document.querySelector('poe2-build-guide')?.shadowRoot;
    const range = selectedRange(window, guideRoot ? [guideRoot] : []);
    if (!range || isOurs(range.startContainer)) return null;
    const text = range.toString();
    if (!text.trim()) return null;
    const node = range.startContainer;
    const anchorEl = node.nodeType === 1 ? node : node.parentElement;
    if (anchorEl?.closest?.('input, textarea, [contenteditable="true"]')) return null;
    return { text: text.trim(), rect: pickRect(range) };
  }

  /**
   * 找出最合适的定位矩形。
   * 整段/跨屏选中时，行矩形可能有一大堆，这里优先取「视口内最后一个可见行」，
   * 拿不到任何矩形也不返回 null —— 只要选中了文字，浮标就必须出现。
   */
  function pickRect(range) {
    let rects = [];
    try {
      rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    } catch {
      rects = [];
    }

    if (!rects.length) {
      const box = range.getBoundingClientRect();
      if (box && (box.width > 0 || box.height > 0)) return toRect(box);
      return { left: window.innerWidth - 74, right: window.innerWidth - 44, top: 90, bottom: 120 };
    }

    const visible = rects.filter(
      (r) => r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
    );
    const pool = visible.length ? visible : rects;
    return toRect(pool[pool.length - 1]);
  }

  const toRect = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });

  function clampPosition(el, x, y, gap = 8) {
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    const maxX = window.innerWidth - w - gap;
    const maxY = window.innerHeight - h - gap;
    return {
      left: Math.min(Math.max(gap, x), Math.max(gap, maxX)),
      top: Math.min(Math.max(gap, y), Math.max(gap, maxY)),
    };
  }

  function showButton(info) {
    if (!settings.showButton || settings.autoTranslate) return;
    // 面板正开着且还是同一段文字时，不必再冒出一个浮标
    if (panel.classList.contains('show') && info.text === translatedText) return;
    mount(); // 某些 SPA 会重建 documentElement，必要时挂回去
    const { right, top } = info.rect;
    fab.classList.add('show');
    const x = right - 15;
    const y = top - 36 < 8 ? top + 6 : top - 36;
    const pos = clampPosition(fab, x, y, 6);
    fab.style.left = `${pos.left}px`;
    fab.style.top = `${pos.top}px`;
  }

  function hideButton() {
    fab.classList.remove('show');
  }

  function onSelectionMaybeChanged() {
    const info = readSelection();
    if (!info) {
      selectionInfo = null;
      hideButton();
      return;
    }
    const changed = !selectionInfo || selectionInfo.text !== info.text;
    selectionInfo = info;
    showButton(info);

    if (settings.autoTranslate && changed) {
      window.clearTimeout(autoTimer);
      autoTimer = window.setTimeout(() => translateSelection(info), 420);
    }
  }

  document.addEventListener('mouseup', (event) => {
    if (isOurs(event.target)) return;
    window.setTimeout(onSelectionMaybeChanged, 10);
  }, true);

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Escape' || isOurs(event.target)) return;
    if (event.shiftKey || event.key.startsWith('Arrow') || event.key === 'a' || event.key === 'A') {
      window.setTimeout(onSelectionMaybeChanged, 10);
    }
  }, true);

  document.addEventListener('mousedown', (event) => {
    if (isOurs(event.target)) return;
    hideButton();
    if (settings.autoClosePanel) closePanel();
  }, true);

  // 选区变化（拖选、三击选段、键盘选择、程序化选择都会触发）——鼠标事件之外的兜底
  let selectionChangeTimer = 0;
  document.addEventListener('selectionchange', () => {
    window.clearTimeout(selectionChangeTimer);
    selectionChangeTimer = window.setTimeout(onSelectionMaybeChanged, 140);
  });

  // 滚动时不要直接收起浮标：长段落拖选往往伴随自动滚动，
  // 滚动事件会在 mouseup 之后继续触发，直接隐藏就会「划完一整段却没有图标」。
  let scrollRaf = 0;
  window.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!fab.classList.contains('show')) return;
      const info = readSelection();
      if (!info) {
        selectionInfo = null;
        hideButton();
        return;
      }
      selectionInfo = info;
      showButton(info);
    });
  }, true);

  window.addEventListener('resize', () => {
    hideButton();
    if (panel.classList.contains('show')) keepPanelInView();
  });

  fab.addEventListener('pointerdown', (event) => {
    // 关键：阻止默认行为，否则选区会被取消
    event.preventDefault();
    event.stopPropagation();
  });

  let lastFabActivation = 0;
  const activateFab = (event) => {
    event?.preventDefault();
    event?.stopPropagation();
    const now = Date.now();
    if (now - lastFabActivation < 350) return; // pointerup 与 click 都会触发，去重
    lastFabActivation = now;
    const info = selectionInfo || readSelection();
    if (info) translateSelection(info);
  };
  fab.addEventListener('pointerup', activateFab);
  fab.addEventListener('click', activateFab);

  /* ------------------------------------------------------------ 面板 */

  let dragging = null;
  let panelPinnedLeft = null;
  let panelPinnedTop = null;

  function openPanel(anchorRect) {
    mount();
    panel.classList.add('show');
    if (panelPinnedLeft === null) {
      const gap = 10;
      const x = anchorRect ? anchorRect.left : (window.innerWidth - panel.offsetWidth) / 2;
      const below = anchorRect ? anchorRect.bottom + 26 : 80;
      const pos = clampPosition(panel, x, below, gap);
      panelPinnedLeft = pos.left;
      panelPinnedTop = pos.top;
    }
    keepPanelInView();
  }

  function keepPanelInView() {
    if (panelPinnedLeft === null) return;
    const pos = clampPosition(panel, panelPinnedLeft, panelPinnedTop, 8);
    panelPinnedLeft = pos.left;
    panelPinnedTop = pos.top;
    panel.style.left = `${pos.left}px`;
    panel.style.top = `${pos.top}px`;
  }

  function closePanel() {
    panel.classList.remove('show');
    panelPinnedLeft = null;
    panelPinnedTop = null;
    abortCurrent();
  }

  header.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    dragging = {
      startX: event.clientX,
      startY: event.clientY,
      originLeft: panel.offsetLeft,
      originTop: panel.offsetTop,
    };
    header.classList.add('dragging');
    header.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  header.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const pos = clampPosition(
      panel,
      dragging.originLeft + (event.clientX - dragging.startX),
      dragging.originTop + (event.clientY - dragging.startY),
      8
    );
    panelPinnedLeft = pos.left;
    panelPinnedTop = pos.top;
    panel.style.left = `${pos.left}px`;
    panel.style.top = `${pos.top}px`;
  });

  const endDrag = () => {
    dragging = null;
    header.classList.remove('dragging');
  };
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);

  closeBtn.addEventListener('click', closePanel);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.classList.contains('show')) {
      closePanel();
    }
  }, true);

  /* ------------------------------------------------------------ 翻译 */

  let current = null; // { requestId, port, text, startedAt, timer }
  let lastText = '';
  let translatedText = ''; // 最近一次发起翻译的原文
  let termsWasHit = false; // 本次是否命中了本地术语表

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function abortCurrent() {
    if (!current) return;
    const { port, requestId, timer } = current;
    window.clearInterval(timer);
    current = null;
    try {
      port.postMessage({ type: 'abort', requestId });
      port.disconnect();
    } catch {
      /* 忽略 */
    }
  }

  function resetPanelFor(text) {
    resultEl.textContent = '';
    resultEl.classList.add('pending');
    resultEl.classList.remove('err');
    thinkBox.hidden = true;
    thinkText.textContent = '';
    sourcesBox.hidden = true;
    sourcesBox.open = false;
    sourceList.textContent = '';
    termsBox.hidden = true;
    termsBox.open = false;
    termList.textContent = '';
    directBox.hidden = true;
    directBox.open = false;
    directList.textContent = '';
    glossaryStateEl.hidden = true;
    glossaryStateEl.textContent = '';
    promptBox.hidden = true;
    promptBox.open = false;
    promptSys.textContent = '';
    promptUsr.textContent = '';
    warnLine?.remove();
    warnLine = null;
    copyBtn.hidden = true;
    stopBtn.hidden = false;
    retryBtn.hidden = true;

    if (settings.keepSource) {
      srcBox.hidden = false;
      srcSummary.textContent = `原文 · ${text.length} 字符`;
      srcText.textContent = text;
    } else {
      srcBox.hidden = true;
    }
  }

  function translateSelection(info) {
    const text = String(info?.text || '').trim();
    if (!text) return;
    hideButton();

    const limit = Math.max(500, Number(settings.maxChars) || 8000);
    if (text.length > limit) {
      lastText = text;
      translatedText = text;
      openPanel(info.rect);
      resultEl.classList.remove('pending');
      resultEl.classList.add('err');
      resultEl.textContent = `选中文本过长：${text.length} 字符，超过上限 ${limit} 字符。`;
      resultEl.insertAdjacentHTML(
        'beforeend',
        '<span class="hint">请缩短选区，或到设置页调大「单次最大字符数」。</span>'
      );
      copyBtn.hidden = true;
      stopBtn.hidden = true;
      retryBtn.hidden = true;
      setStatus('');
      return;
    }

    abortCurrent();
    lastText = text;
    translatedText = text;
    openPanel(info?.rect);
    resetPanelFor(text);

    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const startedAt = Date.now();
    let port;
    try {
      port = chrome.runtime.connect({ name: 'poe2ultra-selection' });
    } catch {
      // 扩展被重新加载 / 更新后，旧页面的 content script 会失去上下文
      finishError({ message: '扩展已被重新加载，请刷新当前页面后再试。' });
      return;
    }
    let received = '';
    let reasoning = '';
    let lastPing = Date.now();

    const timer = window.setInterval(() => {
      if (!current) return;
      if (Date.now() - lastPing >= 20000) {
        lastPing = Date.now();
        try { port.postMessage({ type: 'ping' }); } catch { /* disconnect handler reports it */ }
      }
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      const chars = received.length;
      setStatus(chars ? `翻译中… ${secs}s · 已输出 ${chars} 字` : `翻译中… ${secs}s`);
    }, 200);

    current = { requestId, port, text, startedAt, timer };

    port.onMessage.addListener((msg) => {
      if (!current || msg.requestId !== requestId) return;

      if (msg.type === 'started') {
        metaEl.textContent = `→ ${msg.targetLang || ''}${msg.model ? ` · ${msg.model}` : ''}`;
        setStatus(termsWasHit ? '已找到术语，正在翻译…' : '已连接，等待模型输出…');
        return;
      }
      if (msg.type === 'context') {
        renderTerms(msg.terms);
        renderDirect(msg.direct);
        renderGlossaryState(msg.glossary);
        renderSources(msg.sources);
        renderPrompt(msg.prompt);
        renderWarnings(msg.warnings);
        termsWasHit = Boolean(msg.terms?.length);
        if (termsWasHit) setStatus(`本地术语表命中 ${msg.terms.length} 条，正在翻译…`);
        return;
      }
      if (msg.type === 'chunk') {
        received += msg.delta || '';
        resultEl.textContent = received;
        return;
      }
      if (msg.type === 'reasoning') {
        reasoning += msg.delta || '';
        thinkBox.hidden = false;
        thinkText.textContent = reasoning;
        return;
      }
      if (msg.type === 'done') {
        finishOk(msg, received);
        return;
      }
      if (msg.type === 'error') {
        finishError(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      if (current && current.requestId === requestId) {
        finishError({ message: '与扩展后台的连接中断了，请刷新页面后重试。' });
      }
    });

    // 监听器就位后再发请求，避免错过 background 的第一批回包
    try {
      port.postMessage({
        type: 'start',
        requestId,
        text,
        title: document.title,
        url: location.href,
        pageLang: document.documentElement.lang || '',
      });
    } catch {
      finishError({ message: '扩展已被重新加载，请刷新当前页面后再试。' });
    }
  }

  /**
   * 渲染双版本译文（简中 + 繁中）。
   * 两版是两套独立译名（不是字形转换），所以分块展示、各自可复制；
   * 「复制译文」按钮仍然复制带标记的整段，方便整段粘到别处。
   */
  function renderDual(dual) {
    resultEl.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'dual';

    for (const [key, label] of [['cn', '简中'], ['tw', '繁中']]) {
      const text = String(dual?.[key] || '').trim();
      const block = document.createElement('div');
      block.className = 'dual-block';

      const head = document.createElement('div');
      head.className = 'dual-head';

      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = label;
      head.appendChild(tag);

      const note = document.createElement('span');
      note.className = 'grow';
      note.textContent = key === 'cn' ? '简体中文' : '繁體中文';
      head.appendChild(note);

      if (text) {
        const copy = document.createElement('button');
        copy.className = 'btn tiny';
        copy.type = 'button';
        copy.textContent = '复制';
        copy.dataset.text = text;
        copy.addEventListener('click', async (event) => {
          event.preventDefault();
          const ok = await copyText(text);
          copy.textContent = ok ? '已复制' : '复制失败';
          window.setTimeout(() => {
            copy.textContent = '复制';
          }, 1200);
        });
        head.appendChild(copy);
      }
      block.appendChild(head);

      const body = document.createElement('div');
      body.className = 'dual-text';
      body.textContent = text || '（模型没有给出这一段，请重试）';
      block.appendChild(body);

      wrap.appendChild(block);
    }
    resultEl.appendChild(wrap);
  }

  function finishOk(msg, streamed) {
    const { timer, startedAt = Date.now() } = current || {};
    window.clearInterval(timer);
    const port = current?.port;
    current = null;
    try {
      port?.disconnect();
    } catch {
      /* 忽略 */
    }

    const finalText = (msg.text || streamed || '').trim();
    resultEl.classList.remove('pending');
    if (msg.reasoning) {
      thinkBox.hidden = false;
      thinkText.textContent = msg.reasoning;
      // 让用户一眼看出这次到底有没有走思考模式、思考花了多少 token
      const reasoningTokens = msg.usage?.completion_tokens_details?.reasoning_tokens;
      thinkLabel.textContent = reasoningTokens
        ? `思考过程 · ${reasoningTokens} tokens（按输出价计费）`
        : '思考过程';
    }
    if (msg.dual) renderDual(msg.dual);
    else resultEl.textContent = finalText;
    // 复制按钮给的是带【简中】【繁中】标记的整段（两版都带上）
    const copyPayload = msg.dualText || finalText;
    copyBtn.hidden = !copyPayload;
    stopBtn.hidden = true;
    retryBtn.hidden = false;
    copyBtn.dataset.text = copyPayload;

    const secs = ((msg.elapsedMs || Date.now() - startedAt) / 1000).toFixed(1);
    const usage = msg.usage || {};
    const parts = [`完成 · ${secs}s`];
    if (usage.prompt_tokens || usage.completion_tokens) {
      parts.push(`输入 ${usage.prompt_tokens || 0} / 输出 ${usage.completion_tokens || 0}`);
    } else if (msg.dual) {
      parts.push(`简中 ${String(msg.dual.cn || '').length} 字 / 繁中 ${String(msg.dual.tw || '').length} 字`);
    } else {
      parts.push(`${finalText.length} 字`);
    }
    if (msg.cost?.text) parts.push(msg.cost.text);
    if (msg.finishReason === 'length') parts.push('⚠ 输出被 max_tokens 截断');
    setStatus(parts.join(' · '));
    if (msg.terms) renderTerms(msg.terms);
    if (msg.direct) renderDirect(msg.direct);
    if (msg.glossary) renderGlossaryState(msg.glossary);
    renderSources(msg.citations?.length ? msg.citations : msg.sources);
    if (msg.prompt !== undefined) renderPrompt(msg.prompt);
    renderWarnings(msg.warnings);

    statusEl.title = msg.cost?.text
      ? `按 ${msg.cost.label} ${msg.cost.peak ? '高峰' : '空闲'}时段单价估算，实际以 DeepSeek 账单为准`
      : '';
    keepPanelInView();
  }

  /**
   * 展示「本地术语表这次到底干了什么」。
   * 文案由 background 用 shared/context.js 里的同一个实现生成后下发，
   * 内容脚本只负责显示 —— 避免两边各写一份、慢慢漂移。
   */
  function renderGlossaryState(view) {
    if (!view?.text) {
      glossaryStateEl.hidden = true;
      glossaryStateEl.textContent = '';
      return;
    }
    glossaryStateEl.textContent = view.text;
    glossaryStateEl.className = `glossary-state${view.level ? ` ${view.level}` : ''}`;
    glossaryStateEl.hidden = false;
  }

  /** 渲染命中的本地术语表条目。 */
  /** 渲染命中的本地术语表条目（简中 / 繁中两列都给，PoE2 这两套译名不一样）。 */
  function renderTerms(terms) {
    const list = Array.isArray(terms) ? terms : [];
    if (!list.length) {
      termsBox.hidden = true;
      termList.textContent = '';
      return;
    }
    termList.textContent = '';
    const twFirst = /繁|繁体|繁中|繁體/.test(String(settings.targetLang || '')) && !settings.dualOutput;
    const cell = (label, value) => {
      const span = document.createElement('span');
      span.className = 'zh';
      const missing = !String(value || '').trim();
      span.textContent = `${label}：${missing ? '待补' : value}`;
      if (missing) span.classList.add('missing');
      return span;
    };

    for (const term of list) {
      const li = document.createElement('li');

      const en = document.createElement('span');
      en.className = 'en';
      en.textContent = term.en || term.matched || '';
      li.appendChild(en);

      const arrow = document.createElement('span');
      arrow.textContent = ' → ';
      li.appendChild(arrow);

      const cells = twFirst
        ? [cell('繁中', term.zh_tw), cell('简中', term.zh_cn)]
        : [cell('简中', term.zh_cn), cell('繁中', term.zh_tw)];
      cells.forEach((el, i) => {
        if (i) {
          const sep = document.createElement('span');
          sep.className = 'sep';
          sep.textContent = ' ｜ ';
          li.appendChild(sep);
        }
        li.appendChild(el);
      });

      if (term.category) {
        const cat = document.createElement('span');
        cat.className = 'cat';
        cat.textContent = `（${term.category}）`;
        li.appendChild(cat);
      }

      if (term.source) {
        const link = document.createElement('a');
        link.href = term.source;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.textContent = ' 来源';
        li.appendChild(link);
      }
      termList.appendChild(li);
    }
    termsSummary.textContent = `本地术语表命中 ${list.length} 条（简中 / 繁中两列）· 已作为上下文发送`;
    termsBox.hidden = false;
  }

  /** 渲染本次实际发出去的 prompt（system / user 原文照登）。 */
  function renderPrompt(prompt) {
    if (!prompt) {
      promptBox.hidden = true;
      return;
    }
    const chars = `${prompt.system || ''}${prompt.user || ''}`.length;
    promptSummary.textContent = prompt.error
      ? `最终发送的 Prompt · 组装失败：${prompt.error}`
      : `最终发送的 Prompt · ${chars} 字符 · ${prompt.mode === 'chat' ? 'Chat Completions' : 'Responses API'}`;

    const fill = (el, text) => {
      el.textContent = text || '（空）';
      el.classList.toggle('empty', !text);
    };
    fill(promptSys, prompt.system);
    fill(promptUsr, prompt.user);
    promptCopyBtn.dataset.text = [
      prompt.system ? `【system】\n${prompt.system}` : '【system】（空）',
      `【user】\n${prompt.user || ''}`,
    ].join('\n\n');
    promptBox.hidden = false;
  }

  promptCopyBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    const ok = await copyText(promptCopyBtn.dataset.text || '');
    const original = promptCopyBtn.textContent;
    promptCopyBtn.textContent = ok ? '已复制' : '复制失败';
    window.setTimeout(() => {
      promptCopyBtn.textContent = original;
    }, 1200);
  });

  /** poe2db 语言路径 → 人话（与 shared/context.js 的标注保持一致）。 */
  function localeName(locale) {
    if (locale === 'tw') return '繁中';
    if (locale === 'us') return '英文原文';
    return '简中';
  }

  /**
   * 渲染 poe2db 术语页直查结果。
   * 同一个术语的 cn / tw 页是两套译名，合并成一条展示：
   *   Abyssal Lich = 深渊巫妖（简中）/ 深淵巫妖（繁中）  简中页 繁中页
   */
  function renderDirect(hits) {
    const list = Array.isArray(hits) ? hits : [];
    if (!list.length) {
      directBox.hidden = true;
      directList.textContent = '';
      return;
    }

    const groups = [];
    const index = new Map();
    for (const hit of list) {
      const term = String(hit?.term || '').trim();
      if (!term) continue;
      const key = term.toLowerCase();
      let group = index.get(key);
      if (!group) {
        group = { term, entries: [] };
        index.set(key, group);
        groups.push(group);
      }
      group.entries.push(hit);
    }

    directList.textContent = '';
    let nameCount = 0;
    for (const group of groups) {
      const li = document.createElement('li');

      const term = document.createElement('span');
      term.className = 'term';
      term.textContent = group.term;
      li.appendChild(term);

      const arrow = document.createElement('span');
      arrow.textContent = ' = ';
      li.appendChild(arrow);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = group.entries
        .map((h) => `${h.name || '（未解析出名称）'}（${localeName(h.locale)}）`)
        .join(' / ');
      li.appendChild(name);
      nameCount += group.entries.length;

      for (const hit of group.entries) {
        if (!hit.url) continue;
        const link = document.createElement('a');
        link.href = hit.url;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.className = 'page-link';
        link.textContent = `${localeName(hit.locale)}页`;
        li.appendChild(link);
      }
      directList.appendChild(li);
    }

    directSummary.textContent =
      `poe2db 直查 · ${groups.length} 个候选术语已解析出 ${nameCount} 条译名`;
    directBox.hidden = false;
  }

  /** 渲染 poe2db.tw 检索结果。 */
  function renderSources(citations) {
    const list = Array.isArray(citations) ? citations.filter((c) => c?.url || c?.variants?.length) : [];
    if (!list.length) {
      sourcesBox.hidden = true;
      sourceList.textContent = '';
      return;
    }
    sourceList.textContent = '';
    for (const cite of list) {
      const li = document.createElement('li');

      // 新格式：同一页面的简中/繁中并排（Tavily 结果按 slug 聚合过）
      const variants = Array.isArray(cite.variants) && cite.variants.length ? cite.variants : null;
      if (variants) {
        if (cite.term) {
          const term = document.createElement('span');
          term.className = 'en';
          term.textContent = `${cite.term} = `;
          li.appendChild(term);
        }
        variants.forEach((v, i) => {
          if (i) li.appendChild(document.createTextNode(' / '));
          const a = document.createElement('a');
          a.href = v.url;
          a.target = '_blank';
          a.rel = 'noreferrer noopener';
          a.textContent = `${v.name || v.title || v.url}（${localeName(v.locale)}）`;
          li.appendChild(a);
        });
      } else {
        const a = document.createElement('a');
        a.href = cite.url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.textContent = cite.title || cite.url;
        li.appendChild(a);
      }

      if (cite.snippet) {
        const snip = document.createElement('div');
        snip.className = 'cat';
        snip.textContent = cite.snippet;
        li.appendChild(snip);
      }
      sourceList.appendChild(li);
    }
    sourcesSummary.textContent = `poe2db.tw 检索 · ${list.length} 条 · 已作为补充上下文`;
    sourcesBox.hidden = false;
  }

  /** 术语表 / Tavily 出问题时的提示（不阻断翻译）。 */
  function renderWarnings(warnings) {
    const list = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
    if (!list.length) return;
    if (!warnLine) {
      warnLine = document.createElement('div');
      warnLine.className = 'warn-line';
      resultEl.after(warnLine);
    }
    warnLine.textContent = list.join('\n');
  }

  function finishError(msg) {
    const { timer } = current || {};
    window.clearInterval(timer);
    const port = current?.port;
    current = null;
    try {
      port?.disconnect();
    } catch {
      /* 忽略 */
    }
    resultEl.classList.remove('pending');

    if (msg.aborted) {
      setStatus('已取消');
      stopBtn.hidden = true;
      retryBtn.hidden = !lastText;
      return;
    }
    resultEl.classList.add('err');
    resultEl.textContent = `翻译失败：${msg.message || '未知错误'}`;
    if (msg.hint) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = msg.hint;
      resultEl.appendChild(hint);
    }
    const ops = document.createElement('div');
    ops.className = 'ops';
    const openOptions = document.createElement('button');
    openOptions.className = 'btn';
    openOptions.type = 'button';
    openOptions.textContent = '打开设置';
    openOptions.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ type: 'open-options' })?.catch?.(() => {});
      } catch {
        /* 扩展上下文已失效，忽略 */
      }
    });
    ops.appendChild(openOptions);
    resultEl.appendChild(ops);

    setStatus('出错了');
    stopBtn.hidden = true;
    retryBtn.hidden = !lastText;
    keepPanelInView();
  }

  stopBtn.addEventListener('click', () => {
    abortCurrent();
    resultEl.classList.remove('pending');
    setStatus('已取消');
    stopBtn.hidden = true;
    retryBtn.hidden = !lastText;
  });

  retryBtn.addEventListener('click', () => {
    if (!lastText) return;
    translateSelection({ text: lastText, rect: { left: panel.offsetLeft, top: panel.offsetTop, right: panel.offsetLeft, bottom: panel.offsetTop } });
  });

  copyBtn.addEventListener('click', async () => {
    const text = copyBtn.dataset.text || resultEl.textContent || '';
    if (!text) return;
    const ok = await copyText(text);
    const original = copyBtn.textContent;
    copyBtn.textContent = ok ? '已复制' : '复制失败';
    window.setTimeout(() => {
      copyBtn.textContent = original;
    }, 1200);
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.documentElement.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  /* ---------------------------------------------------- 来自后台的指令 */

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'translate-selection-command') return;
    let info = msg.text && msg.text.trim() ? { text: msg.text.trim(), rect: null } : null;
    if (!info) info = readSelection();
    if (!info) return;
    translateSelection({ text: info.text, rect: info.rect || { left: window.innerWidth - 430, top: 80, right: window.innerWidth - 430, bottom: 80 } });
  });

  /* ------------------------------------------------------------ 启动 */

  loadSettings();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (settings.theme === 'auto') renderTheme();
  });
}
