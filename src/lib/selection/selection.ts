/** Chrome can retarget window selections to a shadow host; prefer a range inside the reader. */
export function selectedRange(win: Window, roots: ShadowRoot[] = []): Range | null {
  for (const root of roots) {
    const selection = (root as ShadowRoot & { getSelection?(): Selection | null }).getSelection?.();
    if (selection && !selection.isCollapsed && selection.rangeCount && selection.toString().trim()) return selection.getRangeAt(selection.rangeCount - 1);
  }
  const selection = win.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) return null;
  return selection.getRangeAt(selection.rangeCount - 1);
}
