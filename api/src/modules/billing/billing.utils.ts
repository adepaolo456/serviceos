// Legacy utils — invoice creation should now go through InvoiceService or BillingService
// This file is kept for backward compatibility but is no longer actively used.

export function generateInvoiceNumber(): number {
  // Returns a random number — actual numbering now uses next_invoice_number() SQL function
  return Math.floor(Math.random() * 900000) + 100000;
}
