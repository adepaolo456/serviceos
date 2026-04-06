"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  headerActions?: ReactNode;
  side?: "left" | "right";
}

export default function SlideOver({ open, onClose, title, children, headerActions, side = "right" }: SlideOverProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-50 flex ${side === "left" ? "justify-start" : "justify-end"}`}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        className={`relative w-full max-w-lg shadow-2xl ${side === "left" ? "animate-slide-in-left rounded-r-[20px]" : "animate-slide-in-right rounded-l-[20px]"}`}
        style={{ backgroundColor: "var(--t-bg-secondary)", ...(side === "left" ? { borderRight: "1px solid var(--t-border)" } : { borderLeft: "1px solid var(--t-border)" }) }}
      >
        <div
          className="flex h-14 items-center justify-between px-6"
          style={{ borderBottom: "1px solid var(--t-border)" }}
        >
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--t-text-primary)" }}>
            {title}
          </h2>
          <div className="flex items-center gap-2">
          {headerActions}
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors duration-150"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <X className="h-5 w-5" />
          </button>
          </div>
        </div>
        <div className="h-[calc(100vh-3.5rem)] overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
