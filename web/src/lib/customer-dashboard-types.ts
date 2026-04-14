/**
 * TypeScript mirror of the backend response for
 * `GET /customers/:id/dashboard`. Must stay in sync with
 * `api/src/modules/customers/customer-dashboard.types.ts`.
 */
import type {
  SeverityKey,
  StatusReasonKey,
  SmsStatusKey,
  FinancialStateKey,
  IssueCategoryKey,
  IssueSeverityKey,
} from "./customer-dashboard-labels";

export interface DashboardIdentity {
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
  smsStatus: SmsStatusKey;
}

export interface DashboardStatusStrip {
  severity: SeverityKey;
  reasons: StatusReasonKey[];
}

export interface DashboardServiceSite {
  address: Record<string, any>;
  hasCoordinates: boolean;
  geocodeSource: string | null;
}

export interface DashboardServiceSitesState {
  primary: DashboardServiceSite | null;
  all: DashboardServiceSite[];
  geocodeFailureCount: number;
}

export interface DashboardJobLink {
  linkId: string;
  sequenceNumber: number;
  taskType: string;
  linkStatus: string;
  scheduledDate: string;
  jobId: string;
  jobNumber: string;
  jobStatus: string;
  jobType: string;
  assetSubtype: string | null;
  // Live driver assignment for the driver-aware
  // `deriveDisplayStatus` object form. Mirrors the backend
  // CustomerDashboardJobLink.assignedDriverId field.
  assignedDriverId: string | null;
  linkedInvoiceStatus: string | null;
  previousLinkId: string | null;
  nextLinkId: string | null;
}

export interface DashboardChain {
  chainId: string;
  status: string;
  dropOffDate: string;
  expectedPickupDate: string | null;
  dumpsterSize: string | null;
  links: DashboardJobLink[];
}

export interface DashboardStandaloneJob {
  id: string;
  jobNumber: string;
  jobType: string;
  jobStatus: string;
  scheduledDate: string | null;
  assetSubtype: string | null;
  totalPrice: number;
  /** Live driver assignment — see DashboardJobLink.assignedDriverId. */
  assignedDriverId: string | null;
  linkedInvoiceStatus: string | null;
}

export interface DashboardJobsTimeline {
  chains: DashboardChain[];
  standaloneJobs: DashboardStandaloneJob[];
}

export interface DashboardFinancial {
  outstandingBalance: number;
  unpaidCount: number;
  overdueCount: number;
  overdueThirtyPlusCount: number;
  latestInvoice: {
    id: string;
    status: string;
    total: number;
    balance_due: number;
  } | null;
  state: FinancialStateKey;
}

export interface DashboardIssue {
  id: string;
  category: IssueCategoryKey;
  description: string;
  severity: IssueSeverityKey;
  link: string | null;
  createdAt: string | null;
}

export interface DashboardNotes {
  internal: Array<{
    id: string;
    content: string;
    type: string;
    authorName: string | null;
    createdAt: string;
  }>;
  driverInstructions: string | null;
}

export interface CustomerDashboardResponse {
  identity: DashboardIdentity;
  statusStrip: DashboardStatusStrip;
  serviceSites: DashboardServiceSitesState;
  jobsTimeline: DashboardJobsTimeline;
  financial: DashboardFinancial;
  issues: DashboardIssue[];
  notes: DashboardNotes;
}
