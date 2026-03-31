"use client";

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";

type ToastType = "success" | "error" | "warning";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const Icon = toast.type === "success" ? CheckCircle2 : toast.type === "error" ? XCircle : AlertTriangle;
  const color = toast.type === "success" ? "var(--t-accent)" : toast.type === "error" ? "var(--t-error)" : "var(--t-warning)";

  return (
    <div
      className="pointer-events-auto flex items-center gap-3 rounded-[20px] px-4 py-3 animate-slide-in-right"
      style={{
        backgroundColor: "var(--t-bg-secondary)",
        border: "1px solid var(--t-border)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
      }}
    >
      <Icon className="h-5 w-5 shrink-0" style={{ color }} />
      <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{toast.message}</p>
      <button onClick={() => onDismiss(toast.id)} className="ml-2 shrink-0" style={{ color: "var(--t-text-muted)" }}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
