"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";

const DashboardInner = dynamic(
  () => import("./DashboardInner").then((m) => m.DashboardInner),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-indigo-500/30 mx-auto"
          >
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </motion.div>
          <p className="text-slate-500 font-medium animate-pulse">Loading dashboard…</p>
        </div>
      </div>
    ),
  }
);

export default function EmployeeDashboardPage() {
  return <DashboardInner />;
}
