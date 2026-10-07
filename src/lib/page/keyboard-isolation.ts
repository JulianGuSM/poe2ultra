/** Keep guide shortcuts local, but let the site's tree track the physical Ctrl key.
 * Navigation buttons retain focus inside the shadow root after switching tabs. Blocking
 * Control keydown/keyup there leaves the tree unaware of Ctrl, or stuck with it pressed.
 */
export function isolateGuideKeyboard(root: ShadowRoot): () => void {
  const events = ['keydown', 'keyup', 'keypress'] as const;
  const isolate = (event: Event) => {
    const key = event as KeyboardEvent;
    // Pass only the modifier itself, not shortcuts such as Ctrl+A or Ctrl+F.
    if (key.key === 'Control' || key.code === 'ControlLeft' || key.code === 'ControlRight') return;
    event.stopPropagation();
  };
  for (const type of events) root.addEventListener(type, isolate);
  return () => {
    for (const type of events) root.removeEventListener(type, isolate);
  };
}
