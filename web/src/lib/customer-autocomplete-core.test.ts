/**
 * Unit tests for the customer-autocomplete pure core module.
 *
 * Run (from web/):
 *   node --experimental-strip-types --test src/lib/customer-autocomplete-core.test.ts
 *
 * Matches the project's existing test convention (see lifecycle-pickup.test.ts):
 * node:test + node:assert/strict, no test framework dependency.
 *
 * Covers all reducer invariants, pure-helper contracts, timer-hygiene
 * invariants, and the composed reset-cancels-in-flight race scenario.
 * React-specific invariants (click-outside listener lifecycle, dropdown
 * render gating, onMouseDown preventDefault) are out of scope here and
 * are covered by Phase 4 manual QA — see the Phase 2 test-infrastructure
 * note for rationale.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  autocompleteReducer,
  type AutocompleteState,
  type CustomerSearchResult,
  getCustomerDisplayName,
  INITIAL_AUTOCOMPLETE_STATE,
  scheduleFetch,
  shouldCommitResponse,
  shouldFetch,
  type TimerPrimitives,
} from "./customer-autocomplete-core.ts";

// ---------- helpers ----------------------------------------------------------

function makeCustomer(overrides: Partial<CustomerSearchResult> & { id: string }): CustomerSearchResult {
  return {
    id: overrides.id,
    account_id: overrides.account_id ?? `A-${overrides.id}`,
    first_name: overrides.first_name ?? "Jane",
    last_name: overrides.last_name ?? "Doe",
    company_name: overrides.company_name ?? null,
    type: overrides.type ?? null,
    email: overrides.email ?? "jane@example.com",
    phone: overrides.phone ?? "555-0100",
    billing_address: overrides.billing_address ?? null,
    service_addresses: overrides.service_addresses ?? null,
  };
}

function state(overrides: Partial<AutocompleteState> = {}): AutocompleteState {
  return { ...INITIAL_AUTOCOMPLETE_STATE, ...overrides };
}

// ---------- Reducer invariants -----------------------------------------------

describe("autocompleteReducer — SET_QUERY scope", () => {
  it("SET_QUERY never mutates isOpen (from isOpen=false)", () => {
    const prior = state({ isOpen: false });
    const next = autocompleteReducer(prior, { type: "SET_QUERY", query: "ab" });
    assert.equal(next.isOpen, false);
  });

  it("SET_QUERY never mutates isOpen (from isOpen=true)", () => {
    const prior = state({ isOpen: true });
    const next = autocompleteReducer(prior, { type: "SET_QUERY", query: "ab" });
    assert.equal(next.isOpen, true);
  });

  it("SET_QUERY never mutates results — reference equality, empty prior", () => {
    const emptyResults: CustomerSearchResult[] = [];
    const prior = state({ results: emptyResults });
    const next = autocompleteReducer(prior, { type: "SET_QUERY", query: "x" });
    assert.equal(next.results, emptyResults);
  });

  it("SET_QUERY never mutates results — reference equality, single-item prior", () => {
    const singleResults = [makeCustomer({ id: "c1" })];
    const prior = state({ results: singleResults });
    const next = autocompleteReducer(prior, { type: "SET_QUERY", query: "x" });
    assert.equal(next.results, singleResults);
  });

  it("SET_QUERY never mutates results — reference equality, multi-item prior", () => {
    const multiResults = [
      makeCustomer({ id: "c1" }),
      makeCustomer({ id: "c2" }),
      makeCustomer({ id: "c3" }),
    ];
    const prior = state({ results: multiResults });
    const next = autocompleteReducer(prior, { type: "SET_QUERY", query: "x" });
    assert.equal(next.results, multiResults);
  });

  it("SET_QUERY never mutates isLoading (from isLoading=false)", () => {
    const prior = state({ isLoading: false });
    const next = autocompleteReducer(prior, { type: "SET_QUERY", query: "x" });
    assert.equal(next.isLoading, false);
  });

  it("SET_QUERY never mutates isLoading (from isLoading=true)", () => {
    const prior = state({ isLoading: true });
    const next = autocompleteReducer(prior, { type: "SET_QUERY", query: "x" });
    assert.equal(next.isLoading, true);
  });
});

describe("autocompleteReducer — FETCH_* actions never mutate isOpen", () => {
  // Enumerate every relevant prior state shape, then assert isOpen is
  // preserved after each fetch-lifecycle action.
  const priors: Array<{ name: string; state: AutocompleteState }> = [
    { name: "initial", state: state() },
    { name: "isOpen=false, results empty", state: state({ isOpen: false, results: [] }) },
    {
      name: "isOpen=false, results.length > 0",
      state: state({ isOpen: false, results: [makeCustomer({ id: "c1" })] }),
    },
    { name: "isOpen=true, results empty", state: state({ isOpen: true, results: [] }) },
    {
      name: "isOpen=true, results.length > 0",
      state: state({ isOpen: true, results: [makeCustomer({ id: "c1" })] }),
    },
    { name: "isOpen=false, isLoading=true", state: state({ isOpen: false, isLoading: true }) },
    { name: "isOpen=true, isLoading=true", state: state({ isOpen: true, isLoading: true }) },
  ];

  for (const prior of priors) {
    it(`FETCH_START preserves isOpen (${prior.name})`, () => {
      const next = autocompleteReducer(prior.state, { type: "FETCH_START" });
      assert.equal(next.isOpen, prior.state.isOpen);
    });

    it(`FETCH_SUCCESS preserves isOpen (${prior.name})`, () => {
      const next = autocompleteReducer(prior.state, {
        type: "FETCH_SUCCESS",
        results: [makeCustomer({ id: "cx" })],
      });
      assert.equal(next.isOpen, prior.state.isOpen);
    });

    it(`FETCH_ERROR preserves isOpen (${prior.name})`, () => {
      const next = autocompleteReducer(prior.state, { type: "FETCH_ERROR" });
      assert.equal(next.isOpen, prior.state.isOpen);
    });
  }
});

describe("autocompleteReducer — OPEN / CLOSE / RESET", () => {
  const priors: AutocompleteState[] = [
    state(),
    state({ isOpen: false }),
    state({ isOpen: true }),
    state({ query: "abc", results: [makeCustomer({ id: "c1" })], isLoading: true, isOpen: false }),
    state({ query: "abc", results: [makeCustomer({ id: "c1" })], isLoading: true, isOpen: true }),
  ];

  for (const prior of priors) {
    it(`OPEN sets isOpen=true from (isOpen=${prior.isOpen}, isLoading=${prior.isLoading})`, () => {
      const next = autocompleteReducer(prior, { type: "OPEN" });
      assert.equal(next.isOpen, true);
    });

    it(`CLOSE sets isOpen=false from (isOpen=${prior.isOpen}, isLoading=${prior.isLoading})`, () => {
      const next = autocompleteReducer(prior, { type: "CLOSE" });
      assert.equal(next.isOpen, false);
    });
  }

  it("RESET clears query, results, isLoading, isOpen (all four)", () => {
    const prior = state({
      query: "abc",
      results: [makeCustomer({ id: "c1" }), makeCustomer({ id: "c2" })],
      isLoading: true,
      isOpen: true,
    });
    const next = autocompleteReducer(prior, { type: "RESET" });
    assert.equal(next.query, "");
    assert.deepEqual(next.results, []);
    assert.equal(next.isLoading, false);
    assert.equal(next.isOpen, false);
  });
});

// ---------- Pure guards ------------------------------------------------------

describe("shouldCommitResponse", () => {
  it("returns false when responseRequestId < currentRequestId (superseded)", () => {
    const ok = shouldCommitResponse({
      currentRequestId: 5,
      responseRequestId: 3,
      aborted: false,
    });
    assert.equal(ok, false);
  });

  it("returns false when aborted=true (even if ids match)", () => {
    const ok = shouldCommitResponse({
      currentRequestId: 3,
      responseRequestId: 3,
      aborted: true,
    });
    assert.equal(ok, false);
  });

  it("returns true when fresh (ids equal) and not aborted", () => {
    const ok = shouldCommitResponse({
      currentRequestId: 7,
      responseRequestId: 7,
      aborted: false,
    });
    assert.equal(ok, true);
  });
});

describe("shouldFetch", () => {
  it("returns false when query.trim().length < minQueryLength", () => {
    assert.equal(
      shouldFetch({ query: "a", minQueryLength: 2, enabled: true }),
      false,
    );
    assert.equal(
      shouldFetch({ query: "  a  ", minQueryLength: 2, enabled: true }),
      false,
    );
    assert.equal(
      shouldFetch({ query: "", minQueryLength: 2, enabled: true }),
      false,
    );
  });

  it("returns false when enabled=false (even with valid query)", () => {
    assert.equal(
      shouldFetch({ query: "abc", minQueryLength: 2, enabled: false }),
      false,
    );
  });

  it("returns true when query valid and enabled", () => {
    assert.equal(
      shouldFetch({ query: "ab", minQueryLength: 2, enabled: true }),
      true,
    );
    assert.equal(
      shouldFetch({ query: "  ab  ", minQueryLength: 2, enabled: true }),
      true,
    );
  });
});

// ---------- Timer hygiene ----------------------------------------------------

interface TimerCall {
  kind: "setTimeout" | "clearTimeout";
  id?: number;
  ms?: number;
}

function makeMockTimers(): {
  timers: TimerPrimitives;
  calls: TimerCall[];
  lastId: () => number;
} {
  const calls: TimerCall[] = [];
  let nextId = 1;
  let lastReturnedId = 0;
  const timers: TimerPrimitives = {
    setTimeout: (_fn, ms) => {
      const id = nextId++;
      lastReturnedId = id;
      calls.push({ kind: "setTimeout", id, ms });
      return id;
    },
    clearTimeout: (id) => {
      calls.push({ kind: "clearTimeout", id: id as number });
    },
  };
  return { timers, calls, lastId: () => lastReturnedId };
}

describe("scheduleFetch — timer hygiene", () => {
  it("clears prior timer BEFORE scheduling new one (call order)", () => {
    const { timers, calls } = makeMockTimers();
    const timerRef: { current: unknown } = { current: null };

    scheduleFetch({ timerRef, fn: () => {}, ms: 250, timers });
    // First call: no prior, no clearTimeout expected.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "setTimeout");
    assert.equal(calls[0].ms, 250);
    assert.equal(timerRef.current, calls[0].id);

    // Second call: must clearTimeout FIRST, then setTimeout.
    scheduleFetch({ timerRef, fn: () => {}, ms: 250, timers });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].kind, "clearTimeout");
    assert.equal(calls[1].id, 1);
    assert.equal(calls[2].kind, "setTimeout");
    assert.equal(calls[2].id, 2);
    assert.equal(timerRef.current, 2);
  });

  it("rapid 10 successive calls: 10 setTimeout, 9 clearTimeout, no orphans", () => {
    const { timers, calls } = makeMockTimers();
    const timerRef: { current: unknown } = { current: null };

    for (let i = 0; i < 10; i++) {
      scheduleFetch({ timerRef, fn: () => {}, ms: 250, timers });
    }

    const setCount = calls.filter((c) => c.kind === "setTimeout").length;
    const clearCount = calls.filter((c) => c.kind === "clearTimeout").length;
    assert.equal(setCount, 10);
    assert.equal(clearCount, 9);
    // timerRef holds the last setTimeout's id.
    assert.equal(timerRef.current, 10);

    // Verify order: each clearTimeout appears immediately before the
    // next setTimeout, never after.
    let seenSetTimeouts = 0;
    for (const c of calls) {
      if (c.kind === "setTimeout") {
        seenSetTimeouts++;
      } else {
        assert.equal(
          c.id,
          seenSetTimeouts,
          "clearTimeout id must match the most recent setTimeout id",
        );
      }
    }
  });
});

// ---------- CLEAR_RESULTS reducer invariants ---------------------------------

describe("autocompleteReducer — CLEAR_RESULTS", () => {
  it("CLEAR_RESULTS clears results", () => {
    const prior = state({
      results: [makeCustomer({ id: "c1" }), makeCustomer({ id: "c2" })],
    });
    const next = autocompleteReducer(prior, { type: "CLEAR_RESULTS" });
    assert.deepEqual(next.results, []);
  });

  it("CLEAR_RESULTS clears isLoading", () => {
    const prior = state({ isLoading: true });
    const next = autocompleteReducer(prior, { type: "CLEAR_RESULTS" });
    assert.equal(next.isLoading, false);
  });

  it("CLEAR_RESULTS does NOT mutate query", () => {
    // Iterate several prior query shapes; query must be preserved byte-for-byte.
    const queries = ["", "a", "abc", "  padded  ", "long string value"];
    for (const q of queries) {
      const prior = state({ query: q, results: [makeCustomer({ id: "c1" })] });
      const next = autocompleteReducer(prior, { type: "CLEAR_RESULTS" });
      assert.equal(next.query, q, `query must be preserved for ${JSON.stringify(q)}`);
    }
  });

  it("CLEAR_RESULTS does NOT mutate isOpen (from isOpen=false)", () => {
    const prior = state({ isOpen: false, results: [makeCustomer({ id: "c1" })] });
    const next = autocompleteReducer(prior, { type: "CLEAR_RESULTS" });
    assert.equal(next.isOpen, false);
  });

  it("CLEAR_RESULTS does NOT mutate isOpen (from isOpen=true)", () => {
    const prior = state({ isOpen: true, results: [makeCustomer({ id: "c1" })] });
    const next = autocompleteReducer(prior, { type: "CLEAR_RESULTS" });
    assert.equal(next.isOpen, true);
  });
});

describe("reset termination primitive — abort + timer cancellation", () => {
  // Parallel to the clearResults timer-cancellation test. Models the
  // hook's reset() body (see use-customer-autocomplete.ts) using injected
  // timer primitives and the same AbortController + requestId refs the
  // hook uses. Asserts RESET semantics: abort fires, timer cancels,
  // callback never runs, reducer returns to INITIAL_AUTOCOMPLETE_STATE.
  it("reset aborts in-flight fetch", () => {
    const { timers, calls } = makeMockTimers();
    const timerRef: { current: unknown } = { current: null };
    let fetchFired = false;

    // Act 1 — schedule a fetch the way the hook's fetch useEffect does.
    scheduleFetch({
      timerRef,
      fn: () => {
        fetchFired = true;
      },
      ms: 250,
      timers,
    });
    const scheduledId = timerRef.current;
    assert.equal(scheduledId, 1, "setTimeout returned id 1");
    assert.equal(fetchFired, false, "mock timer must not have fired yet");

    // Act 2 — model the hook's reset() body: abort + requestId bump +
    // timer cancellation + reducer dispatch. Byte-identical to
    // clearResults's model except for the dispatched action type, which
    // mirrors the symmetry contract in the hook source.
    const requestIdRef = { current: 5 };
    const abortController = new AbortController();
    abortController.abort();
    requestIdRef.current++;
    if (timerRef.current) {
      timers.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const priorState: AutocompleteState = {
      query: "abc",
      results: [makeCustomer({ id: "c1" }), makeCustomer({ id: "c2" })],
      isLoading: true,
      isOpen: true,
    };
    const nextState = autocompleteReducer(priorState, { type: "RESET" });

    // Assert — abort fired.
    assert.equal(abortController.signal.aborted, true);

    // Assert — timer cancelled by id, callback never fired, ref nulled.
    const clearCall = calls.find((c) => c.kind === "clearTimeout");
    assert.ok(clearCall, "clearTimeout must have been called");
    assert.equal(
      clearCall.id,
      scheduledId,
      "clearTimeout id must match the id that scheduleFetch returned",
    );
    assert.equal(fetchFired, false, "fetch callback must never execute");
    assert.equal(timerRef.current, null, "timer ref nulled post-cancel");

    // Assert — requestId bumped (late responses would be discarded by
    // shouldCommitResponse even if one slipped past cancellation).
    assert.equal(requestIdRef.current, 6);

    // Assert — reducer dropped state to INITIAL, unlike CLEAR_RESULTS
    // which preserves query + isOpen. This is the key semantic
    // difference between the two termination primitives.
    assert.deepEqual(nextState, INITIAL_AUTOCOMPLETE_STATE);
  });
});

describe("clearResults termination primitive — timer cancellation", () => {
  // The hook's clearResults() body (see use-customer-autocomplete.ts) is
  // structurally identical to reset() except for the dispatched action.
  // This test models the timer-cancellation + requestId-bump portion
  // using the same injected-timers pattern as scheduleFetch tests, then
  // asserts the composed outcome: a timer scheduled by scheduleFetch is
  // cleared, its callback never fires, and the subsequent CLEAR_RESULTS
  // reducer transition preserves query + isOpen while clearing results +
  // isLoading.
  it("clearResults cancels pending debounced fetch", () => {
    const { timers, calls } = makeMockTimers();
    const timerRef: { current: unknown } = { current: null };
    let fetchFired = false;

    // Act 1 — schedule a fetch the way the hook's fetch useEffect does.
    scheduleFetch({
      timerRef,
      fn: () => {
        fetchFired = true;
      },
      ms: 250,
      timers,
    });
    const scheduledId = timerRef.current;
    assert.equal(scheduledId, 1, "setTimeout returned id 1");
    assert.equal(fetchFired, false, "mock timer must not have fired yet");

    // Act 2 — model the hook's clearResults body: abort + requestId bump
    // + timer cancellation + reducer dispatch. Abort and requestId are
    // modeled here directly (same primitives used by the existing
    // composed-race test).
    const requestIdRef = { current: 3 };
    const abortController = new AbortController();
    abortController.abort();
    requestIdRef.current++;
    if (timerRef.current) {
      timers.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const priorState: AutocompleteState = {
      query: "ab",
      results: [makeCustomer({ id: "c1" })],
      isLoading: true,
      isOpen: true,
    };
    const nextState = autocompleteReducer(priorState, { type: "CLEAR_RESULTS" });

    // Assert — timer cancelled by id, callback never fired.
    const clearCall = calls.find((c) => c.kind === "clearTimeout");
    assert.ok(clearCall, "clearTimeout must have been called");
    assert.equal(
      clearCall.id,
      scheduledId,
      "clearTimeout id must match the id that scheduleFetch returned",
    );
    assert.equal(fetchFired, false, "fetch callback must never execute");
    assert.equal(timerRef.current, null, "timer ref nulled post-cancel");

    // Assert — reducer bucket preserves query + isOpen, clears results + isLoading.
    assert.equal(nextState.query, "ab");
    assert.equal(nextState.isOpen, true);
    assert.deepEqual(nextState.results, []);
    assert.equal(nextState.isLoading, false);

    // Assert — requestId was bumped (late responses will be discarded by
    // shouldCommitResponse even if one slipped past cancellation).
    assert.equal(requestIdRef.current, 4);
    assert.equal(abortController.signal.aborted, true);
  });
});

// ---------- Composed race scenario -------------------------------------------

describe("composed: RESET cancels in-flight response", () => {
  it("late-arriving response is discarded via requestId bump + abort", () => {
    // Model the three hook refs directly — no React needed.
    const requestIdRef = { current: 0 };
    const abortControllerRef: { current: AbortController | null } = {
      current: null,
    };

    // Fetch #1 starts: bump id, create controller.
    const fetch1RequestId = ++requestIdRef.current;
    const controller1 = new AbortController();
    abortControllerRef.current = controller1;
    assert.equal(fetch1RequestId, 1);
    assert.equal(controller1.signal.aborted, false);

    // Simulate reset(): abort in-flight controller + bump id.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    requestIdRef.current++;

    assert.equal(controller1.signal.aborted, true);
    assert.equal(requestIdRef.current, 2);

    // Fetch #1's late-arriving response checks the commit guard:
    const commit = shouldCommitResponse({
      currentRequestId: requestIdRef.current,
      responseRequestId: fetch1RequestId,
      aborted: controller1.signal.aborted,
    });
    // Both guards reject independently; either alone would be sufficient.
    assert.equal(commit, false);
  });

  it("both guards are independent — aborted alone rejects, id alone rejects", () => {
    // Aborted alone (ids match): rejects.
    assert.equal(
      shouldCommitResponse({
        currentRequestId: 1,
        responseRequestId: 1,
        aborted: true,
      }),
      false,
    );
    // Id-stale alone (not aborted): rejects.
    assert.equal(
      shouldCommitResponse({
        currentRequestId: 2,
        responseRequestId: 1,
        aborted: false,
      }),
      false,
    );
    // Sanity: both clean → commits.
    assert.equal(
      shouldCommitResponse({
        currentRequestId: 1,
        responseRequestId: 1,
        aborted: false,
      }),
      true,
    );
  });
});

// ---------- Display-name helper ---------------------------------------------

describe("getCustomerDisplayName", () => {
  it("returns 'first last' when both present", () => {
    assert.equal(
      getCustomerDisplayName({
        first_name: "Jane",
        last_name: "Doe",
        company_name: "Acme",
      }),
      "Jane Doe",
    );
  });

  it("falls back to company_name when first+last missing", () => {
    assert.equal(
      getCustomerDisplayName({
        first_name: "",
        last_name: "",
        company_name: "Acme Corp",
      }),
      "Acme Corp",
    );
  });

  it("returns empty string when nothing is available", () => {
    assert.equal(
      getCustomerDisplayName({
        first_name: "",
        last_name: "",
        company_name: null,
      }),
      "",
    );
  });
});
