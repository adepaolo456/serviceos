"use client";

import { useState, useRef, useEffect, useId } from "react";
import { getFeature, isRegisteredFeature } from "@/lib/feature-registry";

interface HelpTooltipProps {
  featureId?: string;
  text?: string;
  placement?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export default function HelpTooltip({
  featureId,
  text,
  placement = "top",
  className,
}: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dev-time warning for unregistered feature IDs
  if (featureId && typeof window !== "undefined" && process.env.NODE_ENV === "development" && !isRegisteredFeature(featureId)) {
    console.warn(`[HelpTooltip] featureId "${featureId}" not found in FEATURE_REGISTRY`);
  }

  const content = text || (featureId ? getFeature(featureId)?.shortDescription : "") || "";
  if (!content) return null;

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 200);
  };

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  // Dismiss on outside click (mobile tap-away)
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible]);

  // Arrow position
  const arrowStyle: Record<string, React.CSSProperties> = {
    top: { bottom: -5, left: "50%", transform: "translateX(-50%) rotate(45deg)" },
    bottom: { top: -5, left: "50%", transform: "translateX(-50%) rotate(45deg)" },
    left: { right: -5, top: "50%", transform: "translateY(-50%) rotate(45deg)" },
    right: { left: -5, top: "50%", transform: "translateY(-50%) rotate(45deg)" },
  };

  const tooltipPosition: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span className={`relative inline-flex ${className || ""}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Help"
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => setVisible(v => !v)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold transition-all focus:outline-none focus:ring-1 focus:ring-[var(--t-accent)]"
        style={{
          background: "var(--t-bg-elevated)",
          color: "var(--t-text-muted)",
          border: "1px solid var(--t-border)",
          cursor: "help",
        }}
      >
        ?
      </button>
      {visible && (
        <div
          id={tooltipId}
          role="tooltip"
          className={`absolute z-[9999] ${tooltipPosition[placement]}`}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="relative rounded-[10px] px-3 py-2 text-[12px] leading-relaxed"
            style={{
              background: "var(--t-bg-elevated)",
              color: "var(--t-text-primary)",
              border: "1px solid var(--t-border)",
              boxShadow: "0 4px 16px var(--t-shadow)",
              maxWidth: 280,
              minWidth: 160,
            }}
          >
            {content}
            <div
              className="absolute w-2.5 h-2.5"
              style={{
                background: "var(--t-bg-elevated)",
                borderRight: "1px solid var(--t-border)",
                borderBottom: "1px solid var(--t-border)",
                ...arrowStyle[placement],
              }}
            />
          </div>
        </div>
      )}
    </span>
  );
}
