"use client";

/**
 * List view state restoration.
 *
 * Long operational list pages in ServiceOS (Rental Lifecycles, Assets,
 * etc.) lose the user's working position on every detail round-trip:
 * the dispatcher scrolls halfway down, expands a chain, clicks a
 * child job, hits Back — and lands at the top of the list again. The
 * history-first back navigation already returns them to the correct
 * PAGE; this module fixes the "correct POSITION on the page" half.
 *
 * Design:
 *
 *   1. `saveListViewState(pageKey, extra)` — call this from a list
 *      row's click handler RIGHT BEFORE `router.push(...)`. It
 *      snapshots `window.scrollY` plus any page-specific "extra"
 *      state (expanded rows, active tab, etc.) into sessionStorage.
 *
 *   2. `useListViewScrollRestore(pageKey, ready, onExtra)` — a
 *      read-once effect on the list page. When the list's data has
 *      finished loading (`ready` flips true), it reads any saved
 *      state for this page, hands the caller the extra payload via
 *      `onExtra` so the page can re-expand rows / restore filters,
 *      then scrolls the window back to the saved position on the
 *      next animation frame.
 *
 * Why sessionStorage and not the Next.js router cache:
 *
 *   • SessionStorage is per-tab and cleared on tab close, so two
 *     tabs of the same page don't fight each other for scroll
 *     position and refreshing a page doesn't resurrect stale state.
 *
 *   • It survives `router.push` / `router.back()` round-trips within
 *     the tab, which is exactly the flow we want to fix.
 *
 *   • It gives us a clean 10-minute TTL cutoff so state doesn't
 *     feel "haunted" hours later if the user leaves the tab idle.
 *
 *   • We don't have to fight React state lifecycles — each list
 *     page owns its own view state and just reaches into
 *     sessionStorage at the relevant moments.
 *
 * Page scoping: every saved entry is keyed by a page-specific string
 * (`/jobs`, `/assets`, etc.). State never leaks across unrelated
 * pages because each page reads and writes only its own key.
 *
 * SSR safety: every function checks `typeof window !== "undefined"`
 * so they're safe to import from any client component without
 * conditional guards at the call site.
 *
 * Failure modes: sessionStorage can throw in private browsing mode,
 * when quota is exceeded, or when the parsed state is malformed.
 * Every helper swallows those errors and degrades to "no restore" —
 * the user lands at the top of the list, which is the same as the
 * pre-fix behavior, never worse.
 */

import { useEffect, useRef } from "react";

const STORAGE_PREFIX = "list-view-state:";
/** Discard saved state older than this on restore. */
const MAX_AGE_MS = 1000 * 60 * 10; // 10 minutes

interface SavedState<T> {
  scrollY: number;
  extra: T;
  savedAt: number;
}

function storageKey(pageKey: string): string {
  return `${STORAGE_PREFIX}${pageKey}`;
}

/**
 * Snapshot the current list view state into sessionStorage.
 *
 * Call this from a row/detail-navigation click handler, *immediately
 * before* calling `router.push`. The handler pattern looks like:
 *
 *   onClick={() => {
 *     saveListViewState("/jobs", { expandedChainIds: [...expanded] });
 *     router.push(`/jobs/${job.id}`);
 *   }}
 *
 * The `extra` argument is opaque to this util — whatever the page
 * needs to restore beyond scroll position. Must be JSON-serializable.
 */
export function saveListViewState<T>(pageKey: string, extra: T): void {
  if (typeof window === "undefined") return;
  const state: SavedState<T> = {
    scrollY: window.scrollY,
    extra,
    savedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(storageKey(pageKey), JSON.stringify(state));
  } catch {
    // Private mode / quota / serialization failure — non-critical.
    // Worst case: the next back-navigation lands at the top.
  }
}

/**
 * Read + remove any saved list view state for this page. Returns
 * `null` if nothing is saved, the state is older than `MAX_AGE_MS`,
 * or the stored payload is malformed.
 *
 * The state is consumed on read — subsequent calls return null.
 * This matches the "restore once" semantics we want: the user
 * navigates back, the list restores to where they were, and any
 * further scroll events start fresh.
 */
export function consumeListViewState<T>(pageKey: string): SavedState<T> | null {
  if (typeof window === "undefined") return null;
  const key = storageKey(pageKey);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    const parsed = JSON.parse(raw) as SavedState<T>;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    // Clean up anything malformed so we don't fight it forever.
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* no-op */
    }
    return null;
  }
}

/**
 * Hook: restore scroll position and any extra state for this page
 * once the list's data is ready to render.
 *
 *   const [loading, setLoading] = useState(true);
 *   // ... fetch ...
 *   useListViewScrollRestore("/jobs", !loading, (extra) => {
 *     if (extra?.expandedChainIds) setExpandedChains(new Set(extra.expandedChainIds));
 *   });
 *
 * The restore happens exactly once per mount — even if `ready`
 * flips on/off (e.g. a background refetch), we never clobber the
 * user's current scroll position again after the initial restore.
 *
 * The extra callback fires synchronously inside the effect so the
 * caller can apply state (like expanded row ids) BEFORE the scroll
 * happens. The scroll is deferred one animation frame so the DOM
 * has a chance to reflow with the newly-restored extra state —
 * otherwise `scrollY` would be clipped by a shorter document height
 * (e.g. pre-expansion).
 */
export function useListViewScrollRestore<T>(
  pageKey: string,
  ready: boolean,
  onExtra?: (extra: T) => void,
): void {
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const state = consumeListViewState<T>(pageKey);
    if (!state) return;
    if (onExtra) onExtra(state.extra);
    // Defer until next frame so any DOM mutations from `onExtra`
    // (expanded rows, etc.) have flushed and the document height is
    // long enough for the target scrollY to land.
    requestAnimationFrame(() => {
      window.scrollTo({ top: state.scrollY, behavior: "auto" });
    });
  }, [ready, pageKey, onExtra]);
}
