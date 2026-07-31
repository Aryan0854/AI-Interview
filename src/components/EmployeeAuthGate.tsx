"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, LogOut, BookOpen, Sparkles, ShieldAlert, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function employeeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "EP").toUpperCase();
}

function navLinkClass(isActive: boolean): string {
  return [
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all duration-200 sm:text-sm sm:px-3.5",
    isActive
      ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/25"
      : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
  ].join(" ");
}

export default function EmployeeAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [assessmentOnly, setAssessmentOnly] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState<{
    employee_id: string;
    full_name: string;
  } | null>(null);

  const [isIdle, setIsIdle] = useState(false);
  const [countdown, setCountdown] = useState(30);

  const isIdleRef = useRef(false);
  const resetTimerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isIdleRef.current = isIdle;
  }, [isIdle]);

  useEffect(() => {
    if (loading) return;
    const isLearn = pathname === "/employee/learn" || pathname.startsWith("/employee/learn/");

    if (assessmentOnly && isLearn) {
      router.replace("/employee/dashboard");
    }
  }, [pathname, loading, router, assessmentOnly]);

  useEffect(() => {
    const token = window.localStorage.getItem("employee_token");
    if (!token) {
      router.replace("/employee");
      return;
    }

    fetch("/api/employee/auth/validate", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) {
          window.localStorage.removeItem("employee_token");
          router.replace("/employee");
          return;
        }
        const data = await res.json();
        setAssessmentOnly(data?.employee?.assessment_only === true);
        setEmployeeProfile({
          employee_id: data?.employee?.employee_id ?? "",
          full_name: data?.employee?.full_name ?? "",
        });
        setLoading(false);
      })
      .catch(() => {
        window.localStorage.removeItem("employee_token");
        router.replace("/employee");
      });
  }, [router]);

  function handleLogout(reason?: string) {
    window.localStorage.removeItem("employee_token");
    if (reason && typeof reason === "string") {
      router.push(`/employee?reason=${encodeURIComponent(reason)}`);
    } else {
      router.push("/employee");
    }
  }

  const employeeName =
    employeeProfile?.full_name?.trim() &&
    employeeProfile.full_name.trim() !== employeeProfile.employee_id
      ? employeeProfile.full_name.trim()
      : employeeProfile?.full_name?.trim() || employeeProfile?.employee_id || "Employee";

  const employeeId = employeeProfile?.employee_id?.trim() || "—";
  const initials = employeeInitials(employeeName);

  const isLearnActive =
    pathname === "/employee/learn" || pathname.startsWith("/employee/learn/");
  const isDashboardActive = pathname === "/employee/dashboard" || pathname.startsWith("/employee/tests/");

  useEffect(() => {
    if (loading) return;

    let idleTimer: any;

    const resetTimer = () => {
      if (isIdleRef.current) return;

      setIsIdle(false);
      setCountdown(30);
      clearTimeout(idleTimer);
      
      // Start 3 minute idle timeout (180,000 ms)
      idleTimer = setTimeout(() => {
        setIsIdle(true);
      }, 180000);
    };

    resetTimerRef.current = resetTimer;

    const events = ["mousemove", "keydown", "click", "scroll"];
    events.forEach(event => {
      window.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
      clearTimeout(idleTimer);
      events.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [loading]);

  useEffect(() => {
    let countdownTimer: any;
    if (isIdle) {
      countdownTimer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownTimer);
            handleLogout("inactivity");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(countdownTimer);
  }, [isIdle]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-white to-violet-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center px-4 py-12">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="rounded-3xl border border-border bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-8 py-10 text-center shadow-card"
        >
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/30">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
          <p className="text-primary font-semibold">Verifying your portal access…</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 text-foreground transition-colors duration-300">
      <header className="sticky top-0 z-50 border-b border-indigo-100/70 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-[4.25rem] items-center justify-between gap-3">
            <Link href="/employee/dashboard" className="flex min-w-0 items-center gap-3 shrink-0">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/20">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0 hidden sm:block">
                <p className="truncate text-sm font-extrabold tracking-tight text-foreground sm:text-[15px]">
                  Employee Learning Portal
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  Assessments, analytics & growth
                </p>
              </div>
            </Link>

            {employeeProfile && (
              <div className="hidden lg:flex min-w-0 max-w-xs xl:max-w-sm items-center gap-3 rounded-2xl border border-indigo-100/80 dark:border-slate-800 bg-gradient-to-r from-indigo-50/80 to-violet-50/50 dark:from-slate-900 dark:to-slate-900/50 px-3 py-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-extrabold text-white shadow-md shadow-indigo-500/20">
                  {initials}
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-bold text-foreground">{employeeName}</p>
                  <p className="truncate text-[11px] font-medium text-muted-foreground">
                    Emp ID · <span className="font-semibold text-indigo-700 dark:text-indigo-300">{employeeId}</span>
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <nav className="flex items-center gap-0.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 p-1">
                {!assessmentOnly && (
                  <Link href="/employee/learn" className={navLinkClass(isLearnActive)}>
                    <BookOpen className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">Topics</span>
                  </Link>
                )}
                <Link href="/employee/dashboard" className={navLinkClass(isDashboardActive)}>
                  <BarChart3 className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">{assessmentOnly ? "Assessment" : "Analytics"}</span>
                </Link>
              </nav>

              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 rounded-xl px-2.5 text-slate-600 hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-950/30 dark:hover:text-red-400 sm:px-3"
                onClick={() => handleLogout()}
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline text-xs font-bold">Logout</span>
              </Button>
            </div>
          </div>

          {employeeProfile && (
            <div className="lg:hidden flex items-center gap-2.5 border-t border-indigo-100/60 dark:border-slate-800 px-1 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-extrabold text-white">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{employeeName}</p>
                <p className="text-[11px] text-muted-foreground">
                  Emp ID · <span className="font-semibold text-indigo-700 dark:text-indigo-300">{employeeId}</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </header>
      <main>{children}</main>

      {isIdle && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm animate-fade-in">
          <Card className="w-full max-w-sm p-6 bg-card border border-amber-250 dark:border-amber-900/50 shadow-2xl rounded-3xl text-center transform scale-100 transition-all duration-300">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <ShieldAlert className="w-6 h-6 text-white animate-bounce" />
              </div>
              <h2 className="text-xl font-black text-foreground">Inactivity Warning</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                You have been inactive for a while. For security, you will be logged out in:
              </p>
              <span className="text-4xl font-extrabold text-amber-500 dark:text-amber-400 my-2 block">
                {countdown}s
              </span>
              <Button
                onClick={() => {
                  setIsIdle(false);
                  setCountdown(30);
                  if (resetTimerRef.current) {
                    resetTimerRef.current();
                  }
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-500/25 transition duration-200 font-bold text-xs py-2.5"
              >
                Stay Connected
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
