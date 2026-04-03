"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bell, AlertTriangle, XCircle, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface Alert {
  id: string;
  type: string;
  severity: string;
  classification: string;
  title: string;
  message: string;
  href: string;
  createdAt: string;
  read: boolean;
}

interface AlertsResponse {
  generatedAt: string;
  unreadCount: number;
  alerts: Alert[];
}

const SEVERITY_ICON: Record<string, typeof XCircle> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "var(--t-error)",
  warning: "var(--t-warning)",
  info: "var(--t-text-muted)",
};

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const fetchAlerts = useCallback(() => {
    api.get<AlertsResponse>("/reporting/alerts")
      .then((res) => {
        setAlerts(res.alerts || []);
        const unread = (res.alerts || []).filter(a => !readIds.has(a.id) && a.severity !== "info").length;
        setUnreadCount(unread);
      })
      .catch(() => {});
  }, [readIds]);

  // Fetch on mount and every 5 minutes
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function markAllRead() {
    setReadIds(new Set(alerts.map(a => a.id)));
    setUnreadCount(0);
  }

  function handleClick(alert: Alert) {
    setReadIds(prev => new Set([...prev, alert.id]));
    setUnreadCount(prev => Math.max(0, prev - (readIds.has(alert.id) ? 0 : 1)));
    setOpen(false);
    router.push(alert.href);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div ref={ref} className="fixed top-4 right-6 z-[45]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg shadow-lg transition-colors"
        style={{ backgroundColor: "var(--t-frame-bg)", border: "1px solid var(--t-frame-border)", color: "var(--t-frame-text)" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-frame-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--t-frame-bg)"; }}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold" style={{ backgroundColor: "var(--t-error)", color: "#fff" }}>
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 rounded-[20px] overflow-hidden animate-fade-in" style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", boxShadow: "0 8px 30px var(--t-shadow)" }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--t-border)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>Alerts</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] font-medium" style={{ color: "var(--t-accent)" }}>
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>No alerts</p>
              </div>
            ) : alerts.map((a) => {
              const Icon = SEVERITY_ICON[a.severity] || Info;
              const color = SEVERITY_COLOR[a.severity] || "var(--t-text-muted)";
              const isRead = readIds.has(a.id);
              const isLegacy = a.classification === "legacy";
              return (
                <button
                  key={a.id}
                  onClick={() => handleClick(a)}
                  className="w-full text-left px-4 py-3 transition-colors flex gap-3"
                  style={{ borderBottom: "1px solid var(--t-border)", opacity: isRead || isLegacy ? 0.5 : 1 }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium truncate" style={{ color: "var(--t-text-primary)" }}>{a.title}</p>
                      {isLegacy && (
                        <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--t-bg-card)", color: "var(--t-text-muted)", border: "1px solid var(--t-border)" }}>Legacy</span>
                      )}
                    </div>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--t-text-muted)" }}>{a.message}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--t-text-muted)", opacity: 0.6 }}>{timeAgo(a.createdAt)}</p>
                  </div>
                  {!isRead && !isLegacy && <span className="h-2 w-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: color }} />}
                </button>
              );
            })}
          </div>
          <div className="px-4 py-2.5" style={{ borderTop: "1px solid var(--t-border)" }}>
            <button
              onClick={() => { setOpen(false); router.push("/analytics"); }}
              className="text-xs font-medium"
              style={{ color: "var(--t-accent)" }}
            >
              View full integrity report &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
