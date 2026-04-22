"use client";

/**
 * Customer autocomplete — React hook.
 *
 * Shared data / debounce / open-close layer for new-customer-form,
 * booking-wizard, quote-send-panel, and customer-picker-drawer.
 * All correctness-critical logic lives in `./customer-autocomplete-core.ts`
 * as a pure reducer + pure helpers so it can be unit-tested under
 * `node --experimental-strip-types --test` without a React test framework.
 *
 * This file is the thin React wrapper: it wires the pure reducer into
 * useReducer, drives the fetch via useEffect, and mounts the
 * click-outside listener on a containerRef.
 *
 * All core types + helpers are re-exported from this file so consumers
 * import everything from `@/lib/use-customer-autocomplete`.
 *
 * Open/close contract (enforced in code; validated by the core test suite):
 *   - The hook MUST NOT open the dropdown. `isOpen` starts false and only
 *     transitions to true via an explicit `open()` call from the call site.
 *     No input-driven, query-driven, results-driven, or focus-driven auto-open.
 *   - The hook MAY close the dropdown. Close triggers live here:
 *       (a) click-outside via `containerRef` (when `isOpen` is true)
 *       (b) `reset()` — clears query/results/isLoading/isOpen atomically
 *     Call sites may also invoke `close()` directly.
 *   - Fetching is independent of `isOpen`. The fetch useEffect does not
 *     depend on isOpen, does not read isOpen, and does not dispatch OPEN.
 *
 * Cancellation invariant: any primitive that terminates user-facing work
 * (`reset`, `clearResults`) MUST cancel all pending work — abort in-flight
 * fetch (controller.abort()), invalidate late responses (requestId++), and
 * cancel scheduled timers (clearTimeout + null the ref). Primitives that do
 * NOT cancel (open, close, setQuery) either have no pending work to cancel
 * or operate on state where cancellation would be incorrect.
 *
 * Hook primitives fall into two buckets:
 *
 *   Termination primitives (reset, clearResults):
 *     - MUST abort in-flight fetches (controller.abort())
 *     - MUST invalidate late responses (requestId++)
 *     - MUST cancel scheduled timers (clearTimeout + null ref)
 *     - Differ only in which reducer action they dispatch
 *
 *   Non-termination primitives (setQuery, open, close):
 *     - MUST NOT cancel async work
 *     - setQuery triggers new debounced fetch via the fetch useEffect,
 *       whose own scheduleFetch handles timer reuse
 *     - open/close are pure state toggles
 *
 * New primitives added in the future must be explicitly classified into
 * one of these buckets, not implicitly chosen based on what looks easiest.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import {
  autocompleteReducer,
  INITIAL_AUTOCOMPLETE_STATE,
  scheduleFetch,
  shouldCommitResponse,
  shouldFetch,
  type CustomerSearchResult,
} from "@/lib/customer-autocomplete-core";

export {
  getCustomerDisplayName,
  autocompleteReducer,
  shouldCommitResponse,
  shouldFetch,
  scheduleFetch,
  INITIAL_AUTOCOMPLETE_STATE,
} from "@/lib/customer-autocomplete-core";

export type {
  CustomerSearchAddress,
  CustomerSearchResult,
  AutocompleteState,
  AutocompleteAction,
  TimerPrimitives,
  MutableRef,
} from "@/lib/customer-autocomplete-core";

// ============================================================================
// Hook public surface
// ============================================================================

export interface UseCustomerAutocompleteOptions {
  /** Debounce for query → fetch. Default 250 ms. */
  debounceMs?: number;
  /** Minimum trimmed query length before firing a fetch. Default 2. */
  minQueryLength?: number;
  /**
   * `limit=` value passed to the endpoint. Default 5 — matches existing
   * behavior of NCF / BW / QSP. customer-picker-drawer passes 8 explicitly.
   */
  maxResults?: number;
  /**
   * Gate for fetching. When false the hook suppresses fetches. Useful for
   * "stop searching once a customer is selected." Default true.
   */
  enabled?: boolean;
}

export interface UseCustomerAutocompleteReturn {
  query: string;
  setQuery: (q: string) => void;
  results: CustomerSearchResult[];
  isLoading: boolean;

  isOpen: boolean;
  open: () => void;
  close: () => void;

  containerRef: React.RefObject<HTMLDivElement | null>;

