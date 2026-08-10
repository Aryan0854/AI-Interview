"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, CheckCircle2, AlertCircle, Loader2, Sparkles, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ThemeToggle from "@/components/ThemeToggle";

const rules = [
  { label: "Minimum 8 characters",        test: (value: string) => value.length >= 8 },
  { label: "Uppercase letter",            test: (value: string) => /[A-Z]/.test(value) },
  { label: "Lowercase letter",            test: (value: string) => /[a-z]/.test(value) },
  { label: "Number",                      test: (value: string) => /[0-9]/.test(value) },
  { label: "Special character",           test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

function getStrength(value: string) {
  const score = rules.filter((rule) => rule.test(value)).length;
  if (score <= 2) return "Weak";
  if (score === 3 || score === 4) return "Medium";
  return "Strong";
}

function InnerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const employeeId = searchParams.get("employee_id") ?? "";
  const org = searchParams.get("org") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const strength = useMemo(() => getStrength(password), [password]);

  useEffect(() => {
    if (!employeeId) {
      router.replace("/employee");
    }
  }, [employeeId, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!employeeId) {
      setError("Missing employee identifier.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (getStrength(password) === "Weak") {
      setError("Password strength must be Medium or Strong.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/employee/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: employeeId, password }),
      });
      let result: any = null;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        result = await response.json();
      }

      if (!response.ok) {
        setError(result?.error || `Unable to set password (Server returned status ${response.status}).`);
        return;
      }
      if (result && result.status === "ok" && result.token) {
        window.localStorage.setItem("employee_token", result.token);
        setSuccess("Password set successfully. Redirecting to your learning portal…");
        window.setTimeout(() => router.push("/employee/dashboard"), 1200);
        return;
      }
      setError("Failed to complete password setup.");
    } catch (err: any) {
      setError(err?.message || "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8fafc] via-[#f0f4ff] to-[#e0e7ff] dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center px-4 py-6 relative overflow-hidden transition-colors duration-300">
      {/* Background decorative elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 left-10 w-72 h-72 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-700/5 rounded-full blur-[120px]" />
      </div>

      {/* Theme Toggler */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* ── Go Back link ────────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 z-20">
        <Link href={org ? `/employee?org=${encodeURIComponent(org)}` : "/employee"}>
          <Button
            variant="ghost"
            size="sm"
            className="group flex items-center gap-2 text-muted-foreground hover:text-slate-700 dark:hover:text-white hover:bg-indigo-50/50 dark:hover:bg-white/10 rounded-xl px-3.5 py-2 transition-all duration-200"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
            <span className="font-semibold text-xs">Back to Login</span>
          </Button>
        </Link>
      </div>

      <Card className="w-full max-w-md p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-indigo-50 dark:border-slate-700/50 shadow-2xl shadow-indigo-500/5 dark:shadow-black/35 relative overflow-hidden transition-colors duration-300">
        {/* Top accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500" />

        {/* Side accent glow */}
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="mb-4 text-center relative z-10">
          {/* Logo mark */}
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg shadow-indigo-500/40 ring-2 ring-white/[0.08]">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
            {org ? `${org} Portal Password` : "Set Your Password"}
          </h1>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
            Create a secure password for your {org ? `${org} Portal` : "Employee Portal"} access.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-4 py-2.5 text-xs text-red-400 mb-4 flex items-center gap-2 relative z-10">
            <span className="text-sm leading-none">⚠</span>
            <span className="font-medium">{error}</span>
          </div>
        ) : null}

        {success ? (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-2.5 text-xs text-emerald-400 mb-4 flex items-center gap-2 relative z-10">
            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-medium">{success}</span>
          </div>
        ) : null}

        <form className="space-y-4 relative z-10" onSubmit={handleSubmit}>
          {/* Employee ID */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
              Employee ID
            </label>
            <input
              className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-650 bg-slate-100/60 dark:bg-slate-900/60 px-4 py-2.5 text-slate-550 dark:text-slate-400 font-medium outline-none cursor-not-allowed"
              value={employeeId}
              readOnly
            />
          </div>

          {/* New Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
              New Password
            </label>
            <input
              type="password"
              className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-600/80 bg-slate-50/50 dark:bg-slate-900/60 px-4 py-2.5 text-slate-900 dark:text-white font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:bg-white dark:focus:bg-slate-900/80 transition-all"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Create a strong password"
              autoComplete="new-password"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
              Confirm Password
            </label>
            <input
              type="password"
              className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-600/80 bg-slate-50/50 dark:bg-slate-900/60 px-4 py-2.5 text-slate-900 dark:text-white font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:bg-white dark:focus:bg-slate-900/80 transition-all"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
            />
          </div>

          {/* Password Strength Checklist */}
          <div className="rounded-xl border border-indigo-100 dark:border-slate-700/50 bg-indigo-50/30 dark:bg-slate-900/40 p-3.5 text-xs">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <span className="font-bold text-indigo-700 dark:text-indigo-400">Strength:</span>
              <Badge className={strength === "Strong" ? "bg-emerald-500 text-white" : strength === "Medium" ? "bg-amber-500 text-white" : "bg-slate-200 dark:bg-slate-700 text-muted-foreground"}>{strength}</Badge>
            </div>
            <div className="space-y-1.5">
              {rules.map((rule) => (
                <div key={rule.label} className="flex items-center gap-2">
                  {rule.test(password) ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
                  )}
                  <span className={rule.test(password) ? "text-slate-800 dark:text-slate-200 font-medium" : "text-muted-foreground"}>{rule.label}</span>
                </div>
              ))}
            </div>
          </div>

          <Button 
            className="w-full px-4 py-2.5 rounded-xl bg-primary hover:from-indigo-500 hover:to-violet-500 text-white font-bold shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 transition-all duration-200" 
            type="submit" 
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving password…
              </span>
            ) : (
              "Set password"
            )}
          </Button>
        </form>

        <div className="mt-4 flex items-center gap-2 text-center text-[11px] text-muted-foreground justify-center">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <p>After setup, you will be redirected to your dashboard.</p>
        </div>
      </Card>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-[#f8fafc] via-[#f0f4ff] to-[#e0e7ff] dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        </div>
      </div>
    }>
      <InnerPage />
    </Suspense>
  );
}
