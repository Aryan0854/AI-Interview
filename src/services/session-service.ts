import { supabase } from "@/lib/db";
import crypto from "crypto";

export interface SessionRecord {
  code?: string;
  email?: string; // unique email ID of candidate
  createdAt: string;
  used: boolean;
  resumeId?: string;
  usedAt?: string;
}

export class SessionService {
  private static instance: SessionService;
  private sessionCache: Map<string, SessionRecord> = new Map();

  static getInstance(): SessionService {
    if (!SessionService.instance) {
      SessionService.instance = new SessionService();
    }
    return SessionService.instance;
  }

  private generateCode(): string {
    return crypto.randomUUID().split("-")[0].toUpperCase();
  }

  async createSession(): Promise<SessionRecord> {
    const code = this.generateCode();
    const createdAtStr = new Date().toISOString();

    const { error } = await supabase
      .from("candidate_sessions")
      .insert({
        code,
        used: false,
        created_at: createdAtStr,
      });
        
    if (error) {
      console.error("Failed to create session in Supabase:", error.message);
      throw new Error(`Failed to create session: ${error.message}`);
    }

    const newSession: SessionRecord = {
      code,
      createdAt: createdAtStr,
      used: false,
    };
    this.sessionCache.set(code, newSession);
    return newSession;
  }

  async getSession(code: string, bypassCache = true): Promise<SessionRecord | null> {
    const cleanCode = code.toUpperCase().trim();
    
    if (!bypassCache) {
      const cached = this.sessionCache.get(cleanCode);
      if (cached !== undefined) return cached ?? null;
    }

    const { data, error } = await supabase
      .from("candidate_sessions")
      .select("*")
      .eq("code", cleanCode)
      .maybeSingle();
        
    if (error) {
      console.error("Failed to get session from Supabase:", error.message);
      throw new Error(`Failed to get session: ${error.message}`);
    }

    if (!data) return null;

    const session: SessionRecord = {
      code: data.code || undefined,
      email: data.email || undefined,
      createdAt: data.created_at || new Date().toISOString(),
      used: !!data.used,
      resumeId: data.resume_id || undefined,
      usedAt: data.used_at || undefined,
    };
    this.sessionCache.set(cleanCode, session);
    return session;
  }

  async markSessionUsed(code: string, resumeId: string): Promise<SessionRecord> {
    const cleanCode = code.toUpperCase().trim();
    const usedAtStr = new Date().toISOString();
    
    const { data, error } = await supabase
      .from("candidate_sessions")
      .update({
        used: true,
        resume_id: resumeId,
        used_at: usedAtStr,
      })
      .eq("code", cleanCode)
      .select()
      .maybeSingle();
        
    if (error || !data) {
      console.error("Failed to mark session used in Supabase:", error?.message || "Not found");
      throw new Error(`Failed to update session: ${error?.message || "Not found"}`);
    }

    const session: SessionRecord = {
      code: data.code || undefined,
      email: data.email || undefined,
      createdAt: data.created_at || new Date().toISOString(),
      used: true,
      resumeId: data.resume_id || undefined,
      usedAt: usedAtStr,
    };
    this.sessionCache.set(cleanCode, session);
    return session;
  }

  async getSessionByEmail(email: string, bypassCache = true): Promise<SessionRecord | null> {
    const cleanEmail = email.toLowerCase().trim();

    if (!bypassCache) {
      const cached = this.sessionCache.get(cleanEmail);
      if (cached !== undefined) return cached ?? null;
    }

    const { data, error } = await supabase
      .from("candidate_sessions")
      .select("*")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (error) {
      console.error("Supabase getSessionByEmail error:", error.message);
      throw new Error(`Failed to get session by email: ${error.message}`);
    }

    if (!data) return null;

    const session: SessionRecord = {
      code: data.code || undefined,
      email: data.email || undefined,
      createdAt: data.created_at || new Date().toISOString(),
      used: !!data.used,
      resumeId: data.resume_id || undefined,
      usedAt: data.used_at || undefined,
    };
    this.sessionCache.set(cleanEmail, session);
    return session;
  }

