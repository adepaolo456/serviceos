/**
 * Reporting DTO Phase 2 — Asset utilization report response contract.
 *
 * Shape returned by `GET /reporting/assets`. Consumed by:
 *  - The Assets tab on `web/src/app/(dashboard)/analytics/page.tsx`
 *    (verified clean in Phase 2c Follow-Up #4.5 Site #6)
 *  - The dashboard fleet-summary widget on
 *    `web/src/app/(dashboard)/page.tsx:228`, which narrows the response
 *    to `{ totalAssets, byStatus }` only. Extra fields like `bySize`
 *    are ignored there; TypeScript's structural narrowing handles this
 *    cleanly without DTO changes.
 *
 * Mirrors `getAssetUtilization(tenantId)` in `reporting.service.ts`
 * (lines 442–466). The method takes no date window — this endpoint
 * returns a point-in-time snapshot of asset state, not a period
 * aggregate, so there is NO `period` sub-DTO on the response.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getAssetUtilization` changes, this DTO must change with it.
 * TypeScript enforces it via the method's explicit
 * `Promise<AssetsResponseDto>` return type.
 */

import { ApiProperty } from '@nestjs/swagger';

export class AssetSizeRowDto {
  /** Dumpster size identifier from `assets.subtype` (e.g. "20-yard"). */
  @ApiProperty({
    description:
      'Dumpster size identifier from assets.subtype (e.g. "20-yard").',
  })
  subtype: string;

  /** Total count of assets with this subtype for the tenant. */
  @ApiProperty({
    description: 'Total count of assets with this subtype for the tenant.',
  })
  total: number;

  /** Count where `assets.status = 'available'`. */
  @ApiProperty({ description: "Count where assets.status = 'available'." })
  available: number;

  /** Count where `assets.status = 'deployed'`. */
  @ApiProperty({ description: "Count where assets.status = 'deployed'." })
  deployed: number;

  /**
   * Count where `assets.status = 'full_staged'` (NOT `'staged'`).
   * The backend filter matches `full_staged` but the projected field
   * name is `staged` for frontend brevity — a deliberate rename at
   * the projection layer, not a drift.
   */
  @ApiProperty({
    description:
      "Count where assets.status = 'full_staged'. Field name 'staged' is a deliberate projection-layer rename.",
  })
  staged: number;
}

export class AssetsResponseDto {
  /** Total asset count for the tenant (`assetRepo.count({ where: { tenant_id } })`). */
  @ApiProperty({
    description: 'Total asset count for the tenant (point-in-time).',
  })
  totalAssets: number;

  /**
   * Count-by-status map with **dynamic keys** — keys are whatever
   * `assets.status` values currently exist in the DB for this tenant
   * (typical examples: `available`, `deployed`, `full_staged`,
   * `maintenance`, etc., but the set is not enumerated on the
   * backend). Values are non-negative integer counts.
   *
   * Swagger schema note: modeled as an open object (additionalProperties).
   */
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'Dynamic-key map from assets.status values to counts. Keys are not enumerated.',
  })
  byStatus: Record<string, number>;

  /**
   * Per-subtype rollup. Each row carries the subtype label, the
   * total count, and buckets for the three named statuses tracked
   * on the Assets tab (`available`, `deployed`, `staged`).
   */
  @ApiProperty({
    type: [AssetSizeRowDto],
    description:
      'Per-subtype rollup — one row per distinct assets.subtype value.',
  })
  bySize: AssetSizeRowDto[];
}
