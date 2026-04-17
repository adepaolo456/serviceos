/**
 * Unit tests for the canonical active-pickup-node selector.
 *
 * Run (from web/):
 *   node --experimental-strip-types --test src/lib/lifecycle-pickup.test.ts
 *
 * Uses Node's built-in `node:test` runner so no test framework dependency
 * is added to the web project (which currently has none — see Validation
 * notes in the prompt's deliverable).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  selectActivePickupNode,
  toCandidateFromSnakeCaseNode,
  toCandidateFromCamelCaseJob,
  type PickupCandidate,
} from "./lifecycle-pickup.ts";

// Minimal candidate factory — keeps each case readable.
function c(overrides: Partial<PickupCandidate> & { id: string }): PickupCandidate {
  return {
    task_type: "pick_up",
    status: "scheduled",
    link_status: "scheduled",
    scheduled_date: "2026-04-20",
    sequence_number: null,
    ...overrides,
  };
}

describe("selectActivePickupNode", () => {
  // 1. Single non-cancelled pickup → returns that row.
  it("returns the single non-cancelled pickup", () => {
    const only = c({ id: "p1", sequence_number: 2 });
    const result = selectActivePickupNode([only]);
    assert.equal(result?.id, "p1");
  });

  // 2. No pickups at all → returns null.
  it("returns null when no candidates pass the filter", () => {
    const result = selectActivePickupNode([
      c({ id: "d1", task_type: "drop_off", sequence_number: 1 }),
      c({ id: "x1", task_type: "exchange", sequence_number: 2 }),
    ]);
    assert.equal(result, null);
  });

  // 3. All pickups cancelled (status === "cancelled") → returns null.
  it("returns null when all pickups have status=cancelled", () => {
    const result = selectActivePickupNode([
      c({ id: "p1", status: "cancelled", sequence_number: 2 }),
      c({ id: "p2", status: "cancelled", sequence_number: 4 }),
    ]);
    assert.equal(result, null);
  });

  // 4. All pickup links cancelled (link_status === "cancelled") → returns null.
  it("returns null when all pickup link_statuses are cancelled", () => {
    const result = selectActivePickupNode([
      c({ id: "p1", link_status: "cancelled", sequence_number: 2 }),
      c({ id: "p2", link_status: "cancelled", sequence_number: 4 }),
    ]);
    assert.equal(result, null);
  });

  // 5. One non-cancelled pickup with null scheduled_date → returns null.
  it("excludes pickups without a scheduled_date (not actionable)", () => {
    const result = selectActivePickupNode([
      c({ id: "p1", scheduled_date: null, sequence_number: 2 }),
    ]);
    assert.equal(result, null);
  });

  // 6. LOAD-BEARING — two non-cancelled pickups, back-dated exchange.
  //    Higher sequence_number must win even though it has the EARLIER
  //    scheduled_date. Plus an integration-guarantee assertion:
  //    routing the same fixture through each call site's adapter must
  //    yield the same id. This is the regression guard for the
  //    pre-existing derivation divergence between LifecycleContextPanel
  //    (sorted by sequence_number) and the rentals page (sorted by
  //    scheduled_date).
  it("picks higher sequence_number even when scheduled_date is earlier (back-dated exchange) AND both adapters agree", () => {
    // Direct helper assertion.
    const oldPickup = c({ id: "old", scheduled_date: "2026-05-01", sequence_number: 2 });
    const newPickup = c({ id: "new", scheduled_date: "2026-04-15", sequence_number: 4 });
    const result = selectActivePickupNode([oldPickup, newPickup]);
    assert.equal(result?.id, "new", "helper must pick highest sequence_number row");

    // Integration-guarantee assertion. Build a single source-of-truth
    // fixture, map it through both call-site adapters, and confirm
    // equivalent helper output.
    const fixture = [
      {
        // shared fields — both shapes must yield identical candidates
        oldId: "old",
        newId: "new",
        oldDate: "2026-05-01",
        newDate: "2026-04-15",
        oldSeq: 2,
        newSeq: 4,
      },
    ][0];

    const snakeNodes = [
      {
        job_id: fixture.oldId,
        task_type: "pick_up",
        status: "scheduled",
        link_status: "scheduled",
        scheduled_date: fixture.oldDate,
        sequence_number: fixture.oldSeq,
      },
      {
        job_id: fixture.newId,
        task_type: "pick_up",
        status: "scheduled",
        link_status: "scheduled",
        scheduled_date: fixture.newDate,
        sequence_number: fixture.newSeq,
      },
    ];
    const camelJobs = [
      {
        id: fixture.oldId,
        taskType: "pick_up",
        status: "scheduled",
        linkStatus: "scheduled",
        scheduledDate: fixture.oldDate,
        sequence_number: fixture.oldSeq,
      },
      {
        id: fixture.newId,
        taskType: "pick_up",
        status: "scheduled",
        linkStatus: "scheduled",
        scheduledDate: fixture.newDate,
        sequence_number: fixture.newSeq,
      },
    ];

    const fromSnake = selectActivePickupNode(
      snakeNodes.map(toCandidateFromSnakeCaseNode),
    );
    const fromCamel = selectActivePickupNode(
      camelJobs.map(toCandidateFromCamelCaseJob),
    );

    assert.equal(
      fromSnake?.id,
      fromCamel?.id,
      "both surfaces must select the same id for equivalent input",
    );
    assert.equal(
      fromSnake?.id,
      "new",
      "and that id must be the higher-sequence_number row",
    );
  });

  // 7. Sequence partition rule — mixed candidates: one row has
  //    sequence_number, another does not (with a later scheduled_date).
  //    The row with sequence_number must win; the row without is
  //    dropped from primary selection.
  it("partitions on sequence_number availability — drops null-sequence rows when any peer has sequence_number", () => {
    const seqRow = c({ id: "seq", sequence_number: 5, scheduled_date: "2026-04-10" });
    const noSeqLater = c({ id: "noseq", sequence_number: null, scheduled_date: "2026-05-01" });
    const result = selectActivePickupNode([seqRow, noSeqLater]);
    assert.equal(result?.id, "seq");
  });

  // 8. No sequence data at all → fall back to latest scheduled_date.
  it("falls back to latest scheduled_date when no candidate carries sequence_number", () => {
    const earlier = c({ id: "a", sequence_number: null, scheduled_date: "2026-04-10" });
    const later = c({ id: "b", sequence_number: null, scheduled_date: "2026-05-01" });
    const result = selectActivePickupNode([earlier, later]);
    assert.equal(result?.id, "b");
  });

  // 9. Non-pick_up task types mixed in → ignored.
  it("ignores non-pick_up task types", () => {
    const result = selectActivePickupNode([
      c({ id: "d1", task_type: "drop_off", sequence_number: 9 }),
      c({ id: "x1", task_type: "exchange", sequence_number: 7 }),
      c({ id: "p1", task_type: "pick_up", sequence_number: 3 }),
    ]);
    assert.equal(result?.id, "p1");
  });
});
