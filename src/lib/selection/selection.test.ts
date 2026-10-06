import { describe, expect, it, vi } from 'vitest';
import { selectedRange } from './selection';

describe('selection in guide shadow DOM', () => {
  it('uses the selected text range inside the guide instead of its retargeted host', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const text = document.createTextNode('Abyssal Lich'); root.append(text);
    const range = document.createRange(); range.selectNodeContents(text);
    const shadowSelection = { rangeCount: 1, isCollapsed: false, anchorNode: text, toString: () => 'Abyssal Lich', getRangeAt: () => range };
    Object.assign(root, { getSelection: () => shadowSelection });
    const fakeWindow = { getSelection: () => ({ rangeCount: 1, isCollapsed: false, anchorNode: host, toString: () => 'Abyssal Lich', getRangeAt: () => document.createRange() }) };
    expect(selectedRange(fakeWindow as unknown as Window, [root])?.startContainer).toBe(text);
  });
  it('returns no range for collapsed or empty selection', () => {
    expect(selectedRange({ getSelection: vi.fn(() => null) } as unknown as Window)).toBeNull();
  });
});
