import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">
          {title}
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
