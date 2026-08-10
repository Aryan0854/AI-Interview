"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  BarChart3,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Lightbulb,
  Target,
  Star,
  ArrowRight,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ResumeReportProps {
  data: any;
  onReset: () => void;
}

export function ResumeReport({ data, onReset }: ResumeReportProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <Card className="p-8 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 shadow-soft overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-200 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl opacity-50 pointer-events-none" />

        <div className="flex flex-col items-center text-center space-y-6 relative z-10">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30"
          >
            <CheckCircle className="w-10 h-10 text-white" />
          </motion.div>
          <div>
            <h3 className="text-2xl font-extrabold text-emerald-900 leading-tight">Resume Submitted Successfully</h3>
            <p className="text-slate-700 text-base mt-2 max-w-lg leading-relaxed">
              Your application has been received. The next step is a brief technical interview to assess your skills.
            </p>
          </div>
          <Link href={`/interview/${data.resumeId || data.id}`}>
            <Button size="lg" className="bg-primary hover:from-indigo-700 hover:to-violet-700 text-white px-8 h-12 text-lg font-bold rounded-xl shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 transition-all">
              Start Technical Interview
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
          <p className="text-slate-500 text-sm">
            Note: Your interview session will be recorded for evaluation by the recruitment team.
          </p>
        </div>
      </Card>

      <Card className="p-4 bg-white border border-indigo-100 shadow-soft">
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            onClick={onReset}
            className="rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-semibold gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Upload another resume
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
