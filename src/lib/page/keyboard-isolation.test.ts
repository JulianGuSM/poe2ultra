import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isolateGuideKeyboard } from './keyboard-isolation';

let root: ShadowRoot;
let stop: () => void;
const received = vi.fn();
const types = ['keydown', 'keyup', 'keypress'] as const;

beforeEach(() => {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<button>Overview</button><button>Skills</button><button>Passives</button>';
  stop = isolateGuideKeyboard(root);
  received.mockClear();
  for (const type of types) window.addEventListener(type, received);
});

afterEach(() => {
  stop();
  for (const type of types) window.removeEventListener(type, received);
});

it.each(['ControlLeft', 'ControlRight'])('lets the site track %s after navigation retains focus in the guide', (code) => {
  for (const button of root.querySelectorAll('button')) {
    button.focus();
    const down = new KeyboardEvent('keydown', { key: 'Control', code, ctrlKey: true, bubbles: true, composed: true });
    const up = new KeyboardEvent('keyup', { key: 'Control', code, ctrlKey: false, bubbles: true, composed: true });
    button.dispatchEvent(down);
    button.dispatchEvent(up);
    expect(received).toHaveBeenNthCalledWith(received.mock.calls.length - 1, down);
    expect(received).toHaveBeenLastCalledWith(up);
  }
  expect(received).toHaveBeenCalledTimes(6);
});

it('keeps ordinary keys and Ctrl shortcuts local without cancelling their defaults', () => {
  for (const type of types) {
    for (const ctrlKey of [false, true]) {
      const event = new KeyboardEvent(type, { key: 'a', code: 'KeyA', ctrlKey, bubbles: true, composed: true, cancelable: true });
      root.querySelector('button')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  }
  expect(received).not.toHaveBeenCalled();
});

it('removes its listeners when the guide is removed', () => {
  stop();
  root.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }));
  expect(received).toHaveBeenCalledOnce();
});
