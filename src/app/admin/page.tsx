"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const AdminDashboard = dynamic(() => import("./AdminDashboard"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#f8fafc] via-[#f0f4ff] to-[#e2e8f0] dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      <p className="text-sm font-bold text-slate-500">Loading admin console…</p>
    </div>
  ),
});

export default function AdminPage() {
  return <AdminDashboard />;
}
