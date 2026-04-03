"use client";

import { useState, useRef, useEffect, useId, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getFeature, isRegisteredFeature } from "@/lib/feature-registry";

interface HelpTooltipProps {
  featureId?: string;
  text?: string;
  placement?: "top" | "right" | "bottom" | "left";
  className?: string;
}

type Placement = "top" | "right" | "bottom" | "left";

const MARGIN = 10; // px from viewport edges
const TOOLTIP_W = 280; // max-width estimate for clamping
const TOOLTIP_H = 60; // approximate height estimate
const GAP = 8;

const FLIP: Record<Placement, Placement> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function computeAnchor(rect: DOMRect, p: Placement): { top: number; left: number } {
  if (p === "top") return { top: rect.top - GAP, left: rect.left + rect.width / 2 };
  if (p === "bottom") return { top: rect.bottom + GAP, left: rect.left + rect.width / 2 };
  if (p === "left") return { top: rect.top + rect.height / 2, left: rect.left - GAP };
  return { top: rect.top + rect.height / 2, left: rect.right + GAP };
}

function fitsViewport(anchor: { top: number; left: number }, p: Placement): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (p === "top") return anchor.top - TOOLTIP_H > MARGIN;
  if (p === "bottom") return anchor.top + TOOLTIP_H < vh - MARGIN;
  if (p === "left") return anchor.left - TOOLTIP_W > MARGIN;
  return anchor.left + TOOLTIP_W < vw - MARGIN;
}

function clamp(anchor: { top: number; left: number }, p: Placement): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let { top, left } = anchor;

  // Horizontal clamping for top/bottom placements
  if (p === "top" || p === "bottom") {
    const halfW = TOOLTIP_W / 2;
    if (left - halfW < MARGIN) left = MARGIN + halfW;
    if (left + halfW > vw - MARGIN) left = vw - MARGIN - halfW;
  }

  // Vertical clamping for left/right placements
  if (p === "left" || p === "right") {
    const halfH = TOOLTIP_H / 2;
    if (top - halfH < MARGIN) top = MARGIN + halfH;
    if (top + halfH > vh - MARGIN) top = vh - MARGIN - halfH;
  }

  return { top, left };
}

const TRANSFORM: Record<Placement, string> = {
  top: "translate(-50%, -100%)",
  bottom: "translate(-50%, 0)",
  left: "translate(-100%, -50%)",
  right: "translate(0, -50%)",
};

const ARROW: Record<Placement, React.CSSProperties> = {
  top: { bottom: -5, left: "50%", transform: "translateX(-50%) rotate(45deg)" },
  bottom: { top: -5, left: "50%", transform: "translateX(-50%) rotate(45deg)" },
  left: { right: -5, top: "50%", transform: "translateY(-50%) rotate(45deg)" },
  right: { left: -5, top: "50%", transform: "translateY(-50%) rotate(45deg)" },
};

export default function HelpTooltip({
  featureId,
  text,
  placement = "top",
  className,
}: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [effectivePlacement, setEffectivePlacement] = useState<Placement>(placement);
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dev-time warning for unregistered feature IDs
  if (featureId && typeof window !== "undefined" && process.env.NODE_ENV === "development" && !isRegisteredFeature(featureId)) {
    console.warn(`[HelpTooltip] featureId "${featureId}" not found in FEATURE_REGISTRY`);
  }

  const feature = featureId ? getFeature(featureId) : undefined;
  const content = text || feature?.shortDescription || "";
  if (!content) return null;
  const showLearnMore = featureId && feature?.isGuideEligible;

  const computePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();

    // Try preferred placement, flip if it doesn't fit
    let p: Placement = placement;
    let anchor = computeAnchor(rect, p);
    if (!fitsViewport(anchor, p)) {
      const flipped = FLIP[p];
      const flippedAnchor = computeAnchor(rect, flipped);
      if (fitsViewport(flippedAnchor, flipped)) {
        p = flipped;
        anchor = flippedAnchor;
      }
      // If neither fits, keep preferred and clamp
    }

    const clamped = clamp(anchor, p);
    setPos(clamped);
    setEffectivePlacement(p);
  }, [placement]);

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      computePosition();
      setVisible(true);
    }, 200);
  };

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  // Dismiss on outside click (mobile tap-away)
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node)
      ) {
        setVisible(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible]);

  // Dismiss on scroll, reposition on resize
  useEffect(() => {
    if (!visible) return;
    const onScroll = () => setVisible(false);
    const onResize = () => computePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [visible, computePosition]);

  return (
    <>
      <span className={`inline-flex ${className || ""}`}>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Help"
          aria-describedby={visible ? tooltipId : undefined}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          onClick={() => { if (visible) hide(); else { computePosition(); setVisible(true); } }}
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
      </span>
      {visible && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            transform: TRANSFORM[effectivePlacement],
            zIndex: 99999,
          }}
        >
          <div
            className="relative rounded-[10px] px-3 py-2 text-[12px] leading-relaxed"
            style={{
              background: "var(--t-bg-elevated)",
              color: "var(--t-text-primary)",
              border: "1px solid var(--t-border)",
              boxShadow: "0 4px 16px var(--t-shadow)",
              maxWidth: TOOLTIP_W,
              minWidth: 160,
            }}
          >
            {content}
            {showLearnMore && (
              <Link
                href={`/help?feature=${featureId}`}
                onClick={() => setVisible(false)}
                className="block text-[11px] font-medium mt-1.5"
                style={{ color: "var(--t-accent)" }}
              >
                Learn more →
              </Link>
            )}
            <div
              className="absolute w-2.5 h-2.5"
              style={{
                background: "var(--t-bg-elevated)",
                borderRight: "1px solid var(--t-border)",
                borderBottom: "1px solid var(--t-border)",
                ...ARROW[effectivePlacement],
              }}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
