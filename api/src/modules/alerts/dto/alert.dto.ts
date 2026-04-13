/**
 * Phase 14 — Alerts / Exceptions DTOs
 *
 * Plain interfaces (no class-validator), matching the codebase
 * convention established by billing-audit.dto.ts and friends.
 */

export type AlertType =
  | 'overdue_rental'
  | 'missing_dump_slip'
  | 'missing_asset'
  | 'abnormal_disposal'
  | 'low_margin_chain'
  | 'lifecycle_integrity';

export type AlertSeverity = 'high' | 'medium' | 'low';

export type AlertStatus = 'active' | 'resolved' | 'dismissed';

export type AlertEntityType =
  | 'job'
  | 'rental_chain'
  | 'asset'
  | 'invoice'
  | 'customer';

export interface ListAlertsQuery {
  severity?: AlertSeverity;
  alert_type?: AlertType;
  entity_type?: AlertEntityType;
  include_resolved?: boolean;
}

export interface AlertSummary {
  total: number; // active count only
  by_severity: Record<AlertSeverity, number>;
  by_type: Partial<Record<AlertType, number>>;
  last_detected_at: string | null;
}

/**
 * Shape produced by each private detector method in AlertDetectorService
 * before it is reconciled with the stored `alerts` rows. Converted to
 * database rows by syncDerivedAlerts.
 */
export interface DerivedAlert {
  alert_type: AlertType;
  severity: AlertSeverity;
  entity_type: AlertEntityType;
  entity_id: string;
  message: string; // registry feature key
  metadata: Record<string, unknown>;
}
