import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { appBridge, type ToastKind } from "../api/appBridge";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastValue {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    appBridge.toast = show;
    return () => {
      appBridge.toast = () => {};
    };
  }, [show]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={[
              "pointer-events-auto w-full max-w-md rounded-lg border px-4 py-3 text-sm font-medium shadow-sm",
              t.kind === "error"
                ? "border-[var(--color-loss)] bg-white text-[var(--color-loss)]"
                : t.kind === "success"
                  ? "border-[var(--color-win)] bg-white text-[var(--color-ink)]"
                  : "border-[var(--color-line)] bg-white text-[var(--color-ink)]",
            ].join(" ")}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
