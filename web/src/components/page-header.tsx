import type { ReactNode } from "react";
import HelpTooltip from "./ui/HelpTooltip";

export function PageHeader({
  title,
  subtitle,
  actions,
  featureId,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  featureId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)] inline-flex items-center gap-2">
          {title}
          {featureId && <HelpTooltip featureId={featureId} />}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}

export function ControlsRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-6">{children}</div>
  );
}

/**
 * Section header — used inside pages for content sections.
 * Optionally wired to the feature registry via featureId.
 */
export function SectionHeader({
  title,
  subtitle,
  featureId,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  featureId?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className || "mb-4"}`}>
      <div>
        <h2 className="text-[17px] font-bold tracking-[-0.3px] inline-flex items-center gap-1.5" style={{ color: "var(--t-frame-text)" }}>
          {title}
          {featureId && <HelpTooltip featureId={featureId} />}
        </h2>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
