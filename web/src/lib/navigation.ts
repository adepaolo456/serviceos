"use client";

/**
 * History-first back navigation for detail pages.
 *
 * ServiceOS detail pages (jobs, customers, rentals, invoices, vehicles,
 * team, pricing sub-pages) all used to implement their "Back" affordance
 * as a hardcoded `<Link href="/jobs">` / `<Link href="/customers">` /
 * etc. That meant navigating Dispatch → Job Detail → Back dumped the
 * user at the Jobs list instead of back at Dispatch, and navigating
 * Customer Detail → Job Detail → Back dumped them at the Jobs list
 * instead of back at the customer. Real browser history was being
 * discarded.
 *
 * This helper fixes that: when there is real history to pop (the user
 * navigated into this page from somewhere else in the app), call
 * `router.back()` so they return to their actual previous page. When
 * there is no history — direct URL access, fresh browser tab, deep
 * link from an email or Slack message — fall back to a
 * context-appropriate list page so the user is never stranded with
 * a back button that does nothing.
 *
 * Deliberately a plain function, not a hook: there is no per-call
 * state to memoize and threading through a `useCallback` would just
 * add render ceremony. Call it from any event handler in any client
 * component: `onClick={() => navigateBack(router, "/jobs")}`.
 *
 * History-depth heuristic: `window.history.length > 1`. In practice
 * every browser initializes `history.length` to 1 for a fresh tab;
 * it only becomes > 1 after the first push or replace. Next.js App
 * Router calls `pushState` on every `router.push`, so an in-app
 * navigation always leaves a poppable entry. Direct URL access (or
 * a hard reload on a detail page) leaves `history.length === 1` and
 * the fallback kicks in.
 *
 * NOTE: This deliberately does NOT inspect `document.referrer`. A
 * same-origin referrer check would over-trigger the fallback on any
 * page that was navigated to via `router.replace` (no new history
 * entry) even though the user DID come from another in-app page,
 * and would under-trigger on pages loaded via an in-app `<a href>`
 * with a same-origin referrer but a fresh tab. History length is
 * the cleaner signal.
 */
export function navigateBack(
  router: { back: () => void; push: (href: string) => void },
  fallback: string,
): void {
  if (typeof window !== "undefined" && window.history.length > 1) {
    router.back();
    return;
  }
  router.push(fallback);
}
