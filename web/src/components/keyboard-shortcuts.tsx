"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

const SHORTCUTS = [
  { key: "B", description: "Quick Quote" },
  { key: "←  →", description: "Navigate dates (dispatch/schedule)" },
  { key: "T", description: "Jump to today" },
  { key: "?", description: "Show this guide" },
  { key: "ESC", description: "Close modal / panel" },
];

export default function KeyboardShortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 shadow-2xl w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-semibold text-[var(--t-text-primary)]">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between">
              <span className="text-sm text-[var(--t-text-primary)]">{s.description}</span>
              <kbd className="inline-flex items-center gap-1 rounded-md border border-[var(--t-border)] bg-[var(--t-bg-primary)] px-2 py-1 font-mono text-xs text-[var(--t-text-muted)]">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
