# Customer Autocomplete System

The shared customer-search system lives in three files and is consumed by four call sites. This document covers how to use it, the contract it implements, and the patterns to avoid.

**Files:**
- web/src/lib/customer-autocomplete-core.ts — pure reducer + helpers (testable without React)
- web/src/lib/use-customer-autocomplete.ts — React hook (state, effects, refs)
- web/src/components/customer-autocomplete-dropdown.tsx — presentational dropdown component (optional consumer choice)

**Active consumers:**
- new-customer-form.tsx (NCF) — inline form with floating dropdown
- booking-wizard.tsx (BW) — multi-step wizard with floating dropdown + enabled gate
- quote-send-panel.tsx (QSP) — async-sensitive panel with focus-guard + loading spinner
- customer-picker-drawer.tsx (CPD) — slide-over drawer with inline (non-dropdown) results

If you're adding a new consumer, you'll likely fit one of these four shapes. Read the matching consumer first.

---

## 1. Quick usage

The 90% case: a name input that should show a dropdown of matching customers as the user types, with selection prefilling parent state.

    import { useCustomerAutocomplete } from "@/lib/use-customer-autocomplete";
    import CustomerAutocompleteDropdown from "@/components/customer-autocomplete-dropdown";

    function MyForm() {
      const {
        query, setQuery,
        results,
        isLoading,
        isOpen, open, close,
        containerRef,
        reset,
      } = useCustomerAutocomplete();

      // Open the dropdown when results arrive, close when they drain.
      // (The hook does NOT auto-open — call sites own this decision.)
      useEffect(() => {
        if (results.length > 0) open();
        else close();
      }, [results, open, close]);

      return (
        <div ref={containerRef} style={{ position: "relative" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <CustomerAutocompleteDropdown
            results={results}
            isLoading={isLoading}
            isOpen={isOpen}
            onSelect={(customer) => {
              // Prefill parent state from customer
              // ...
              reset();  // clears query, results, closes dropdown, aborts in-flight
            }}
            labels={{ continueAsNew: "Continue as new customer" }}
            onContinueAsNew={() => close()}
          />
        </div>
      );
    }

### Required wiring

- containerRef must be attached to the wrapper element that encloses the input + dropdown. The hook attaches a mousedown listener while open and uses this ref to detect clicks outside.
- value={query} binds the input to the hook's query state. Do NOT keep a local mirror state.
- onChange={(e) => setQuery(e.target.value)} writes to the hook. Do NOT call any other state setters in parallel for the same value.
- The results-sync useEffect is the canonical way to control dropdown visibility based on results. Don't auto-open from the input's onChange — that creates flicker on no-match queries.
- Selection handler must reset the hook (or call clearResults() if you want to preserve the input text).

### Hook options

    useCustomerAutocomplete({
      enabled: !selectedCustomer,   // suppresses fetches when false (default: true)
      maxResults: 8,                // limit query param (default: 5)
      minQueryLength: 2,            // minimum query length to fetch (default: 2)
      debounceMs: 250,              // debounce window (default: 250)
    });

All options are optional. Defaults match what NCF uses.

---

## 2. Patterns by consumer

Each existing consumer demonstrates a different valid integration shape. When adding a new consumer, find the closest match.

### NCF — inline form, floating dropdown, default options

The simplest integration. Two-input search (first name + last name) feeding setQuery with the joined string. Uses the shared dropdown component. No enabled gate. No focus-guard.

Reference: web/src/components/new-customer-form.tsx

### BW — wizard with enabled gate

Same shape as NCF, but passes enabled: !selectedCustomer so searches suppress while a customer is selected. Calls reset() from the "× change customer" button to prevent stale hook state from resurrecting when enabled flips back to true.

Reference: web/src/components/booking-wizard.tsx

**The pattern that matters:** any state transition that flips enabled from false back to true must explicitly call reset() to clear stale hook state. Otherwise the hook's internal query may resurrect a fetch the user no longer wants.

### QSP — async-sensitive, focus-guard, loading spinner

Adds two behaviors NCF/BW don't need:

1. **Focus-guard.** The results-sync useEffect wraps open() in a document.activeElement === inputRef.current check, so fetches that resolve after the user has tabbed/clicked away don't pop the dropdown back open on a field they've left. The close branch is unguarded so reset() and results-drain always close correctly.

2. **Loading spinner.** Passes isLoading from the hook to the dropdown along with labels.loading=<><Loader2 /> Searching...</>. The dropdown's labels.loading accepts React.ReactNode so consumers can compose icons + text.

Reference: web/src/components/quote-send-panel.tsx

### CPD — drawer, inline results, no shared dropdown

CPD's results render directly in its slide-over drawer body — not via the floating dropdown component. Consumes the hook's data layer (query, setQuery, results, isLoading, reset, clearResults) and ignores the UI primitives (isOpen, open, close, containerRef).

Two CPD-specific patterns:

1. **maxResults: 8** passed explicitly (other sites use the default 5).
2. **clearResults() on below-min-length backspace.** When the user backspaces to a query under minQueryLength, the hook's fetch effect short-circuits (no fetch fires), but stale results from the prior query would remain visible. CPD calls clearResults() in its onChange handler to clear them immediately while preserving the input text. Without this call, CPD would show stale results.

Reference: web/src/components/customer-picker-drawer.tsx

    onChange={(e) => {
      const v = e.target.value;
      setQuery(v);
      if (v.trim().length < 2) clearResults();
    }}

This pattern only applies to consumers that render results inline (gated on results.length, not on isOpen). NCF/BW/QSP gate on isOpen and don't need it.

---

## 3. Contract + invariants

Read this section before modifying the hook itself. The invariants below are what makes the system safe to use; breaking them re-introduces classes of bugs the design was built to prevent.

### State shape

The hook's reducer manages four pieces of state:

- query: string — the current input value
- results: CustomerSearchResult[] — the most recently committed fetch result
- isLoading: boolean — true while a fetch is in flight
- isOpen: boolean — call-site-controlled dropdown visibility

Single source of truth: do NOT keep a local useState mirroring any of these in the call site.

### Primitive classification

Hook primitives fall into two buckets:

**Termination primitives** (reset, clearResults):
- MUST abort in-flight fetches (controller.abort())
- MUST invalidate late responses (requestId++)
- MUST cancel scheduled timers (clearTimeout + null the ref)
- Differ ONLY in which reducer action they dispatch:
  - reset → RESET (clears everything, returns to INITIAL_AUTOCOMPLETE_STATE)
  - clearResults → CLEAR_RESULTS (clears results + isLoading; preserves query + isOpen)

**Non-termination primitives** (setQuery, open, close):
- MUST NOT cancel async work
- setQuery triggers a new debounced fetch via the fetch useEffect; scheduleFetch handles timer reuse internally
- open / close are pure state toggles

If you add a new primitive, classify it explicitly. Do not implicitly choose based on what looks easiest.

### Cancellation invariant

Any termination primitive must perform all three cancellation steps in this exact order:

    abortControllerRef.current?.abort();         // 1. abort in-flight fetch
    requestIdRef.current++;                       // 2. invalidate any late response
    if (debounceTimerRef.current) {               // 3. cancel scheduled fetch
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    dispatch({ type: <ACTION> });                 // 4. update state

The bodies of reset() and clearResults() are byte-identical except for the dispatched action. **If you diff them and find more than one line of difference, that's a bug.**

### Fetch lifecycle is decoupled from isOpen

The fetch useEffect:
- Does NOT include isOpen in its dep array
- Does NOT read isOpen in its body
- Does NOT dispatch OPEN

This means a fetch can fire and resolve while the dropdown is closed. Whether to show the results when they arrive is the call site's decision — typically via the results-sync useEffect pattern shown in Quick Usage.

### Auto-close behavior

The hook attaches a document.mousedown listener while isOpen is true. The listener detects clicks outside containerRef and dispatches CLOSE. This is the only place the hook auto-closes; all other close calls are call-site explicit.

### What the hook deliberately does NOT do

- It does NOT auto-open based on query length, focus events, or any other input-driven signal
- It does NOT manage input focus
- It does NOT preserve input text across reset() (use clearResults() if you need that)
- It does NOT debounce on selection — call reset() or clearResults() synchronously in your onSelect handler

---

## 4. Cancellation model

Three layers of defense against stale-state bugs in async UIs:

### Layer 1 — AbortController

Each fetch creates a new AbortController and passes its signal to api.get. When a termination primitive runs (reset / clearResults) or when a new fetch starts, the previous controller is aborted. The aborted fetch resolves to a rejected promise that the hook silently swallows.

### Layer 2 — requestId guard

Each fetch is tagged with a monotonically increasing requestId before it's dispatched. When the response arrives, the hook checks whether the response's tag matches the current requestId. If they don't match (because a newer fetch fired since), the response is discarded — even if the network actually returned 200.

### Layer 3 — Debounce timer cancellation

Termination primitives call clearTimeout on debounceTimerRef and null it out. This prevents a queued fetch (from a recent setQuery) from ever firing after reset() / clearResults() is called. The fetch never executes; no abort needed because nothing was started.

### Why three layers?

Each catches a different race:

| Scenario | Layer that catches it |
|----------|----------------------|
| Fetch in flight when reset() fires, response arrives later | Layer 1 (abort) — fetch is canceled at network layer |
| Multiple fetches in flight, returning out of order | Layer 2 (requestId) — only latest response commits |
| setQuery queued in debounce window when reset() fires | Layer 3 (timer) — fetch never starts |
| Network returns 200 between abort and listener notification | Layer 2 (requestId) — late response discarded |

The combination is what makes the system production-grade. Removing any single layer re-introduces a class of stale-state bugs.

### Verifying cancellation in the browser

Open DevTools Network tab. Type fast, then pause. You should see:
- Exactly one fetch fired ~250ms after the last keystroke (debounce working)
- If you backspace to clear the input quickly, in-flight fetches show (canceled) status (abort working)
- If you type "Jan" → "Janet" → "Ja" rapidly, only "Ja" results appear in the UI even if "Janet" response arrives last (requestId working)

---

## 5. Anti-patterns

Things that look reasonable but break the contract. These are the most common ways to misuse the system.

### Bypassing the hook

    // DON'T
    useEffect(() => {
      fetch("/customers/search?q=" + query).then(...)
    }, [query]);

The hook is the single source of truth for /customers/search. Direct fetches lose debounce, cancellation, and request invalidation. If your need isn't covered by the hook's contract, that's a contract discussion — open an issue, don't work around it.

### Shadow state

    // DON'T
    const [localQuery, setLocalQuery] = useState("");
    const { setQuery } = useCustomerAutocomplete();
    onChange={(e) => {
      setLocalQuery(e.target.value);  // shadow state
      setQuery(e.target.value);
    }}

Two sources of truth for "the current query" diverge under rapid interaction (e.g., one updates synchronously, the other batches). Use the hook's query directly: value={query}, onChange={(e) => setQuery(e.target.value)}.

### Auto-opening from onChange

    // DON'T
    onChange={(e) => {
      setQuery(e.target.value);
      if (e.target.value.length >= 2) open();  // opens on keystroke, not on results
    }}

Opening on keystroke causes the dropdown to flicker open-then-closed for queries that return zero results. The correct pattern is the results-sync useEffect (open when results.length > 0, close otherwise) — the dropdown opens only when there's something to show.

### Re-implementing debounce

    // DON'T
    const debounceRef = useRef(null);
    onChange={(e) => {
      const v = e.target.value;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setQuery(v), 250);
    }}

The hook already debounces internally at 250ms. Adding a second debounce layer doubles the latency and decouples the timer from the hook's cancellation primitives.

### Mixing reset/close semantics

    // DON'T
    onSelect={(customer) => {
      prefillForm(customer);
      close();           // closes dropdown but leaves results in state
      // user types again → stale results briefly visible while new fetch runs
    }}

After selection, call reset() (clears everything) or clearResults() (clears results, preserves query). close() alone leaves stale state.

### Reading isOpen to decide whether to fetch

    // DON'T
    useCustomerAutocomplete({ enabled: isOpen });

isOpen is UI state, not fetch gating. The hook's fetch lifecycle is intentionally decoupled from isOpen. If you need to suppress fetches under some condition, use the enabled option with a domain predicate (e.g., !selectedCustomer).

### Calling reset() reactively

    // DON'T
    useEffect(() => {
      reset();  // unconditional
    }, [someState]);

reset() cancels in-flight fetches and clears all state. Calling it on every render of a state change can fight with the user's typing and create infinite cancellation loops. If you need a conditional reset, gate it explicitly:

    useEffect(() => {
      if (someCondition) reset();
    }, [someCondition]);

CPD's drawer-open useEffect is the canonical example: useEffect(() => { if (open) reset(); }, [open, reset])

---

## 6. Extension guidance

If the hook can't do what you need, your options in order of preference:

### Option A — Compose at the call site

Most needs are call-site composition, not hook changes. Examples:
- Need a focus-guard? Wrap open() in your call-site useEffect with the focus check (see QSP).
- Need to suppress fetches conditionally? Pass enabled with your predicate (see BW).
- Need different prefill logic? Implement it in your onSelect handler.
- Need to clear results without losing input text? Use clearResults(), not reset().

The hook's contract is intentionally narrow so call sites stay flexible. Composition is the first answer.

### Option B — Extend the dropdown component

If your need is purely presentational (different label text, different layout for the loading row, etc.), extend CustomerAutocompleteDropdown:
- Pass a custom labels prop (the labels are React.ReactNode, not string)
- Or render your own dropdown UI and consume only the data layer (CPD pattern)

### Option C — Contract amendment

If multiple consumers would benefit from the same hook-level capability, propose a contract amendment. Criteria:

- The change is strictly additive (existing consumers unaffected)
- The change is small and surgical (smallest possible diff)
- The amendment is documented in the source itself, not just the commit
- The classification of any new primitive (termination vs non-termination) is explicit

Two such amendments shipped during the original consolidation arc:

- labels.loading widened from string to React.ReactNode (for QSP's spinner)
- CLEAR_RESULTS action + clearResults() primitive (for CPD's below-min-length clearing)

Both were strictly additive. Both surfaced from per-site audits, not speculation. Both kept already-migrated sites working without rework.

If you find yourself wanting an amendment, ask: "would I be making this change if my one site weren't requesting it?" If no, it's probably a site-local need (Option A). If yes, contract amendment is correct.

### Option D — Don't extend; build separately

If your need is fundamentally different — e.g., async dropdown for a different entity (vendors, parts, jobs) — don't try to generalize this hook. Copy the structure (reducer + hook + dropdown component) and adapt it to your entity. Sharing infrastructure across unrelated entity types is a worse failure mode than duplication.

---

## Maintenance

When this system changes, update this document. Specifically:

- New consumer added → add it to "Active consumers" and "Patterns by consumer"
- Contract change → update "Contract + invariants" and the cancellation model section
- New anti-pattern surfaced → add it to "Anti-patterns" with the example
- Hook gains a new option or primitive → document it in "Quick usage" and classify it in "Primitive classification"

The hook's top-of-file comment block in use-customer-autocomplete.ts references this document. Keep them aligned — if you change one, check the other.