  reset: () => void;
  /**
   * Termination primitive. Clears fetch-derived state (results + isLoading)
   * while preserving caller-owned state (query text, isOpen). Cancels any
   * in-flight fetch and any scheduled debounce timer — see the
   * Cancellation invariant in the top-of-file comment.
   */
  clearResults: () => void;
}

export function useCustomerAutocomplete(
  options?: UseCustomerAutocompleteOptions,
): UseCustomerAutocompleteReturn {
  const debounceMs = options?.debounceMs ?? 250;
  const minQueryLength = options?.minQueryLength ?? 2;
  const maxResults = options?.maxResults ?? 5;
  const enabled = options?.enabled ?? true;

  const [state, dispatch] = useReducer(
    autocompleteReducer,
    INITIAL_AUTOCOMPLETE_STATE,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<unknown>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const setQuery = useCallback((q: string) => {
    dispatch({ type: "SET_QUERY", query: q });
  }, []);

  const open = useCallback(() => {
    dispatch({ type: "OPEN" });
  }, []);

  const close = useCallback(() => {
    dispatch({ type: "CLOSE" });
  }, []);

  // Termination primitives — reset and clearResults share cancellation
  // semantics; their bodies are structurally identical except for the
  // dispatched action type. See the Cancellation invariant + bucket
  // classification in the top-of-file comment. Any divergence is a bug.
  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    requestIdRef.current++;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current as ReturnType<typeof setTimeout>);
      debounceTimerRef.current = null;
    }
    dispatch({ type: "RESET" });
  }, []);

  const clearResults = useCallback(() => {
    abortControllerRef.current?.abort();
    requestIdRef.current++;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current as ReturnType<typeof setTimeout>);
      debounceTimerRef.current = null;
    }
    dispatch({ type: "CLEAR_RESULTS" });
  }, []);

  // Fetch effect — deliberately does NOT include isOpen in the dep array,
  // does NOT read isOpen in the body, and does NOT dispatch OPEN. Fetch
  // lifecycle is decoupled from dropdown visibility. Call sites control
  // open timing.
  useEffect(() => {
    if (!shouldFetch({ query: state.query, minQueryLength, enabled })) {
      return;
    }

    const myRequestId = ++requestIdRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    scheduleFetch({
      timerRef: debounceTimerRef,
      ms: debounceMs,
      fn: () => {
        dispatch({ type: "FETCH_START" });
        api
          .get<CustomerSearchResult[]>(
            `/customers/search?q=${encodeURIComponent(state.query.trim())}&limit=${maxResults}`,
            { signal: controller.signal },
          )
          .then((res) => {
            if (
              !shouldCommitResponse({
                currentRequestId: requestIdRef.current,
                responseRequestId: myRequestId,
                aborted: controller.signal.aborted,
              })
            ) {
              return;
            }
            dispatch({
              type: "FETCH_SUCCESS",
              results: Array.isArray(res) ? res : [],
            });
          })
          .catch((err: unknown) => {
            // Silently swallow AbortError — expected on reset / supersession
            // / unmount. Native DOMException thrown by aborted fetch has
            // .name === "AbortError".
            if (
              err &&
              typeof err === "object" &&
              "name" in err &&
              (err as { name?: string }).name === "AbortError"
            ) {
              return;
            }
            if (
              !shouldCommitResponse({
                currentRequestId: requestIdRef.current,
                responseRequestId: myRequestId,
                aborted: controller.signal.aborted,
              })
            ) {
              return;
            }
            console.error("[useCustomerAutocomplete] fetch failed", err);
            dispatch({ type: "FETCH_ERROR" });
          });
      },
    });

    return () => {
      controller.abort();
      if (
        debounceTimerRef.current !== null &&
        debounceTimerRef.current !== undefined
      ) {
        clearTimeout(
          debounceTimerRef.current as ReturnType<typeof setTimeout>,
        );
        debounceTimerRef.current = null;
      }
    };
  }, [state.query, enabled, minQueryLength, maxResults, debounceMs]);

  // Click-outside — strictly gated on isOpen. Listener attaches on open
  // transition, detaches on close transition or unmount. No listener
  // while !isOpen.
  useEffect(() => {
    if (!state.isOpen) return;
    const handler = (e: MouseEvent) => {
      const container = containerRef.current;
      if (container && !container.contains(e.target as Node)) {
        dispatch({ type: "CLOSE" });
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [state.isOpen]);

  return {
    query: state.query,
    setQuery,
    results: state.results,
    isLoading: state.isLoading,
    isOpen: state.isOpen,
    open,
    close,
    containerRef,
    reset,
    clearResults,
  };
}
