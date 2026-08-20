"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function EmployeeSsoCompletePage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/employee/auth/microsoft/handoff", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.token) {
          throw new Error(data.error || "Microsoft sign-in did not complete.");
        }
        if (cancelled) return;
        window.localStorage.setItem("employee_token", data.token);
        router.replace("/employee/dashboard");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Microsoft sign-in failed.";
        if (!cancelled) {
          setError(message);
          router.replace(`/employee?sso_error=${encodeURIComponent(message)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200 text-sm font-medium">
      {error || "Finishing Microsoft sign-in…"}
    </div>
  );
}