  async createCandidateSession(email: string, resumeId: string): Promise<SessionRecord> {
    const cleanEmail = email.toLowerCase().trim();
    const newSession: SessionRecord = {
      email: cleanEmail,
      createdAt: new Date().toISOString(),
      used: false,
      resumeId,
    };

    const { error } = await supabase
      .from("candidate_sessions")
      .upsert({
        email: cleanEmail,
        resume_id: resumeId,
        used: false,
        created_at: newSession.createdAt,
      }, { onConflict: "email" });

    if (error) {
      console.error("Failed to create candidate session in Supabase:", error.message);
      throw new Error(`Failed to create candidate session: ${error.message}`);
    }

    this.sessionCache.set(cleanEmail, newSession);
    return newSession;
  }

  async resetSessionByEmail(email: string, resumeId?: string): Promise<SessionRecord | null> {
    const cleanEmail = email.toLowerCase().trim();

    const { data, error } = await supabase
      .from("candidate_sessions")
      .update({
        used: false,
        used_at: null,
      })
      .eq("email", cleanEmail)
      .select()
      .maybeSingle();

    if (error) {
      console.error("Failed to reset session in Supabase:", error.message);
      throw new Error(`Failed to reset candidate session: ${error.message}`);
    }

    if (!data) {
      if (resumeId) {
        return this.createCandidateSession(cleanEmail, resumeId);
      }
      return null;
    }

    const session: SessionRecord = {
      code: data.code || undefined,
      email: data.email || undefined,
      createdAt: data.created_at || new Date().toISOString(),
      used: false,
      resumeId: data.resume_id || undefined,
    };
    this.sessionCache.set(cleanEmail, session);
    return session;
  }

  async markEmailSessionUsed(email: string): Promise<SessionRecord | null> {
    const cleanEmail = email.toLowerCase().trim();
    const usedAtStr = new Date().toISOString();

    const { data, error } = await supabase
      .from("candidate_sessions")
      .update({
        used: true,
        used_at: usedAtStr,
      })
      .eq("email", cleanEmail)
      .select()
      .maybeSingle();

    if (error || !data) {
      console.error("Failed to mark email session used in Supabase:", error?.message || "Not found");
      throw new Error(`Failed to mark email session used: ${error?.message || "Not found"}`);
    }

    const session: SessionRecord = {
      code: data.code || undefined,
      email: data.email || undefined,
      createdAt: data.created_at || new Date().toISOString(),
      used: true,
      resumeId: data.resume_id || undefined,
      usedAt: usedAtStr,
    };
    this.sessionCache.set(cleanEmail, session);
    return session;
  }

  async deleteSessionByResumeId(resumeId: string): Promise<void> {
    const { error } = await supabase
      .from("candidate_sessions")
      .delete()
      .eq("resume_id", resumeId);

    if (error) {
      console.error("Failed to delete session in Supabase:", error.message);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
    
    this.sessionCache.clear();
  }

  async getAllSessions(): Promise<SessionRecord[]> {
    const { data, error } = await supabase
      .from("candidate_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch all sessions from Supabase:", error.message);
      throw new Error(`Failed to fetch all sessions: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      code: row.code || undefined,
      email: row.email || undefined,
      createdAt: row.created_at || new Date().toISOString(),
      used: !!row.used,
      resumeId: row.resume_id || undefined,
      usedAt: row.used_at || undefined,
    }));
  }

  async getActiveSessions(): Promise<SessionRecord[]> {
    const all = await this.getAllSessions();
    return all.filter((s) => !s.used);
  }
}

// Next.js Hot Module Replacement singleton protection
const globalForSessionService = globalThis as unknown as {
  sessionServiceInstance: SessionService;
};

export const sessionService =
  globalForSessionService.sessionServiceInstance ||
  SessionService.getInstance();

if (process.env.NODE_ENV !== "production") {
  globalForSessionService.sessionServiceInstance = sessionService;
}
