"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function CallbackHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    const refresh = searchParams.get("refresh");
    const isNew = searchParams.get("new") === "1";

    if (token && refresh) {
      api.setToken(token);
      localStorage.setItem("refreshToken", refresh);
      window.location.href = isNew ? "/onboarding/plan" : "/";
    } else {
      window.location.href = "/login?error=oauth_failed";
    }
  }, [searchParams]);

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      <p className="text-sm text-muted">Signing you in...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-primary">
      <Suspense
        fallback={
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <p className="text-sm text-muted">Loading...</p>
          </div>
        }
      >
        <CallbackHandler />
      </Suspense>
    </div>
  );
}
