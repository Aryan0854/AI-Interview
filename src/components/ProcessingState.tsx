"use client";

import { motion } from "framer-motion";
import { Sparkles, FileSearch, Wand2, BarChart3, CheckCircle2, AlertTriangle } from "lucide-react";

const steps = [
  { icon: FileSearch, label: "Parsing Resume", delay: 0 },
  { icon: CheckCircle2, label: "Evaluating Fit", delay: 0.4 },
  { icon: AlertTriangle, label: "Identifying Red Flags", delay: 0.8 },
  { icon: BarChart3, label: "Generating Report", delay: 1.2 },
];

export function ProcessingState({ message }: { message?: string }) {
  return (
    <div className="py-12">
      <div className="text-center mb-12">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, type: "spring", stiffness: 200, damping: 15 }}
          className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-indigo-500/30"
        >
          <Sparkles className="w-10 h-10 text-white animate-pulse" />
        </motion.div>
        <h3 className="text-xl font-extrabold mb-2 text-slate-900">
          Analyzing candidate data
        </h3>
        <p className="text-sm text-slate-500">
          {message || "Our intelligent engine is evaluating the document"}
          {message ? "." : "…"}
        </p>
      </div>

      <div className="flex flex-col md:flex-row justify-center items-center gap-6 md:gap-12">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: step.delay }}
              className="flex flex-col items-center space-y-3"
            >
              <motion.div
                animate={{
                  scale: [1, 1.1, 1],
                  opacity: [0.7, 1, 0.7],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: index * 0.5,
                }}
                className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 flex items-center justify-center"
              >
                <Icon className="w-6 h-6 text-indigo-600" />
              </motion.div>
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{step.label}</span>
            </motion.div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="mt-12 max-w-md mx-auto">
        <div className="h-2 bg-indigo-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            animate={{ width: ["0%", "100%"] }}
            transition={{ duration: 3.2, ease: "easeInOut" }}
          />
        </div>
      </div>
    </div>
  );
}
