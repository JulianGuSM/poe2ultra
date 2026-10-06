import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBuild } from '@/lib/build/parse-build';
import { loadFixture } from '../../../tests/fixtures/load';
import { BuildView } from '../build/BuildView';
import { planTranslation, segmentKey } from '@/lib/translation/plan';

const mock = vi.hoisted(() => ({ listeners: [] as ((message: any) => void)[], post: vi.fn(), disconnect: vi.fn(), set: vi.fn(async () => {}) }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { connect: () => ({ postMessage: mock.post, disconnect: mock.disconnect, onMessage: { addListener: (fn: (message: any) => void) => mock.listeners.push(fn) }, onDisconnect: { addListener: () => {} } }) },
  storage: { local: { get: async () => ({}), set: mock.set }, onChanged: { addListener: () => {}, removeListener: () => {} } },
} }));

const fixture = loadFixture('chaos-dot-lich-starter-deadrabbit');
const build = parseBuild(fixture.build, fixture.staticData);
beforeEach(() => { mock.listeners = []; mock.post.mockClear(); mock.disconnect.mockClear(); });
describe('guide translation controls', () => {
  it('restores cached regional versions and switches languages without requesting paid work', async () => {
    const route = vi.fn();
    render(<BuildView build={build} initialHash="" onRouteChange={route} onOriginal={() => {}} headerCollapsed={false} onHeaderCollapsedChange={() => {}} />);
    await waitFor(() => expect(mock.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'inspect' })));
    const segment = planTranslation(build).segments.find(s => s.texts[0] === build.title)!;
    await act(() => {
      mock.listeners.forEach(fn => fn({ type: 'progress', records: { [segmentKey(segment)]: { cn: ['简体攻略'], tw: ['繁體攻略'] } }, completed: 1, total: 100, cached: 1 }));
      mock.listeners.forEach(fn => fn({ type: 'done' }));
    });
    fireEvent.click(screen.getByRole('button', { name: '简中', exact: true }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(build.title + '简体攻略');
    fireEvent.click(screen.getByRole('button', { name: '繁中', exact: true }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(build.title + '繁體攻略');
    fireEvent.click(screen.getByRole('button', { name: 'Original', exact: true }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(build.title);
    expect(mock.post.mock.calls.some(([m]) => m.type === 'translate')).toBe(false);
    expect(route).not.toHaveBeenCalled();
  });
  it('translates all collected variants only after a click, and exposes cancellation', async () => {
    render(<BuildView build={build} initialHash="" onRouteChange={() => {}} onOriginal={() => {}} headerCollapsed={false} onHeaderCollapsedChange={() => {}} />);
    await waitFor(() => expect(mock.listeners.length).toBe(1));
    await act(() => mock.listeners[0]!({ type: 'done' }));
    fireEvent.click(screen.getByRole('button', { name: '开始翻译 · 简中 + 繁中' }));
    expect(mock.post).toHaveBeenLastCalledWith({ type: 'translate', segments: planTranslation(build).segments });
    fireEvent.click(screen.getByRole('button', { name: '停止翻译', exact: true }));
    expect(mock.post).toHaveBeenLastCalledWith({ type: 'cancel' });
  });
  it('explains an empty cache when a language is selected, and keeps the start action before the counters', async () => {
    const view = render(<BuildView build={build} initialHash="" onRouteChange={() => {}} onOriginal={() => {}} headerCollapsed={false} onHeaderCollapsedChange={() => {}} />);
    await waitFor(() => expect(mock.listeners.length).toBe(1));
    await act(() => {
      mock.listeners[0]!({ type: 'progress', records: {}, completed: 0, total: 2249, cached: 0 });
      mock.listeners[0]!({ type: 'done' });
    });
    fireEvent.click(screen.getByRole('button', { name: '简中', exact: true }));
    expect(screen.getByText(/还没有中文译文/)).toBeTruthy();
    expect(screen.getByText(/已缓存 0 \/ 2,249 个文字块/)).toBeTruthy();
    const start = screen.getByRole('button', { name: '开始翻译 · 简中 + 繁中' });
    expect(start.hasAttribute('disabled')).toBe(false);
    const controls = view.container.querySelector('.translation__bar')!;
    expect(controls.contains(start)).toBe(true);
    expect(controls.contains(view.container.querySelector('.translation__status'))).toBe(false);
    expect(mock.post.mock.calls.some(([m]) => m.type === 'translate')).toBe(false);
    fireEvent.click(start);
    expect(mock.post.mock.calls.filter(([m]) => m.type === 'translate')).toHaveLength(1);
  });
  it('shows saved progress separately from live batch output, and preserves progress on error', async () => {
    render(<BuildView build={build} initialHash="" onRouteChange={() => {}} onOriginal={() => {}} headerCollapsed={false} onHeaderCollapsedChange={() => {}} />);
    await waitFor(() => expect(mock.listeners.length).toBe(1));
    await act(() => {
      mock.listeners[0]!({ type: 'progress', records: {}, completed: 0, total: 100, cached: 0 });
      mock.listeners[0]!({ type: 'done' });
    });
    fireEvent.click(screen.getByRole('button', { name: '开始翻译 · 简中 + 繁中' }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByText(/正在检查缓存/)).toBeTruthy();
    await act(() => {
      mock.listeners[0]!({ type: 'progress', records: {}, completed: 24, total: 100, cached: 0 });
      mock.listeners[0]!({ type: 'activity', stage: 'receiving', batch: 2, batches: 5, receivedChars: 432 });
    });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('24');
    expect(screen.getByText(/第 2 \/ 5 批/)).toBeTruthy();
    expect(screen.getByText(/432.*字符/)).toBeTruthy();
    expect(screen.getByText(/总用时/)).toBeTruthy();
    vi.useFakeTimers();
    try {
      // Switch from real to fake timers before a new run to exercise the hook's interval.
      await act(() => mock.listeners[0]!({ type: 'cancelled' }));
      fireEvent.click(screen.getByRole('button', { name: '继续翻译剩余内容' }));
      await act(() => { vi.advanceTimersByTime(2100); });
      expect(screen.getByText(/总用时 2 秒/)).toBeTruthy();
    } finally { vi.useRealTimers(); }
    await act(() => mock.listeners[0]!({ type: 'error', text: '模型未返回有效译文' }));
    expect(screen.getByRole('alert').textContent).toContain('模型未返回有效译文');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('24');
    expect(screen.queryByText(/正在接收译文/)).toBeNull();
    expect(screen.getByRole('button', { name: '继续翻译剩余内容' })).toBeTruthy();
  });
});
