/**
 * Customer autocomplete — pure core module.
 *
 * Contains all correctness-critical logic for the shared customer-search
 * hook (reducer state machine, stale-response guards, fetch gates, timer
 * hygiene, display-name derivation, result types). Deliberately contains
 * NO React imports, NO network client imports (`api`), and NO DOM
 * references, so the module can be imported and executed by Node's
 * built-in `node:test` runner under `--experimental-strip-types` without
 * pulling in a React test framework.
 *
 * Why split this out of `use-customer-autocomplete.ts`?
 *   - The `web/` project intentionally has no test framework installed
 *     (no vitest, jest, @testing-library/react, jsdom). The existing
 *     test convention — see `web/src/lib/lifecycle-pickup.test.ts` —
 *     uses `node --experimental-strip-types --test` on pure-TS modules.
 *   - The React hook must import `react` and the `@/lib/api` client via
 *     the `@/*` tsconfig path alias. Node's test runner does NOT resolve
 *     tsconfig path aliases, so a test that imports the hook file would
 *     fail at module-load time on the `@/lib/api` specifier.
 *   - Splitting the pure logic here, and having the hook file re-export
 *     it, means tests target this file only. Consumers still import
 *     everything from `use-customer-autocomplete.ts` — the re-exports
 *     keep the public surface unchanged.
 *
 * DO NOT "simplify" by folding this back into the hook file, and DO NOT
 * replace the reducer with ad-hoc useState in the hook. The reducer
 * encodes locked invariants (SET_QUERY must not touch results / isLoading
 * / isOpen; only OPEN sets isOpen=true; RESET clears all four) that are
 * validated by the `customer-autocomplete-core.test.ts` suite.
 */

// ============================================================================
// Result types — mirror the backend QueryBuilder selection in
// api/src/modules/customers/customers.service.ts#search (id, account_id,
// first_name, last_name, company_name, type, email, phone, billing_address,
// service_addresses). Addresses are stored as jsonb on the Customer entity;
// the union of fields read across all four call sites is covered here.
// ============================================================================

export interface CustomerSearchAddress {
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface CustomerSearchResult {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  company_name?: string | null;
  type?: string | null;
  email: string;
  phone: string;
  billing_address?: CustomerSearchAddress | null;
  service_addresses?: CustomerSearchAddress[] | null;
}

// ============================================================================
// Display-name helper — COALESCE("first last", company_name). Exported so
// call sites can reuse it for non-dropdown contexts (e.g., chip labels).
// ============================================================================

export function getCustomerDisplayName(
  c: Pick<CustomerSearchResult, "first_name" | "last_name" | "company_name">,
): string {
  const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  if (full) return full;
  return c.company_name ?? "";
}

// ============================================================================
// Reducer — pure state machine. Locked invariants:
//   - SET_QUERY updates ONLY query. Does not touch results / isLoading /
//     isOpen. Rationale: preserve old results during typing to prevent
//     per-keystroke flicker; fetch lifecycle owns isLoading; open timing
//     is call-site-controlled, not input-driven.
//   - FETCH_START/FETCH_SUCCESS/FETCH_ERROR never mutate isOpen.
//   - OPEN is the ONLY action that sets isOpen=true.
//   - CLOSE is the only action (besides RESET) that sets isOpen=false.
//   - RESET clears all four fields atomically.
// ============================================================================

export interface AutocompleteState {
  query: string;
  results: CustomerSearchResult[];
  isLoading: boolean;
  isOpen: boolean;
}

export type AutocompleteAction =
  | { type: "SET_QUERY"; query: string }
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; results: CustomerSearchResult[] }
  | { type: "FETCH_ERROR" }
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "RESET" }
  | { type: "CLEAR_RESULTS" };

export const INITIAL_AUTOCOMPLETE_STATE: AutocompleteState = {
  query: "",
  results: [],
  isLoading: false,
  isOpen: false,
};

export function autocompleteReducer(
  state: AutocompleteState,
  action: AutocompleteAction,
): AutocompleteState {
  switch (action.type) {
    case "SET_QUERY":
      return { ...state, query: action.query };
    case "FETCH_START":
      return { ...state, isLoading: true };
    case "FETCH_SUCCESS":
      return { ...state, results: action.results, isLoading: false };
    case "FETCH_ERROR":
      return { ...state, results: [], isLoading: false };
    case "OPEN":
      return { ...state, isOpen: true };
    case "CLOSE":
      return { ...state, isOpen: false };
    case "RESET":
      return { ...INITIAL_AUTOCOMPLETE_STATE };
    case "CLEAR_RESULTS":
      // Clears fetch-derived state (results + isLoading) while preserving
      // caller-owned state (query text the user is still typing, and the
      // call-site-controlled isOpen flag). Consumed by the termination
      // primitive `clearResults()` in the hook; see that file for the
      // cancellation-invariant contract.
      return {
        ...state,
        results: [],
        isLoading: false,
      };
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}

// ============================================================================
// Pure guards — testable without React / DOM / network.
// ============================================================================

/**
 * Returns true iff a resolved fetch response should be committed to state.
 *
 * Guards against two independent race conditions:
 *   1. Supersession  — a newer fetch was kicked off after this one
 *      (responseRequestId < currentRequestId). Caller bumps
 *      `currentRequestId` on every new fetch and captures its own
 *      token as `responseRequestId` at fetch-start time.
 *   2. Explicit abort — `reset()` or effect-cleanup aborted this
 *      fetch's AbortController. `aborted` is read from
 *      `signal.aborted` at the time of resolution.
 *
 * AbortController alone is not sufficient: a request that finishes
 * between the abort call and the new fetch's start can still race.
 * Belt-and-suspenders via requestId.
 */
export function shouldCommitResponse(args: {
  currentRequestId: number;
  responseRequestId: number;
  aborted: boolean;
}): boolean {
  if (args.aborted) return false;
  if (args.responseRequestId < args.currentRequestId) return false;
  return true;
}

/**
 * Returns true iff a fetch should fire for the given query + options.
 * Gates: enabled flag, trimmed minimum query length.
 */
export function shouldFetch(args: {
  query: string;
  minQueryLength: number;
  enabled: boolean;
}): boolean {
  if (!args.enabled) return false;
  if (args.query.trim().length < args.minQueryLength) return false;
  return true;
}

// ============================================================================
// Timer primitive — clears any prior timer, schedules a new one, updates
// the ref synchronously. Accepts injected timer implementations so unit
// tests can observe call ordering without touching the real clock.
// ============================================================================

export interface TimerPrimitives {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

export interface MutableRef<T> {
  current: T;
}

/**
 * Invariants (enforced + tested):
 *   1. If `timerRef.current` holds a prior id, `clearTimeout(prior)` runs
 *      BEFORE `setTimeout(fn, ms)`.
 *   2. `timerRef.current` is assigned synchronously to the new id
 *      returned by `setTimeout`, inside this function call — never
 *      from a later callback.
 *   3. After rapid successive calls, exactly one timer is live: the
 *      most recently scheduled one.
 */
export function scheduleFetch(args: {
  timerRef: MutableRef<unknown>;
  fn: () => void;
  ms: number;
  timers?: TimerPrimitives;
}): void {
  const timers: TimerPrimitives =
    args.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    };
  if (args.timerRef.current !== null && args.timerRef.current !== undefined) {
    timers.clearTimeout(args.timerRef.current);
  }
  const id = timers.setTimeout(args.fn, args.ms);
  args.timerRef.current = id;
}
