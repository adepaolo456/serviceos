"use client";

import { useState, useRef, useEffect, type ReactNode, type CSSProperties } from "react";

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}

// Menu is rendered with position: fixed so it escapes every ancestor
// overflow clip box (tables with `overflow: hidden`, horizontally-
// scrollable `.table-scroll` wrappers, rounded-corner card masks, etc.).
// A prior implementation used `position: absolute` + `right-0`/`left-0`,
// which left the menu trapped inside the nearest clipping ancestor —
// every row-dropdown inside a rounded table was silently cut off.
//
// position: fixed escapes clip boxes UNLESS an ancestor has one of
// transform/filter/perspective/will-change/contain/backdrop-filter
// applied, in which case that ancestor becomes the containing block for
// fixed descendants. All current call sites were audited clear of
// ancestor traps before this refactor (Item: Dropdown Clipping Fix).
// Any new caller that renders a Dropdown inside a CSS-transformed
// wrapper (dnd-kit draggable, scale animations, etc.) will need to move
// the Dropdown outside that wrapper or switch to React.createPortal
// here.

type Coords = { top: number; left?: number; right?: number };

// Fallback dimensions used when the menu hasn't mounted yet on first
// open. Match the CSS `min-w-[160px]` and a reasonable default height;
// real measurements replace these on the next frame.
const FALLBACK_MENU_WIDTH = 160;
const FALLBACK_MENU_HEIGHT = 200;
const VIEWPORT_MARGIN = 8;

export default function Dropdown({ trigger, children, align = "left", className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"down" | "up">("down");
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position calculation. Runs when `open` flips to true and re-runs
  // once menu dimensions are actually available (Strategy A —
  // requestAnimationFrame re-measure).
  useEffect(() => {
    if (!open || !triggerRef.current) return;

    const compute = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight || FALLBACK_MENU_HEIGHT;
      const menuWidth = menuRef.current?.offsetWidth || FALLBACK_MENU_WIDTH;

      // Vertical flip — identical semantics to the pre-refactor version.
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeUp = spaceBelow < menuHeight + VIEWPORT_MARGIN;
      setDirection(placeUp ? "up" : "down");

      const top = placeUp ? rect.top - menuHeight - 4 : rect.bottom + 4;

      // Horizontal — honor `align`, then clamp to viewport so a long
      // menu near an edge doesn't trade ancestor-clipping for
      // viewport-clipping.
      if (align === "right") {
        let right = window.innerWidth - rect.right;
        if (right < VIEWPORT_MARGIN) right = VIEWPORT_MARGIN;
        // If the left edge would fall off-screen, pull `right` inward so
        // the menu fits within the viewport.
        if (window.innerWidth - right - menuWidth < VIEWPORT_MARGIN) {
          right = window.innerWidth - menuWidth - VIEWPORT_MARGIN;
        }
        setCoords({ top, right });
      } else {
        let left = rect.left;
        if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
        if (left + menuWidth > window.innerWidth - VIEWPORT_MARGIN) {
          left = window.innerWidth - menuWidth - VIEWPORT_MARGIN;
        }
        setCoords({ top, left });
      }
    };

    // First pass with whatever dimensions are available (often the
    // fallbacks — menu hasn't mounted yet).
    compute();

    // Strategy A — re-measure on the next frame once the menu has
    // mounted and real offsetHeight/offsetWidth are available. Avoids
    // the visible-jump glitch where a bottom-of-viewport trigger gets
    // placed "down" using the fallback height, overflows, then snaps
    // "up" on the second render.
    const raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [open, align]);

  // Click-outside close — unchanged semantics from the pre-refactor
  // version. Both refs are still reachable because the fixed-positioned
  // menu is still rendered inside this component's subtree.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape key close — unchanged.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Close on scroll — REQUIRED. Under position: fixed the menu would
  // otherwise stay pinned to the viewport while the trigger scrolls
  // away. capture:true catches scroll on any ancestor (table-scroll
  // wrappers, modal bodies, etc.), not just the window.
  useEffect(() => {
    if (!open) return;
    const handleScroll = () => setOpen(false);
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  // Close on resize — computed coords would otherwise become stale.
  // Closing is simpler (and more predictable UX) than recomputing.
  useEffect(() => {
    if (!open) return;
    const handleResize = () => setOpen(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open]);

  const menuStyle: CSSProperties = {
    position: "fixed",
    top: coords?.top,
    left: coords?.left,
    right: coords?.right,
    backgroundColor: "var(--t-bg-secondary)",
    border: "1px solid var(--t-border)",
    boxShadow: "0 8px 30px var(--t-shadow)",
    // Hide during the first paint before coords are computed, then
    // reveal on the measured pass. Prevents a 1-frame flash at (0,0)
    // when the fallback compute() hasn't landed real coordinates yet.
    visibility: coords ? "visible" : "hidden",
  };

  return (
    <div className="relative" ref={triggerRef}>
      <div onClick={() => setOpen(!open)} className="cursor-pointer">
        {trigger}
      </div>
      {open && (
        <div
          ref={menuRef}
          className={`z-50 min-w-[160px] max-h-[280px] overflow-y-auto rounded-[16px] overflow-hidden animate-dropdown ${direction === "up" ? "origin-bottom" : "origin-top"} ${className || ""}`}
          style={menuStyle}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
