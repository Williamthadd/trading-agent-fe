import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  tone?: ToastTone;
  /** Set to zero to keep the toast visible until it is dismissed. */
  durationMs?: number;
}

export interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

export interface ToastProviderProps {
  children: ReactNode;
  maxToasts?: number;
  defaultDurationMs?: number;
}

interface ToastRecord {
  id: string;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let fallbackToastId = 0;

function createToastId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  fallbackToastId += 1;
  return `toast-${Date.now()}-${fallbackToastId}`;
}

export function ToastProvider({
  children,
  maxToasts = 5,
  defaultDurationMs = 4_500,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());

  const clearTimer = useCallback((id: string) => {
    const timerId = timers.current.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timers.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [clearTimer],
  );

  const clearToasts = useCallback(() => {
    for (const timerId of timers.current.values()) {
      window.clearTimeout(timerId);
    }
    timers.current.clear();
    setToasts([]);
  }, []);

  const showToast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = createToastId();
      const tone = options.tone ?? "info";
      const durationMs = Math.max(0, options.durationMs ?? defaultDurationMs);
      const toast: ToastRecord = { id, message, tone };

      setToasts((current) => {
        const next = [...current, toast];
        const overflow = Math.max(0, next.length - Math.max(1, maxToasts));
        for (const removed of next.slice(0, overflow)) {
          clearTimer(removed.id);
        }
        return next.slice(overflow);
      });

      if (durationMs > 0) {
        const timerId = window.setTimeout(() => dismissToast(id), durationMs);
        timers.current.set(id, timerId);
      }

      return id;
    },
    [clearTimer, defaultDurationMs, dismissToast, maxToasts],
  );

  useEffect(() => clearToasts, [clearToasts]);

  const value = useMemo(
    () => ({ showToast, dismissToast, clearToasts }),
    [clearToasts, dismissToast, showToast],
  );
  const politeToasts = toasts.filter((toast) => toast.tone !== "error");
  const assertiveToasts = toasts.filter((toast) => toast.tone === "error");

  const renderToast = (toast: ToastRecord) => (
    <li className={`toast toast--${toast.tone}`} key={toast.id}>
      <span className="toast__mark" aria-hidden="true" />
      <p>{toast.message}</p>
      <button
        className="toast__dismiss"
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
      >
        ×
      </button>
    </li>
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <aside className="toast-region" aria-label="Notifications">
        <ul className="toast-list" aria-live="polite" aria-relevant="additions text">
          {politeToasts.map(renderToast)}
        </ul>
        <ul
          className="toast-list"
          aria-live="assertive"
          aria-relevant="additions text"
        >
          {assertiveToasts.map(renderToast)}
        </ul>
      </aside>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
