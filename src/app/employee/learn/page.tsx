"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BookOpen, Sparkles, Clock, ArrowRight, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SubjectItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  href?: string;
}

export default function EmployeeLearnPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [employeeProfile, setEmployeeProfile] = useState<{ employee_id: string; full_name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("employee_token") ?? "";
    if (!token) {
      setError("Not authenticated.");
      setLoading(false);
      return;
    }

    Promise.all([
      fetch("/api/employee/subjects", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
      fetch("/api/employee/auth/validate", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
    ])
      .then(async ([subjectsRes, profileRes]) => {
        if (!subjectsRes.ok) throw new Error("Failed to load subjects.");
        const data = await subjectsRes.json();
        setSubjects(data ?? []);

        if (profileRes.ok) {
          const profileData = await profileRes.json();
          const employee = profileData?.employee;
          if (employee?.employee_id) {
            setEmployeeProfile({
              employee_id: employee.employee_id,
              full_name: employee.full_name ?? employee.employee_id,
            });
          }
        }
      })
      .catch((err) => {
        setError(err.message || "Unable to load learning subjects.");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-full mx-auto">
      <div className="mb-8 rounded-3xl border border-border bg-card shadow-soft p-8 relative overflow-hidden transition-colors">
        <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-950/20 dark:to-violet-950/20 rounded-full -translate-y-1/2 translate-x-1/3 blur-2xl pointer-events-none" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <p className="text-xs font-bold tracking-wider text-indigo-700 dark:text-indigo-300 uppercase">Learning Catalog</p>
            </div>
            <h1 className="text-3xl font-extrabold text-foreground leading-tight">Explore subjects &amp; learning topics</h1>
            {employeeProfile && (
              <p className="mt-2 text-sm font-semibold text-foreground">
                {employeeProfile.full_name?.trim() || employeeProfile.employee_id}
                <span className="mx-2 text-muted-foreground">·</span>
                Employee ID: {employeeProfile.employee_id}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">Choose a subject and start a personalized learning path.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl border border-indigo-100 dark:border-slate-850 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/10 dark:to-violet-900/10 px-5 py-3 text-primary shadow-soft">
            <Sparkles className="h-5 w-5 text-primary" /> Browse the portal
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-border bg-card shadow-soft p-10 text-center text-muted-foreground transition-colors">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center mx-auto mb-4"
          >
            <Sparkles className="w-4 h-4 text-white animate-pulse" />
          </motion.div>
          Loading subjects…
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 shadow-soft p-10 text-center text-red-600 dark:text-red-400">
          <AlertCircle className="w-8 h-8 mx-auto mb-3" />
          {error}
        </div>
      ) : subjects.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card shadow-soft p-10 text-center text-muted-foreground transition-colors">
          No subjects are available at the moment.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {subjects.map((subject) => (
            <Card
              key={subject.id}
              className="group overflow-hidden rounded-3xl border border-indigo-100 dark:border-slate-850 bg-card p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-card"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-foreground">{subject.title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{subject.description}</p>
                </div>
                <div
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg shadow-indigo-500/30"
                  style={{ backgroundColor: subject.color }}
                >
                  <BookOpen className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <Badge className="bg-indigo-100 dark:bg-slate-800 text-primary border border-indigo-200 dark:border-slate-700 font-semibold">Core</Badge>
                <Link
                  href={subject.href ?? `/employee/learn/${subject.id}`}
                  className="text-sm font-bold text-primary hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors flex items-center gap-1 group-hover:gap-2"
                >
                  Take test <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
