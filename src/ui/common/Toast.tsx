import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { Check, TriangleAlert, X } from 'lucide-preact';

type ToastKind = 'success' | 'warning' | 'error';
interface ToastMessage { id: number; kind: ToastKind; text: string }
interface ToastApi { notify(text: string, kind?: ToastKind): void }

const ToastContext = createContext<ToastApi>({ notify: () => {} });

/** Shared, visible feedback for brief actions such as copying a gem name. */
export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const nextId = useRef(0);
  const notify = useCallback((text: string, kind: ToastKind = 'success') => {
    setToast({ id: ++nextId.current, kind, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4400);
    return () => window.clearTimeout(timer);
  }, [toast?.id]);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {toast && <div key={toast.id} class={`translation-toast translation-toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}>
        <span class="translation-toast__icon" aria-hidden="true">{toast.kind === 'success' ? <Check size={15} /> : <TriangleAlert size={15} />}</span>
        <span class="translation-toast__text">{toast.text}</span>
        <button type="button" class="translation-toast__close" aria-label="关闭通知" onClick={() => setToast(null)}><X size={15} aria-hidden="true" /></button>
      </div>}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
