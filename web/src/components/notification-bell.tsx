"use client";

import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";

interface Notification {
  id: string;
  message: string;
  time: string;
  href: string;
  read: boolean;
}

const sampleNotifications: Notification[] = [
  { id: "1", message: "New booking: Skip Bayless - 20yd Delivery", time: "2 min ago", href: "/jobs", read: false },
  { id: "2", message: "Invoice INV-2026-001 paid - $557.81", time: "1 hour ago", href: "/invoices", read: false },
  { id: "3", message: "Overdue: D-20-003 at 14 Copper Beech Cir", time: "3 hours ago", href: "/dispatch", read: false },
];

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(sampleNotifications);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  function handleClick(n: Notification) {
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setOpen(false);
    router.push(n.href);
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
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-[20px] overflow-hidden animate-fade-in" style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--t-border)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-brand hover:text-brand-light">
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full text-left px-4 py-3 transition-colors last:border-b-0 ${
                  n.read ? "opacity-60" : ""
                }`}
                style={{ borderBottom: "1px solid var(--t-border)" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <p className="text-xs leading-relaxed" style={{ color: "var(--t-text-primary)" }}>{n.message}</p>
                <p className="text-[10px] mt-1" style={{ color: "var(--t-text-muted)" }}>{n.time}</p>
                {!n.read && <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand mt-1" />}
              </button>
            ))}
          </div>
          <div className="px-4 py-2.5" style={{ borderTop: "1px solid var(--t-border)" }}>
            <button
              onClick={() => { setOpen(false); router.push("/notifications"); }}
              className="text-xs text-brand hover:text-brand-light font-medium"
            >
              View all notifications &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
