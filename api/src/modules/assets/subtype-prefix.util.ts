import { BadRequestException } from '@nestjs/common';

// Authoritative subtype → identifier-prefix map.
//
// Mirrored in migrations/2026-04-23-renumber-assets-standard-format.sql as a
// VALUES() CTE. When adding a subtype, update BOTH this file AND that SQL.
// The renumber migration RAISE EXCEPTIONs if it encounters a subtype not in
// its VALUES list, so a mismatch fails loudly rather than silently writing
// a garbage identifier.
//
// Prefix collisions across asset_type (e.g. 10yd dumpster and 10ft storage
// container both map to "10") are deliberate. The DB unique index is
// (tenant_id, asset_type, identifier), so "10-01" is a distinct asset under
// asset_type='dumpster' vs asset_type='storage_container'.
export const SUBTYPE_PREFIX_MAP: Record<string, string> = {
  '10yd': '10',
  '15yd': '15',
  '20yd': '20',
  '30yd': '30',
  '40yd': '40',
  '10ft': '10',
  '20ft': '20',
  '40ft': '40',
  standard: 'ST',
  deluxe: 'DL',
  ada: 'AD',
};

export function getSubtypePrefix(subtype: string): string {
  const prefix = SUBTYPE_PREFIX_MAP[subtype];
  if (!prefix) {
    throw new BadRequestException(
      `Unknown asset subtype "${subtype}". To add a new subtype, update SUBTYPE_PREFIX_MAP in api/src/modules/assets/subtype-prefix.util.ts AND the VALUES list in the renumber migration.`,
    );
  }
  return prefix;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
