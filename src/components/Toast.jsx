import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);
const VISIBLE_MS = 5000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const toast = useCallback((message, kind = 'success') => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), VISIBLE_MS);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext).toast;

// Runs a one-off action, showing success or failure as a toast.
export function useRun() {
  const toast = useToast();

  return useCallback(async (action, successMessage) => {
    try {
      const result = await action();
      if (successMessage) toast(successMessage);
      return result;
    } catch (error) {
      toast(error.message, 'error');
      return undefined;
    }
  }, [toast]);
}
