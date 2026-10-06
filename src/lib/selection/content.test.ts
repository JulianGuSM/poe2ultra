import { expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/preact';
import { startSelection } from './content.js';

it('opens the original streaming panel only on activation, renders both regional versions, and can stop', async () => {
  let command!: (message: any) => void;
  let receive!: (message: any) => void;
  const post = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('chrome', {
    storage: { onChanged: { addListener: () => {} } },
    runtime: { sendMessage: async () => ({ ok: true, data: { theme: 'dark', panelWidth: 520 } }), onMessage: { addListener: (fn: typeof command) => { command = fn; } },
      connect: () => ({ postMessage: post, disconnect, onMessage: { addListener: (fn: typeof receive) => { receive = fn; } }, onDisconnect: { addListener: () => {} } }) },
  });
  try {
    startSelection();
    const root = document.getElementById('__poe2ultra_selection_host__')!.shadowRoot!;
    await waitFor(() => expect((root.querySelector('.panel') as HTMLElement).style.width).toBe('520px'));
    expect(post).not.toHaveBeenCalled();
    command({ type: 'translate-selection-command', text: 'Abyssal Lich' });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'start', text: 'Abyssal Lich' }));
    const requestId = post.mock.calls[0]![0].requestId;
    receive({ type: 'chunk', requestId, delta: '【简中】深渊' });
    expect(root.querySelector('.result')!.textContent).toContain('深渊');
    receive({ type: 'done', requestId, text: '【简中】深渊巫妖\n【繁中】深淵妖巫', dual: { cn: '深渊巫妖', tw: '深淵妖巫' }, dualText: 'both versions' });
    expect([...root.querySelectorAll('.dual-text')].map(el => el.textContent)).toEqual(['深渊巫妖', '深淵妖巫']);
    expect(root.querySelectorAll('.dual-head button')).toHaveLength(2);
    expect(disconnect).toHaveBeenCalledOnce();
    command({ type: 'translate-selection-command', text: 'Another selection' });
    (root.querySelector('.stop') as HTMLButtonElement).click();
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'abort' }));
  } finally { document.getElementById('__poe2ultra_selection_host__')?.remove(); vi.unstubAllGlobals(); }
});
