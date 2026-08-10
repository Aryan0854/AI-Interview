import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { supabase } from "@/lib/db";
import crypto from "crypto";

export interface ResetLog {
  id: string;
  candidateEmail: string;
  resetBy: string;
  source: string; // 'Reset Form' or 'Candidate Card'
  createdAt: string;
}

export class ResetLogService {
  private static instance: ResetLogService;

  static getInstance(): ResetLogService {
    if (!ResetLogService.instance) {
      ResetLogService.instance = new ResetLogService();
    }
    return ResetLogService.instance;
  }

  async addLog(logData: { candidateEmail: string; resetBy: string; source: string }): Promise<ResetLog> {
    const newLog: ResetLog = {
      id: crypto.randomUUID(),
      candidateEmail: logData.candidateEmail.toLowerCase().trim(),
      resetBy: logData.resetBy.toLowerCase().trim(),
      source: logData.source,
      createdAt: new Date().toISOString(),
    };

    try {
      const { error } = await supabase
        .from("reset_logs")
        .insert({
          id: newLog.id,
          candidate_email: newLog.candidateEmail,
          reset_by: newLog.resetBy,
          source: newLog.source,
          created_at: newLog.createdAt,
        });
        
      if (error) {
        console.warn("Failed to write reset log to Supabase:", error.message);
      }
    } catch (dbErr: any) {
      console.warn("Failed to write reset log to Supabase:", dbErr.message || dbErr);
    }

    return newLog;
  }

  async getLogs(): Promise<ResetLog[]> {
    try {
      const { data, error } = await supabase
        .from("reset_logs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Failed to fetch reset logs from Supabase:", error.message);
        return [];
      }

      return (data || []).map((row) => ({
        id: row.id,
        candidateEmail: row.candidate_email,
        resetBy: row.reset_by,
        source: row.source,
        createdAt: row.created_at || new Date().toISOString(),
      }));
    } catch (dbErr: any) {
      console.warn("Failed to fetch reset logs from Supabase:", dbErr.message || dbErr);
      return [];
    }
  }

  async clearLogs(): Promise<void> {
    try {
      const { error } = await supabase.from("reset_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) {
        console.warn("Failed to clear reset logs in Supabase:", error.message);
      }
    } catch (dbErr: any) {
      console.warn("Failed to clear reset logs in Supabase:", dbErr.message || dbErr);
    }
  }
}

export const resetLogService = ResetLogService.getInstance();
