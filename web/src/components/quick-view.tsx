"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface QuickViewProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export default function QuickView({
  isOpen,
  onClose,
  title,
  subtitle,
  actions,
  footer,
  children,
}: QuickViewProps) {
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-2xl shadow-2xl animate-slide-in-right flex flex-col"
        style={{ backgroundColor: "var(--t-bg-secondary)" }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--t-border)" }}
        >
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold truncate" style={{ color: "var(--t-text-primary)" }}>{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs truncate" style={{ color: "var(--t-text-muted)" }}>{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 transition-all active:scale-90"
              style={{ color: "var(--t-text-muted)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-3 shrink-0" style={{ borderTop: "1px solid var(--t-border)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- QuickView skeleton for loading states ---- */
export function QuickViewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-5 w-48 skeleton rounded" />
      <div className="h-4 w-full skeleton rounded" />
      <div className="h-4 w-3/4 skeleton rounded" />
      <div className="h-32 w-full skeleton rounded-lg mt-4" />
      <div className="h-4 w-1/2 skeleton rounded" />
      <div className="h-4 w-2/3 skeleton rounded" />
    </div>
  );
}
