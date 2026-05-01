-- =============================================================================
-- geocoding-coverage-audit.sql
-- =============================================================================
--
-- Purpose:
--   Audit geocoding coverage across customer service addresses (JSONB array)
--   and job service addresses (canonical JSONB column). Distinguishes:
--     - service_address JSONB coordinates present
--     - geocoded_at marker present
--     - geocode_failed_at marker present
--     - null / 0,0 coordinates
--     - genuinely missing address vs address present without coords
--   AND explicitly EXCLUDES jobs.placement_lat / jobs.placement_lng from the
--   "missing geocode" classification — those are reserved for a future
--   "capture dumpster placement at delivery" feature and may be permanently
--   null until that ships.
--
-- When to run:
--   When investigating routing / dispatch heatmap correctness, suspected
--   geocoding regressions, or before rolling out features that depend on
--   service-address coordinates.
--
-- Expected clean result:
--   - customers row: addr_present_no_coords = 0
--   - jobs row:      addr_present_no_coords = 0
--   - placement_dormant typically equals total jobs count (placement-at-
--     delivery feature has not yet shipped)
--
-- What counts as a finding:
--   - Any non-zero addr_present_no_coords value — address is present but
--     coordinates are missing AND no geocode_failed_at marker exists.
--     Indicates a geocoder regression or an address that was saved without
--     ever entering the geocode pipeline.
--   - High zero_zero counts (lat = 0, lng = 0) suggest sentinel-value bugs.
--   - A non-null placement_dormant once the placement-at-delivery feature
--     ships will indicate jobs that missed the new capture step; until then
--     it is informational only.
--
-- Safety:
--   SELECT-only. Read-only. No DB writes. No destructive keywords.
--
-- Notes / known false positives:
--   - coords_no_marker is cosmetic — coordinates may be correct even without
--     a geocoded_at marker if they were imported before marker plumbing.
--   - jobs.placement_lat / placement_lng being null is NOT a finding. They
--     are SEPARATE from service_address geocoding and reserved for a future
--     feature. Do NOT treat null placement_lat/lng as missing geocode data.
--
-- Source:
--   Exact SQL from May 1 2026 audit.
--
-- May 1 2026 audit baseline (production tenant):
--   - Jobs: service_address JSONB coordinates are the canonical source.
--   - 0 unprocessed geocoding candidates.
--   - 5 of 7 customer addresses lacked geocoded_at marker (cosmetic).
--   - 34 of 34 jobs had null placement_lat/lng (dormant feature, expected).
--
-- Replace <TENANT_UUID> with the target tenant before running.
-- =============================================================================

-- Geocoding coverage audit for customers (service_addresses JSONB array)
-- and jobs (placement_lat/lng numeric columns + service_address JSONB).
--
-- Read-only. No DB writes.
-- Note: jobs.placement_lat/lng are SEPARATE from service_address geocoding —
-- they are reserved for "where the dumpster was physically placed at delivery"
-- and may be permanently null until that feature ships. Do NOT treat null
-- placement_lat/lng as missing geocode data.
--
-- Replace the tenant UUID below before running.

WITH tenant AS (SELECT '<TENANT_UUID>'::uuid AS id),

-- Customer service_addresses (JSONB array), flattened to per-address rows
customer_addrs AS (
  SELECT c.id AS customer_id,
         (addr.value->>'lat')::numeric AS lat,
         (addr.value->>'lng')::numeric AS lng,
         addr.value->>'street' AS street,
         addr.value ? 'geocoded_at' AS has_geocoded_marker
  FROM customers c, LATERAL jsonb_array_elements(COALESCE(c.service_addresses, '[]'::jsonb)) AS addr
  WHERE c.tenant_id = (SELECT id FROM tenant)
),

-- Jobs: service_address JSONB is the canonical geocoding source
job_addrs AS (
  SELECT j.id,
         (j.service_address->>'lat')::numeric AS sa_lat,
         (j.service_address->>'lng')::numeric AS sa_lng,
         j.service_address ? 'geocoded_at' AS sa_has_marker,
         j.service_address ? 'geocode_failed_at' AS sa_failed_marker,
         j.service_address->>'street' AS street,
         j.placement_lat,
         j.placement_lng
  FROM jobs j
  WHERE j.tenant_id = (SELECT id FROM tenant)
)

SELECT 'customers' AS surface,
       COUNT(*)::text AS total_addresses,
       COUNT(*) FILTER (WHERE lat IS NULL OR lng IS NULL)::text AS null_coords,
       COUNT(*) FILTER (WHERE lat = 0 AND lng = 0)::text AS zero_zero,
       COUNT(*) FILTER (WHERE (lat IS NULL OR lng IS NULL) AND street IS NOT NULL AND TRIM(street) <> '')::text AS addr_present_no_coords,
       COUNT(*) FILTER (WHERE street IS NULL OR TRIM(street) = '')::text AS truly_missing_addr,
       COUNT(*) FILTER (WHERE lat IS NOT NULL AND NOT has_geocoded_marker)::text AS coords_no_marker,
       COUNT(*) FILTER (WHERE has_geocoded_marker)::text AS coords_with_marker,
       NULL::text AS placement_dormant
FROM customer_addrs
UNION ALL
SELECT 'jobs',
       COUNT(*)::text,
       COUNT(*) FILTER (WHERE sa_lat IS NULL OR sa_lng IS NULL)::text,
       COUNT(*) FILTER (WHERE sa_lat = 0 AND sa_lng = 0)::text,
       COUNT(*) FILTER (WHERE (sa_lat IS NULL OR sa_lng IS NULL) AND street IS NOT NULL AND TRIM(street) <> '' AND NOT sa_failed_marker)::text,
       COUNT(*) FILTER (WHERE street IS NULL OR TRIM(street) = '')::text,
       COUNT(*) FILTER (WHERE sa_lat IS NOT NULL AND NOT sa_has_marker)::text,
       COUNT(*) FILTER (WHERE sa_has_marker)::text,
       COUNT(*) FILTER (WHERE placement_lat IS NULL AND placement_lng IS NULL)::text
FROM job_addrs;
