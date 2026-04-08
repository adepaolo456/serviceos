/**
 * Phone number normalization utilities.
 * V1: US numbers only (+1).
 */

/**
 * Normalize a phone number to E.164 format.
 * Returns null if input is invalid.
 *
 * Examples:
 *   "5085551234"       → "+15085551234"
 *   "(508) 555-1234"   → "+15085551234"
 *   "+15085551234"     → "+15085551234"
 *   "15085551234"      → "+15085551234"
 *   ""                 → null
 *   "abc"              → null
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Strip everything except digits and leading +
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');

  if (digits.length < 10) return null;

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  if (hasPlus && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

/**
 * Check if a phone string can be normalized to a valid E.164 number.
 */
export function isValidPhone(phone: string | null | undefined): boolean {
  return normalizePhone(phone) !== null;
}

/**
 * Format an E.164 phone number for display: +15085551234 → (508) 555-1234
 */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return '';
  const digits = e164.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return e164;
}
