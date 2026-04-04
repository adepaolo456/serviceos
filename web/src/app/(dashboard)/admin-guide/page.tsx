"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminGuideRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/admin-guide");
  }, [router]);
  return (
    <div className="py-20 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>
      Redirecting to Admin...
    </div>
  );
}
