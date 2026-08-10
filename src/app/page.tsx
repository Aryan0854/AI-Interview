"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Loader2,
  AlertCircle,
  Sparkles,
  Mail,
  ArrowRight,
  ShieldCheck,
  Menu,
  X,
  Camera,
  Monitor,
  AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ThemeToggle from "@/components/ThemeToggle";


export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleAccessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/interview/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const body = await response.json();

      if (!response.ok || !body.success) {
        throw new Error(body?.message || "Verification failed");
      }

      // Redirect directly to their personalized interview screen
      router.push(`/interview/${body.resumeId}`);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8fafc] via-[#f0f4ff] to-[#e0e7ff] dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-foreground font-sans transition-colors duration-300">
      {/* Navigation */}
      <nav className="relative z-50 sticky top-0 bg-card/80 backdrop-blur-md border-b border-border/80 transition-colors duration-300">
        <div className="max-w-full mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-md shadow-indigo-500/30">
              <Mail className="w-[18px] h-[18px] text-white" />
            </div>
            <span className="text-lg md:text-xl font-black tracking-tight bg-primary bg-clip-text text-transparent">
              <span className="hidden sm:inline">BizX </span>Interview Portal
            </span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-3">
            <Link href="/employee?org=BizX">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-sm font-bold border-border text-primary hover:bg-secondary hover:text-indigo-800 transition-all shadow-sm"
              >
                Employee Portal
              </Button>
            </Link>
            <Link href="/admin">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-sm font-bold border-border text-primary hover:bg-secondary hover:text-indigo-800 transition-all shadow-sm"
              >
                Admin Portal
              </Button>
            </Link>
            <ThemeToggle />
            <div className="w-9 h-9 rounded-full bg-primary border-2 border-border flex items-center justify-center cursor-pointer hover:shadow-md hover:shadow-indigo-500/25 transition-all">
              <Shield className="w-4 h-4 text-white" />
            </div>
          </div>

          {/* Mobile Navigation Toggle */}
          <div className="flex md:hidden items-center space-x-2">
            <ThemeToggle />
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-muted-foreground hover:text-indigo-600 focus:outline-none rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
              aria-label="Toggle navigation menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden border-t border-border/80 bg-card/95 backdrop-blur-md px-6 py-4 flex flex-col space-y-3.5 shadow-lg overflow-hidden"
            >
              <Link href="/employee?org=BizX" onClick={() => setIsMobileMenuOpen(false)}>
                <Button
                  variant="outline"
                  className="w-full rounded-xl text-sm font-bold border-border text-primary hover:bg-secondary hover:text-indigo-800 transition-all py-3 justify-center shadow-sm"
                >
                  Employee Portal
                </Button>
              </Link>
              <Link href="/admin" onClick={() => setIsMobileMenuOpen(false)}>
                <Button
                  variant="outline"
                  className="w-full rounded-xl text-sm font-bold border-border text-primary hover:bg-secondary hover:text-indigo-800 transition-all py-3 justify-center shadow-sm"
                >
                  Admin Portal
                </Button>
              </Link>
              <div className="flex items-center justify-between pt-3 border-t border-border/50 text-xs font-semibold text-slate-500">
                <span>Enterprise Secure Evaluation</span>
                <div className="w-8 h-8 rounded-full bg-primary border border-border flex items-center justify-center">
                  <Shield className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-6 md:pt-10 pb-8 px-6 max-w-6xl mx-auto flex flex-col space-y-6">
        
        {/* Title and Welcome description */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-3"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 dark:bg-slate-900/60 dark:border-slate-800">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-black tracking-wider text-primary uppercase">
              Technical Interview Session
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-foreground leading-tight">
            Secure Candidate Assessment
          </h1>
          <p className="text-sm md:text-base text-muted-foreground max-w-3xl leading-relaxed font-medium">
            Welcome to your technical assessment. Enter your registered email address to check your invitation and enter the voice-based coding evaluation. 
          </p>
        </motion.div>

        {/* Two Columns Grid for Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          
          {/* Left Column - Assessment Rules & Integrity Policy */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="bg-card/70 backdrop-blur-sm border border-border rounded-3xl p-6 shadow-sm space-y-4 flex flex-col justify-between"
          >
            <div>
              <h3 className="text-xs font-black text-primary uppercase tracking-widest mb-3">
                Assessment Rules & Integrity Policy
              </h3>
              <div className="space-y-3.5">
                <div className="flex items-start gap-3">
                  <Camera className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-extrabold text-foreground">Camera & Audio Monitoring</h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-semibold mt-0.5">
                      Real-time webcam and microphone verification is active. Only one candidate must be visible, and background conversations are flagged.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Monitor className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-extrabold text-foreground">Strict Browser Focus</h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-semibold mt-0.5">
                      Exiting fullscreen mode, switching browser tabs, minimizing the window, or opening other applications is strictly prohibited.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-extrabold text-foreground">Three-Strike Warning System</h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-semibold mt-0.5">
                      Violations immediately trigger system warnings. Exceeding 3 warnings will result in the test automatically submitting your progress.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right Column - Enter Interview (Verification Gate) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex"
          >
            <Card className="p-6 md:p-8 bg-card border border-border shadow-xl rounded-3xl relative overflow-hidden flex flex-col justify-between w-full">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-primary" />
              
              <div>
                <div className="mb-4">
                  <h2 className="text-lg md:text-xl font-black text-foreground mb-1">Enter Interview</h2>
                  <p className="text-xs text-muted-foreground font-semibold">Provide your credentials to join your assigned session.</p>
                </div>

                <form onSubmit={handleAccessSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="text-[11px] font-black text-muted-foreground uppercase tracking-wider">
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <input
                        id="email"
                        type="email"
                        placeholder="e.g. candidate@domain.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm text-foreground focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition font-medium"
                        required
                      />
                    </div>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50 text-rose-600 flex items-start gap-2.5 text-xs font-semibold leading-relaxed"
                      >
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{error}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-11 bg-primary hover:from-indigo-700 hover:to-violet-700 text-white rounded-2xl font-bold shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Verifying Access…
                      </>
                    ) : (
                      <>
                        Join Assessment <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </form>
              </div>
              
              <div className="text-center pt-3 border-t border-slate-100 dark:border-slate-800 mt-4">
                <Link
                  href="/employee?org=BizX"
                  className="text-xs text-primary font-bold hover:underline inline-flex items-center gap-1 focus:outline-none"
                >
                  Are you an employee? Access your portal to take assessments <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </Card>
          </motion.div>
        </div>

      </section>

    </div>
  );
}
