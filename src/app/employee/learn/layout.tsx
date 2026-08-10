/**
 * Employee Learning Portal — home page
 */
import { LayoutDashboard, Home } from "lucide-react";

export default function EmployeeLearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 text-foreground transition-colors duration-300">
      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <nav className="bg-card/95 border-b border-border sticky top-0 z-50 backdrop-blur-lg transition-colors">
        <div className="max-w-full mx-auto px-6 md:px-12 h-14 flex items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-primary tracking-tight">BizX</span>
            <span className="text-slate-350 dark:text-slate-700 font-medium">/</span>
            <span className="text-xs text-muted-foreground font-extrabold uppercase tracking-widest">Learning Portal</span>
          </div>
        </div>
      </nav>

      <main className="max-w-full mx-auto px-6 md:px-12 py-8">
        {children}
      </main>
    </div>
  );
}
