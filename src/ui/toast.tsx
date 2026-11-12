import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Action = { label: string; run: () => void };
type Toast = { id: number; text: string; kind: 'ok' | 'bad'; action?: Action };
type Show = (text: string, kind?: Toast['kind'], action?: Action) => void;
const ToastContext = createContext<Show>(() => {});

/** Short confirmation messages after an action, optionally with one action such as Undo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback<Show>((text, kind = 'ok', action) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind, action }]);
    setTimeout(() => dismiss(id), action ? 7000 : 3500);
  }, [dismiss]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            {t.action && (
              <button type="button" className="toast-action" onClick={() => { dismiss(t.id); t.action!.run(); }}>{t.action.label}</button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext);
