import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';

export function generateInvoiceNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `INV-${dateStr}-${seq}`;
}

export async function createInvoice(
  invoiceRepo: Repository<Invoice>,
  params: {
    tenantId: string;
    customerId: string;
    jobId?: string;
    source: string;
    invoiceType: string;
    lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
    status?: string;
    paymentMethod?: string;
    notes?: string;
  },
): Promise<Invoice> {
  const subtotal = params.lineItems.reduce((s, i) => s + i.amount, 0);
  const isPaid = params.status === 'paid';

  const invoice = invoiceRepo.create({
    tenant_id: params.tenantId,
    invoice_number: generateInvoiceNumber(),
    customer_id: params.customerId,
    job_id: params.jobId || null,
    status: params.status || 'draft',
    source: params.source,
    invoice_type: params.invoiceType,
    payment_method: params.paymentMethod,
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    subtotal,
    total: subtotal,
    amount_paid: isPaid ? subtotal : 0,
    balance_due: isPaid ? 0 : subtotal,
    line_items: params.lineItems,
    notes: params.notes,
    paid_at: isPaid ? new Date() : null,
  } as Partial<Invoice>);

  return invoiceRepo.save(invoice);
}
