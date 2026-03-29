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
  const color = toast.type === "success" ? "text-brand" : toast.type === "error" ? "text-red-400" : "text-yellow-400";
  const bg = toast.type === "success" ? "bg-brand/10" : toast.type === "error" ? "bg-red-500/10" : "bg-yellow-500/10";

  return (
    <div className={`pointer-events-auto flex items-center gap-3 rounded-xl border border-[#1E2D45] ${bg} bg-dark-secondary px-4 py-3 shadow-xl shadow-black/20 animate-in slide-in-from-right-5`}>
      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
      <p className="text-sm text-foreground">{toast.message}</p>
      <button onClick={() => onDismiss(toast.id)} className="ml-2 shrink-0 text-muted hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
