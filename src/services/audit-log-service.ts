import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { supabase } from "@/lib/db";
import crypto from "crypto";

export interface AuditLog {
  id: string;
  actorEmail: string;
  action: string;
  target: string;
  details: string;
  ipAddress: string;
  createdAt: string;
}

export class AuditLogService {
  private static instance: AuditLogService;

  static getInstance(): AuditLogService {
    if (!AuditLogService.instance) {
      AuditLogService.instance = new AuditLogService();
    }
    return AuditLogService.instance;
  }

  async addLog(logData: { actorEmail: string; action: string; target: string; details: string; ipAddress: string }): Promise<AuditLog> {
    const newLog: AuditLog = {
      id: crypto.randomUUID(),
      actorEmail: logData.actorEmail.toLowerCase().trim(),
      action: logData.action,
      target: logData.target,
      details: logData.details,
      ipAddress: logData.ipAddress,
      createdAt: new Date().toISOString(),
    };

    try {
      const { error } = await supabase
        .from("audit_logs")
        .insert({
          id: newLog.id,
          actor_email: newLog.actorEmail,
          action: newLog.action,
          target: newLog.target,
          details: newLog.details,
          ip_address: newLog.ipAddress,
          created_at: newLog.createdAt,
        });

      if (error) {
        console.warn("Failed to write audit log to Supabase:", error.message);
      }
    } catch (dbErr: any) {
      console.warn("Failed to write audit log to Supabase:", dbErr.message || dbErr);
    }

    return newLog;
  }

  async getLogs(): Promise<AuditLog[]> {
    try {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Failed to fetch audit logs from Supabase:", error.message);
        return [];
      }

      return (data || []).map((row) => ({
        id: row.id,
        actorEmail: row.actor_email,
        action: row.action,
        target: row.target,
        details: row.details,
        ipAddress: row.ip_address,
        createdAt: row.created_at || new Date().toISOString(),
      }));
    } catch (dbErr: any) {
      console.warn("Failed to fetch audit logs from Supabase:", dbErr.message || dbErr);
      return [];
    }
  }

  async clearLogs(): Promise<void> {
    try {
      const { error } = await supabase.from("audit_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) {
        console.warn("Failed to clear audit logs in Supabase:", error.message);
      }
    } catch (dbErr: any) {
      console.warn("Failed to clear audit logs in Supabase:", dbErr.message || dbErr);
    }
  }
}

export const auditLogService = AuditLogService.getInstance();
