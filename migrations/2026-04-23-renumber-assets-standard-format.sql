-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 2 of 2 — Asset numbering standardization
-- DO NOT APPLY IN THIS PR — APPLY MANUALLY IN SUPABASE SQL EDITOR IN ORDER
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Rewrites every `assets.identifier` in the pilot tenant to the standard
-- {prefix}-NN format. Deterministic: renumbering is partitioned by
-- (tenant_id, asset_type, subtype) and ordered by (created_at ASC, id ASC).
--
-- Prerequisite: Migration 1 MUST be applied first. The unique index it
-- creates is what guarantees the UPDATE below cannot produce a duplicate —
-- the transaction aborts with 23505 if it would.
--
-- Prefix map is an explicit VALUES list (NOT a REGEXP_REPLACE fallback)
-- mirrored from api/src/modules/assets/subtype-prefix.util.ts. Any subtype
-- not in the map raises an exception — this is deliberate; silent "" prefix
-- would produce garbage identifiers for named subtypes like 'standard'.
--
-- DRY RUN: the SELECT below shows what WILL change. Review, then uncomment
-- the UPDATE + COMMIT block. No automatic apply.
--
-- Take a database snapshot before applying. No automatic rollback.

-- ── DRY RUN — review the mapping before applying ────────────────────────────
WITH prefix_map(subtype, prefix) AS (
  VALUES
    ('10yd', '10'), ('15yd', '15'), ('20yd', '20'),
    ('30yd', '30'), ('40yd', '40'),
    ('10ft', '10'), ('20ft', '20'), ('40ft', '40'),
    ('standard', 'ST'), ('deluxe', 'DL'), ('ada', 'AD')
),
numbered AS (
  SELECT
    a.id,
    a.tenant_id,
    a.asset_type,
    a.subtype,
    a.identifier AS old_identifier,
    ROW_NUMBER() OVER (
      PARTITION BY a.tenant_id, a.asset_type, a.subtype
      ORDER BY a.created_at ASC, a.id ASC
    ) AS seq
  FROM assets a
),
formatted AS (
  SELECT
    n.id,
    n.tenant_id,
    n.asset_type,
    n.subtype,
    n.old_identifier,
    n.seq,
    p.prefix || '-' ||
      LPAD(n.seq::text, CASE WHEN n.seq >= 100 THEN 3 ELSE 2 END, '0') AS new_identifier
  FROM numbered n
  LEFT JOIN prefix_map p ON p.subtype = n.subtype
)
SELECT tenant_id, asset_type, subtype, old_identifier, new_identifier, seq
FROM formatted
ORDER BY tenant_id, asset_type, subtype, seq;

-- ── Sanity: confirm every subtype is in the prefix map (fail loudly otherwise)
-- Run this BEFORE uncommenting the UPDATE. If it returns rows, extend the
-- VALUES list above AND the SUBTYPE_PREFIX_MAP in subtype-prefix.util.ts.
WITH prefix_map(subtype, prefix) AS (
  VALUES
    ('10yd', '10'), ('15yd', '15'), ('20yd', '20'),
    ('30yd', '30'), ('40yd', '40'),
    ('10ft', '10'), ('20ft', '20'), ('40ft', '40'),
    ('standard', 'ST'), ('deluxe', 'DL'), ('ada', 'AD')
)
SELECT DISTINCT a.subtype
FROM assets a
LEFT JOIN prefix_map p ON p.subtype = a.subtype
WHERE p.prefix IS NULL;
-- Expected: 0 rows.

-- ── APPLY — uncomment the block below after reviewing the dry-run output ────
-- BEGIN;
--
-- DO $$
-- DECLARE
--   unmapped_count INT;
-- BEGIN
--   SELECT COUNT(DISTINCT a.subtype) INTO unmapped_count
--   FROM assets a
--   LEFT JOIN (VALUES
--     ('10yd'), ('15yd'), ('20yd'), ('30yd'), ('40yd'),
--     ('10ft'), ('20ft'), ('40ft'),
--     ('standard'), ('deluxe'), ('ada')
--   ) AS m(subtype) ON m.subtype = a.subtype
--   WHERE m.subtype IS NULL;
--   IF unmapped_count > 0 THEN
--     RAISE EXCEPTION 'Cannot renumber: % subtype(s) not in prefix map. Update the VALUES list and re-run.', unmapped_count;
--   END IF;
-- END $$;
--
-- WITH prefix_map(subtype, prefix) AS (
--   VALUES
--     ('10yd', '10'), ('15yd', '15'), ('20yd', '20'),
--     ('30yd', '30'), ('40yd', '40'),
--     ('10ft', '10'), ('20ft', '20'), ('40ft', '40'),
--     ('standard', 'ST'), ('deluxe', 'DL'), ('ada', 'AD')
-- ),
-- numbered AS (
--   SELECT
--     a.id,
--     ROW_NUMBER() OVER (
--       PARTITION BY a.tenant_id, a.asset_type, a.subtype
--       ORDER BY a.created_at ASC, a.id ASC
--     ) AS seq,
--     p.prefix
--   FROM assets a
--   JOIN prefix_map p ON p.subtype = a.subtype
-- )
-- UPDATE assets a
-- SET
--   identifier = n.prefix || '-' ||
--                LPAD(n.seq::text, CASE WHEN n.seq >= 100 THEN 3 ELSE 2 END, '0'),
--   updated_at = NOW()
-- FROM numbered n
-- WHERE a.id = n.id
-- RETURNING a.tenant_id, a.asset_type, a.subtype, a.identifier;
--
-- -- Fix the one known drop_off_asset_pin referencing an old-format identifier
-- -- in the pilot tenant. Verified: exactly 1 row, old value 'D-2001', new value
-- -- '20-11' (seed's first 20yd, which becomes position 11 under deterministic
-- -- renumber ordering). pick_up_asset_pin is null across this tenant — no
-- -- update needed.
-- UPDATE jobs
-- SET drop_off_asset_pin = '20-11',
--     updated_at = NOW()
-- WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
--   AND drop_off_asset_pin = 'D-2001';
-- -- Expected: UPDATE 1
--
-- COMMIT;

-- ── Post-apply verification ─────────────────────────────────────────────────
-- SELECT COUNT(*) AS non_standard
-- FROM assets
-- WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
--   AND identifier !~ '^[A-Z0-9]{2,3}-\d{2,3}$';
-- -- Expected: 0
--
-- SELECT asset_type, subtype, COUNT(*) AS n, MIN(identifier), MAX(identifier)
-- FROM assets
-- WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
-- GROUP BY asset_type, subtype
-- ORDER BY asset_type, subtype;
-- -- Expected for the pilot tenant:
-- --   dumpster  10yd  14  10-01  10-14
-- --   dumpster  15yd  15  15-01  15-15
-- --   dumpster  20yd  20  20-01  20-20
-- --   dumpster  30yd   5  30-01  30-05
-- --   dumpster  40yd   3  40-01  40-03
