/** Format dumpster size for display: "20yd" → "20 Yard" */
export function formatDumpsterSize(size: string | null | undefined): string {
  if (!size) return "Unknown";
  return size.replace("yd", " Yard");
}

/** Format phone string to (XXX) XXX-XXXX */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone; // return as-is if non-standard length
}

/** Map internal booking/job source codes to business-friendly display labels */
const SOURCE_DISPLAY_LABELS: Record<string, string> = {
  phone: "Phone Orders",
  portal: "Online Bookings",
  manual: "Manual Entry",
  schedule_next: "Scheduled Follow-Ups",
  exchange: "Exchange",
  marketplace: "Marketplace",
  rescheduled_from_failure: "Rescheduled Jobs",
  other: "Other",
};

export function formatSourceLabel(source: string): string {
  return SOURCE_DISPLAY_LABELS[source] ?? source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format currency to $X,XXX.XX (always 2 decimals, comma separators) */
export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return "$0.00";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "$0.00";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
