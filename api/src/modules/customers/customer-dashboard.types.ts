/**
 * Response shape for `GET /customers/:id/dashboard`.
 *
 * This is the single aggregator payload returned by
 * `CustomerDashboardService.getCustomerDashboard()`. The shape is
 * deliberately flat (no nested promises, no entity refs) so the
 * frontend can render without additional fetches.
 *
 * Note on display status: this payload returns RAW statuses, not the
 * display-status layer. The frontend uses `web/src/lib/job-status.ts
 * deriveDisplayStatus(storedStatus, invoiceStatus)` to map to the
 * user-facing pill. Keeping display derivation client-side preserves
 * the "display-layer logic separate from execution-layer logic" rule.
 */
import type {
  StatusStrip,
  ServiceSitesState,
  FinancialSnapshot,
} from './customer-dashboard.helpers';

export interface CustomerDashboardIdentity {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  type: string;
  accountId: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  isActive: boolean;
  /** 'enabled' | 'opted_out' | 'no_phone' — derived from sms_opt_outs lookup. */
  smsStatus: 'enabled' | 'opted_out' | 'no_phone';
}

export interface CustomerDashboardJobLink {
  /** task_chain_link.id */
  linkId: string;
  sequenceNumber: number;
  taskType: string;
  /** task_chain_link.status (own status, distinct from the job's own status) */
  linkStatus: string;
  scheduledDate: string;
  /** Hydrated job fields. */
  jobId: string;
  jobNumber: string;
  jobStatus: string;
  jobType: string;
  assetSubtype: string | null;
  /** Optional linked invoice status hint for client-side display derivation. */
  linkedInvoiceStatus: string | null;
  previousLinkId: string | null;
  nextLinkId: string | null;
}

export interface CustomerDashboardChain {
  chainId: string;
  status: string;
  dropOffDate: string;
  expectedPickupDate: string | null;
  dumpsterSize: string | null;
  links: CustomerDashboardJobLink[];
}

export interface CustomerDashboardStandaloneJob {
  id: string;
  jobNumber: string;
  jobType: string;
  jobStatus: string;
  scheduledDate: string | null;
  assetSubtype: string | null;
  totalPrice: number;
  linkedInvoiceStatus: string | null;
}

export interface CustomerDashboardJobsTimeline {
  chains: CustomerDashboardChain[];
  standaloneJobs: CustomerDashboardStandaloneJob[];
}

export type IssueCategory =
  | 'billing'
  | 'pricing'
  | 'address'
  | 'sms_blocked';

export interface CustomerDashboardIssue {
  id: string;
  category: IssueCategory;
  description: string;
  /** Normalized severity key for UI styling. */
  severity: 'info' | 'warning' | 'critical';
  /** Route hint for the frontend to deep-link to the fix page. */
  link: string | null;
  createdAt: string | null;
}

export interface CustomerDashboardNotes {
  /** Existing internal notes timeline (customer_notes table). */
  internal: Array<{
    id: string;
    content: string;
    type: string;
    authorName: string | null;
    createdAt: string;
  }>;
  /** New dedicated driver-instructions field on customers table. */
  driverInstructions: string | null;
}

export interface CustomerDashboardResponse {
  identity: CustomerDashboardIdentity;
  statusStrip: StatusStrip;
  serviceSites: ServiceSitesState;
  jobsTimeline: CustomerDashboardJobsTimeline;
  financial: FinancialSnapshot;
  issues: CustomerDashboardIssue[];
  notes: CustomerDashboardNotes;
}
