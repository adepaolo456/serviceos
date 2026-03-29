"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function SlideOver({
  open,
  onClose,
  title,
  children,
}: SlideOverProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg bg-dark-secondary shadow-2xl animate-slide-in-right">
        <div className="flex h-16 items-center justify-between border-b border-[#1E2D45] px-6">
          <h2 className="font-display text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-all hover:bg-dark-card hover:text-white active:scale-90"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="h-[calc(100vh-4rem)] overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
