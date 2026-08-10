"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Lock, FileText, ShieldAlert } from "lucide-react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "resume-admin-authenticated";

export default function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const [showStayLoggedInPrompt, setShowStayLoggedInPrompt] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [promptEmail, setPromptEmail] = useState("");
  const [promptPassword, setPromptPassword] = useState("");
  const [promptError, setPromptError] = useState("");

  const [isIdle, setIsIdle] = useState(false);
  const [countdown, setCountdown] = useState(30);

  const isIdleRef = useRef(false);
  const resetTimerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isIdleRef.current = isIdle;
  }, [isIdle]);

  useEffect(() => {
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") : null;
    const storedEmail = typeof window !== "undefined" ? window.sessionStorage.getItem("admin-email") : "";
    const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(STORAGE_KEY) : null;

    if (token && storedEmail && stored === "true") {
      // Validate token on mount
      fetch("/api/admin/auth/validate", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      })
      .then((res) => {
        if (res.ok) {
          setAuthenticated(true);
          setEmail(storedEmail);
        } else {
          // Token is invalid/expired, show stay logged in prompt to re-auth
          setShowStayLoggedInPrompt(true);
          setPromptEmail(storedEmail);
        }
        setInitialized(true);
      })
      .catch(() => {
        setShowStayLoggedInPrompt(true);
        setPromptEmail(storedEmail);
        setInitialized(true);
      });
    } else if (stored === "true" && storedEmail) {
      // Legacy session without token, prompt to log in again
      setShowStayLoggedInPrompt(true);
      setPromptEmail(storedEmail);
      setInitialized(true);
    } else {
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && !pathname.startsWith("/admin")) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      window.sessionStorage.removeItem("admin-email");
      window.sessionStorage.removeItem("admin_token");
      setAuthenticated(false);
    }
  }, [pathname]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.endsWith("@infinite.com")) {
      setError("Unauthorized domain. Please enter your @infinite.com email.");
      return;
    }

    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, password }),
        cache: "no-store"
      });

      const data = await res.json();
      if (res.ok && data.token) {
        window.sessionStorage.setItem("admin_token", data.token);
        window.sessionStorage.setItem("admin-email", cleanEmail);
        window.sessionStorage.setItem(STORAGE_KEY, "true");
        setAuthenticated(true);
        setEmail(cleanEmail);
        setError("");
      } else {
        setError(data.error || "Invalid Password");
      }
    } catch (err) {
      setError("Login verification failed. Please try again.");
    }
  };

  const handlePromptPasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: promptEmail, password: promptPassword }),
        cache: "no-store"
      });

      const data = await res.json();
      if (res.ok && data.token) {
        window.sessionStorage.setItem("admin_token", data.token);
        window.sessionStorage.setItem("admin-email", promptEmail);
        window.sessionStorage.setItem(STORAGE_KEY, "true");
        setAuthenticated(true);
        setEmail(promptEmail);
        setShowStayLoggedInPrompt(false);
        setShowPasswordPrompt(false);
        setPromptPassword("");
        setPromptError("");
      } else {
        setPromptError("Invalid password. Signing out...");
        setTimeout(() => {
          handleLogout();
        }, 1500);
      }
    } catch (err) {
      setPromptError("Verification failed. Signing out...");
      setTimeout(() => {
        handleLogout();
      }, 1500);
    }
  };

  const handleLogout = (reason?: string) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(STORAGE_KEY);
      window.sessionStorage.removeItem("admin-email");
      window.sessionStorage.removeItem("admin_token");
    }
    setAuthenticated(false);
    setEmail("");
    setPassword("");
    setError(reason && typeof reason === "string" ? reason : "");
    setShowStayLoggedInPrompt(false);
    setShowPasswordPrompt(false);
    setPromptEmail("");
    setPromptPassword("");
    setPromptError("");
    // If we're on a detailed page, redirect back to /admin so the user doesn't get stuck on detail page
    if (typeof window !== "undefined" && window.location.pathname !== "/admin") {
      window.location.href = "/admin";
    }
  };

  useEffect(() => {
    if (!authenticated) return;

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
  }, [authenticated]);

  useEffect(() => {
    let countdownTimer: any;
    if (isIdle) {
      countdownTimer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownTimer);
            handleLogout("You have been logged out due to inactivity.");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(countdownTimer);
  }, [isIdle]);

  if (!initialized) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 flex items-center justify-center text-foreground transition-colors duration-300">
        <div className="text-muted-foreground font-medium">Loading admin gateway…</div>
      </div>
    );
  }

  if (showStayLoggedInPrompt) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 flex items-center justify-center px-4 py-12 transition-colors duration-300">
        <Card className="w-full max-w-md p-8 bg-card border border-border shadow-card rounded-3xl">
          <div className="flex flex-col items-center gap-4 text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-md shadow-indigo-500/30">
              <Lock className="w-6 h-6 text-white animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Stay Logged In?</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We detected an active session for <span className="font-bold text-primary">{promptEmail}</span>.<br />
              Do you want to stay logged in?
            </p>
          </div>

          {!showPasswordPrompt ? (
            <div className="flex flex-col gap-3 pt-2">
              <Button
                onClick={() => setShowPasswordPrompt(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-500/30 transition-all font-bold"
              >
                Yes
              </Button>
              <Button
                variant="outline"
                onClick={() => handleLogout()}
                className="w-full rounded-xl border-border text-primary hover:bg-secondary font-bold"
              >
                No (Sign out)
              </Button>
            </div>
          ) : (
            <form onSubmit={handlePromptPasswordSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-sm font-semibold text-muted-foreground">Password</label>
                <input
                  type="password"
                  value={promptPassword}
                  autoFocus
                  onChange={(event) => setPromptPassword(event.target.value)}
                  className="w-full rounded-xl border border-indigo-250 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 text-foreground focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition"
                  required
                />
              </div>

              {promptError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                  {promptError}
                </div>
              )}

              <div className="flex flex-col gap-3 pt-2">
                <Button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-500/30 transition-all font-bold"
                >
                  Verify
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleLogout()}
                  className="w-full rounded-xl border-border text-primary hover:bg-secondary font-bold"
                >
                  Sign out
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 flex items-center justify-center px-4 py-12 transition-colors duration-300">
        <Card className="w-full max-w-md p-8 bg-card border border-border shadow-card rounded-3xl">
          <div className="flex flex-col items-center gap-4 text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-md shadow-indigo-500/30">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Admin Screening Console</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">Enter your credentials to access the screening dashboard.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-muted-foreground">Email Address</label>
              <input
                type="email"
                placeholder="e.g. user@infinite.com"
                value={email}
                autoFocus
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-indigo-250 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 text-foreground focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition"
                required
              />
            </div>
            
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-muted-foreground">Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-indigo-250 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 text-foreground focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition"
                required
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-500/30 transition-all font-bold">
                Access
              </Button>
              <Link href="/">
                <Button variant="outline" className="w-full rounded-xl border-border text-primary hover:bg-secondary font-bold">Return Home</Button>
              </Link>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md rounded-xl shadow-soft border border-border px-3 py-2">
        <span className="text-xs font-semibold text-primary truncate max-w-[120px]">{email}</span>
        <Button variant="outline" size="sm" onClick={() => handleLogout()} className="gap-2 rounded-lg border-border text-primary hover:bg-secondary">
          <Lock className="w-3.5 h-3.5" /> Sign out
        </Button>
      </div>
      {children}

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
