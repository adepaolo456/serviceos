"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight invalidation signal for lifecycle mutations.
 *
 * The rentals lifecycle page calls `broadcastLifecycleChange()` after
 * any mutation (delivery edit, pickup edit, exchange create/edit,
 * extend, status change). Views that render lifecycle-derived data —
 * the dispatch board, driver route, job list — subscribe via
 * `useLifecycleSync` and refetch immediately.
 *
 * Why not WebSockets: the API runs on Vercel serverless; there's no
 * persistent connection layer. Polling + BroadcastChannel + browser
 * visibility/focus refresh covers multi-tab and background-refocus
 * cases without any server-side session state.
 *
 * Transport:
 *   1. In-tab EventTarget (same tab, different page).
 *   2. BroadcastChannel (cross-tab, same origin) when available.
 *   3. localStorage `storage` event fallback (Safari iOS / older
 *      browsers without BroadcastChannel).
 */

const CHANNEL_NAME = "lifecycle-sync";
const STORAGE_KEY = "lifecycle-sync-ping";

export type LifecycleChangePayload = {
  chainId?: string;
  at: number;
};

type Listener = (p: LifecycleChangePayload) => void;

const listeners = new Set<Listener>();

let channel: BroadcastChannel | null = null;
let storageListenerBound = false;

function ensureBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent) => {
    const p = e.data as LifecycleChangePayload;
    for (const l of listeners) l(p);
  };
  return channel;
}

function ensureStorageListener() {
  if (storageListenerBound || typeof window === "undefined") return;
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const p = JSON.parse(e.newValue) as LifecycleChangePayload;
      for (const l of listeners) l(p);
    } catch {
      /* ignore parse errors */
    }
  });
  storageListenerBound = true;
}

/**
 * Fire a lifecycle-change signal. Called by mutation handlers after
 * a successful API write. Safe to call on SSR (no-ops).
 */
export function broadcastLifecycleChange(chainId?: string) {
  if (typeof window === "undefined") return;
  const payload: LifecycleChangePayload = { chainId, at: Date.now() };
  // 1. In-tab — run synchronously so same-tab views invalidate
  //    before the next render even if BroadcastChannel is missing.
  for (const l of listeners) l(payload);
  // 2. Cross-tab via BroadcastChannel
  const ch = ensureBroadcastChannel();
  if (ch) {
    try {
      ch.postMessage(payload);
    } catch {
      /* ignore post failures (e.g. channel closed) */
    }
  }
  // 3. Fallback — always write to localStorage so even a tab without
  //    BroadcastChannel support still hears the ping.
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / privacy mode */
  }
}

/**
 * Subscribe a callback to lifecycle-change signals. The callback is
 * stored by reference via a ref so the subscription is stable for the
 * lifetime of the component — callers don't need to wrap in
 * `useCallback`.
 */
export function useLifecycleSync(cb: Listener): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    ensureBroadcastChannel();
    ensureStorageListener();
    const handler: Listener = (p) => ref.current(p);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);
}

/**
 * Fire a callback whenever the tab becomes visible or regains focus.
 * Used alongside polling to guarantee a refetch when the operator
 * backgrounds the tab for longer than the polling interval.
 */
export function useVisibilityRefresh(cb: () => void): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    const onFocus = () => ref.current();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
