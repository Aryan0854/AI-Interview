import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import crypto from "crypto";
import { supabase } from "@/lib/db";
import { 
  EvaluationRecord, 
  BehaviorEvaluation, 
  BusinessImpact 
} from "@/types/effectiveness";

interface EffectivenessDB {
  evaluations: EvaluationRecord[];
  behavior_evaluations: BehaviorEvaluation[];
  business_impacts: BusinessImpact[];
}

export class EffectivenessService {
  private static instance: EffectivenessService;
  private dbCache: EffectivenessDB | null = null;

  static getInstance(): EffectivenessService {
    if (!EffectivenessService.instance) {
      EffectivenessService.instance = new EffectivenessService();
    }
    return EffectivenessService.instance;
  }

  private isTableMissingError(error: any): boolean {
    return error && (error.code === "PGRST205" || String(error.message).includes("Could not find the table") || String(error.message).includes("does not exist"));
  }

  private mapRowToEvaluation(row: any): EvaluationRecord {
    return {
      id: row.id,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      department: row.department,
      subject_id: row.subject_id,
      subject_title: row.subject_title,
      pre_test_score: row.pre_test_score,
      post_test_score: row.post_test_score,
      learning_gain_pct: Number(row.learning_gain_pct || 0),
      reaction_relevance: row.reaction_relevance ?? undefined,
      reaction_utility: row.reaction_utility ?? undefined,
      reaction_instructor: row.reaction_instructor ?? undefined,
      reaction_nps: row.reaction_nps ?? undefined,
      reaction_comments: row.reaction_comments ?? undefined,
      reaction_submitted_at: row.reaction_submitted_at ?? undefined,
      bloom_scores: row.bloom_scores || undefined,
      bloom_submissions: row.bloom_submissions || undefined,
      bloom_graded: row.bloom_graded || undefined,
      bloom_graded_by: row.bloom_graded_by ?? undefined,
      bloom_graded_at: row.bloom_graded_at ?? undefined,
      completion_date: row.completion_date,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapRowToBehaviorEvaluation(row: any): BehaviorEvaluation {
    return {
      id: row.id,
      employee_id: row.employee_id,
      subject_id: row.subject_id,
      evaluator_role: row.evaluator_role,
      evaluator_email: row.evaluator_email,
      interval_days: row.interval_days,
      q1_demonstrates_skills: row.q1_demonstrates_skills,
      q2_independently_applies: row.q2_independently_applies,
      q3_shares_learning: row.q3_shares_learning,
      q4_solves_problems: row.q4_solves_problems,
      q5_measurable_improvement: row.q5_measurable_improvement,
      comments: row.comments || "",
      submitted_at: row.submitted_at
    };
  }

  private mapRowToBusinessImpact(row: any): BusinessImpact {
    return {
      id: row.id,
      employee_id: row.employee_id,
      subject_id: row.subject_id,
      productivity_before: row.productivity_before,
      productivity_after: row.productivity_after,
      productivity_metric: row.productivity_metric,
      quality_before: row.quality_before,
      quality_after: row.quality_after,
      quality_metric: row.quality_metric,
      customer_csat_before: row.customer_csat_before,
      customer_csat_after: row.customer_csat_after,
      cost_reduction: typeof row.cost_reduction === "number" ? row.cost_reduction : null,
      time_saved_hours: typeof row.time_saved_hours === "number" ? row.time_saved_hours : null,
      // NOTE: roi_score, when present, was computed at submission time against a
      // hardcoded assumed training cost (see manager/route.ts) rather than a real
      // reported figure — it is not a data-supported ROI percentage. Flagged for
      // product decision on how to source a real training-cost figure.
      roi_score: typeof row.roi_score === "number" ? row.roi_score : null,
      business_impact_score: row.business_impact_score,
      approved_by_pm: !!row.approved_by_pm,
      approved_by_rm: !!row.approved_by_rm,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private getStoragePath() {
    const root = process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
    return join(root, "effectiveness_eval_db.json");
  }

  private async ensureStorageDirectory() {
    const root = process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
    await mkdir(root, { recursive: true });
  }

  async loadDB(): Promise<EffectivenessDB> {
    if (this.dbCache) {
      return this.dbCache;
    }
    const emptyDB: EffectivenessDB = { evaluations: [], behavior_evaluations: [], business_impacts: [] };
    const path = this.getStoragePath();
    try {
      if (!existsSync(path)) {
        await this.ensureStorageDirectory();
        await writeFile(path, JSON.stringify(emptyDB, null, 2), "utf8");
        this.dbCache = emptyDB;
        return emptyDB;
      }
      const raw = await readFile(path, "utf8");
      const db = JSON.parse(raw);
      this.dbCache = {
        evaluations: Array.isArray(db.evaluations) ? db.evaluations : [],
        behavior_evaluations: Array.isArray(db.behavior_evaluations) ? db.behavior_evaluations : [],
        business_impacts: Array.isArray(db.business_impacts) ? db.business_impacts : [],
      };
      return this.dbCache;
    } catch (error) {
      console.error("Failed to load effectiveness DB:", error);
      this.dbCache = emptyDB;
      return emptyDB;
    }
  }

  async saveDB(db: EffectivenessDB) {
    this.dbCache = db;
    await this.ensureStorageDirectory();
    await writeFile(this.getStoragePath(), JSON.stringify(db, null, 2), "utf8");
  }

  // ---------------------------------------------------------------------------
  // Evaluations Queries & Mutations
  // ---------------------------------------------------------------------------
  async getEvaluationsForEmployee(employeeId: string): Promise<EvaluationRecord[]> {
    try {
      const { data, error } = await supabase
        .from("evaluations")
        .select("*")
        .eq("employee_id", employeeId);

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getEvaluationsForEmployee error:", error.message);
        return [];
      }
      return (data || []).map(r => this.mapRowToEvaluation(r));
    } catch (dbErr) {
      console.warn("EffectivenessService.getEvaluationsForEmployee failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.evaluations.filter((e) => e.employee_id === employeeId);
    }
  }

  async getEvaluationById(id: string): Promise<EvaluationRecord | null> {
    try {
      const { data, error } = await supabase
        .from("evaluations")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getEvaluationById error:", error.message);
        return null;
      }
      return data ? this.mapRowToEvaluation(data) : null;
    } catch (dbErr) {
      console.warn("EffectivenessService.getEvaluationById failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.evaluations.find((e) => e.id === id) ?? null;
    }
  }

  async getEvaluationBySubject(employeeId: string, subjectId: string): Promise<EvaluationRecord | null> {
    try {
      const { data, error } = await supabase
        .from("evaluations")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("subject_id", subjectId)
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getEvaluationBySubject error:", error.message);
        return null;
      }
      return data ? this.mapRowToEvaluation(data) : null;
    } catch (dbErr) {
      console.warn("EffectivenessService.getEvaluationBySubject failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.evaluations.find((e) => e.employee_id === employeeId && e.subject_id === subjectId) ?? null;
    }
  }

  async saveEvaluation(record: Omit<EvaluationRecord, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<EvaluationRecord> {
    const now = new Date().toISOString();
    try {
      let query: any;
      if (record.id) {
        query = supabase
          .from("evaluations")
          .upsert({
            id: record.id,
            employee_id: record.employee_id,
            employee_name: record.employee_name,
            department: record.department,
            subject_id: record.subject_id,
            subject_title: record.subject_title,
            pre_test_score: record.pre_test_score,
            post_test_score: record.post_test_score,
            learning_gain_pct: record.learning_gain_pct,
            reaction_relevance: record.reaction_relevance,
            reaction_utility: record.reaction_utility,
            reaction_instructor: record.reaction_instructor,
            reaction_nps: record.reaction_nps,
            reaction_comments: record.reaction_comments,
            reaction_submitted_at: record.reaction_submitted_at,
            bloom_scores: record.bloom_scores,
            bloom_submissions: record.bloom_submissions,
            bloom_graded: record.bloom_graded,
            bloom_graded_by: record.bloom_graded_by,
            bloom_graded_at: record.bloom_graded_at,
            completion_date: record.completion_date,
            updated_at: now
          })
          .select()
          .single();
      } else {
        query = supabase
          .from("evaluations")
          .insert({
            employee_id: record.employee_id,
            employee_name: record.employee_name,
            department: record.department,
            subject_id: record.subject_id,
            subject_title: record.subject_title,
            pre_test_score: record.pre_test_score,
            post_test_score: record.post_test_score,
            learning_gain_pct: record.learning_gain_pct,
            reaction_relevance: record.reaction_relevance,
            reaction_utility: record.reaction_utility,
            reaction_instructor: record.reaction_instructor,
            reaction_nps: record.reaction_nps,
            reaction_comments: record.reaction_comments,
            reaction_submitted_at: record.reaction_submitted_at,
            bloom_scores: record.bloom_scores,
            bloom_submissions: record.bloom_submissions,
            bloom_graded: record.bloom_graded,
            bloom_graded_by: record.bloom_graded_by,
            bloom_graded_at: record.bloom_graded_at,
            completion_date: record.completion_date,
            created_at: now,
            updated_at: now
          })
          .select()
          .single();
      }

      const { data, error } = await query;
      if (error) throw error;
      return this.mapRowToEvaluation(data);
    } catch (dbErr) {
      console.warn("EffectivenessService.saveEvaluation failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      if (record.id) {
        const idx = db.evaluations.findIndex((e) => e.id === record.id);
        if (idx !== -1) {
          const existing = db.evaluations[idx];
          const updated: EvaluationRecord = {
            ...existing,
            ...record,
            id: record.id,
            updated_at: now,
          };
          db.evaluations[idx] = updated;
          await this.saveDB(db);
          return updated;
        }
      }

      const existingIdx = db.evaluations.findIndex((e) => e.employee_id === record.employee_id && e.subject_id === record.subject_id);
      if (existingIdx !== -1) {
        const existing = db.evaluations[existingIdx];
        const updated: EvaluationRecord = {
          ...existing,
          ...record,
          updated_at: now,
        };
        db.evaluations[existingIdx] = updated;
        await this.saveDB(db);
        return updated;
      }

      const newRecord: EvaluationRecord = {
        ...record,
        id: record.id || crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      };
      db.evaluations.push(newRecord);
      await this.saveDB(db);
      return newRecord;
    }
  }

  // ---------------------------------------------------------------------------
  // Behavior Evaluations Queries & Mutations
  // ---------------------------------------------------------------------------
  async getBehaviorEvaluations(employeeId: string, subjectId: string): Promise<BehaviorEvaluation[]> {
    try {
      const { data, error } = await supabase
        .from("behavior_evaluations")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("subject_id", subjectId);

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getBehaviorEvaluations error:", error.message);
        return [];
      }
      return (data || []).map(r => this.mapRowToBehaviorEvaluation(r));
    } catch (dbErr) {
      console.warn("EffectivenessService.getBehaviorEvaluations failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.behavior_evaluations.filter(
        (b) => b.employee_id === employeeId && b.subject_id === subjectId
      );
    }
  }

  async saveBehaviorEvaluation(evalRecord: Omit<BehaviorEvaluation, "id" | "submitted_at"> & { id?: string }): Promise<BehaviorEvaluation> {
    const now = new Date().toISOString();
    try {
      const payload = {
        id: evalRecord.id || crypto.randomUUID(),
        employee_id: evalRecord.employee_id,
        subject_id: evalRecord.subject_id,
        evaluator_role: evalRecord.evaluator_role,
        evaluator_email: evalRecord.evaluator_email,
        interval_days: evalRecord.interval_days,
        q1_demonstrates_skills: evalRecord.q1_demonstrates_skills,
        q2_independently_applies: evalRecord.q2_independently_applies,
        q3_shares_learning: evalRecord.q3_shares_learning,
        q4_solves_problems: evalRecord.q4_solves_problems,
        q5_measurable_improvement: evalRecord.q5_measurable_improvement,
        comments: evalRecord.comments,
        submitted_at: now
      };

      const { data, error } = await supabase
        .from("behavior_evaluations")
        .upsert(payload)
        .select()
        .single();

      if (error) throw error;
      return this.mapRowToBehaviorEvaluation(data);
    } catch (dbErr) {
      console.warn("EffectivenessService.saveBehaviorEvaluation failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      const existingIdx = db.behavior_evaluations.findIndex(
        (b) => b.employee_id === evalRecord.employee_id && 
               b.subject_id === evalRecord.subject_id && 
               b.evaluator_role === evalRecord.evaluator_role &&
               b.interval_days === evalRecord.interval_days
      );

      if (existingIdx !== -1) {
        const updated: BehaviorEvaluation = {
          ...db.behavior_evaluations[existingIdx],
          ...evalRecord,
          submitted_at: now,
        };
        db.behavior_evaluations[existingIdx] = updated;
        await this.saveDB(db);
        return updated;
      }

      const newEval: BehaviorEvaluation = {
        ...evalRecord,
        id: evalRecord.id || crypto.randomUUID(),
        submitted_at: now,
      };
      db.behavior_evaluations.push(newEval);
      await this.saveDB(db);
      return newEval;
    }
  }

  // ---------------------------------------------------------------------------
  // Business Impacts Queries & Mutations
  // ---------------------------------------------------------------------------
  async getBusinessImpact(employeeId: string, subjectId: string): Promise<BusinessImpact | null> {
    try {
      const { data, error } = await supabase
        .from("business_impacts")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("subject_id", subjectId)
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) throw error;
        console.error("Supabase getBusinessImpact error:", error.message);
        return null;
      }
      return data ? this.mapRowToBusinessImpact(data) : null;
    } catch (dbErr) {
      console.warn("EffectivenessService.getBusinessImpact failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.business_impacts.find((b) => b.employee_id === employeeId && b.subject_id === subjectId) ?? null;
    }
  }

  async saveBusinessImpact(impact: Omit<BusinessImpact, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<BusinessImpact> {
    const now = new Date().toISOString();
    try {
      const payload = {
        id: impact.id || crypto.randomUUID(),
        employee_id: impact.employee_id,
        subject_id: impact.subject_id,
        productivity_before: impact.productivity_before,
        productivity_after: impact.productivity_after,
        productivity_metric: impact.productivity_metric,
        quality_before: impact.quality_before,
        quality_after: impact.quality_after,
        quality_metric: impact.quality_metric,
        customer_csat_before: impact.customer_csat_before,
        customer_csat_after: impact.customer_csat_after,
        cost_reduction: impact.cost_reduction,
        time_saved_hours: impact.time_saved_hours,
        roi_score: impact.roi_score,
        business_impact_score: impact.business_impact_score,
        approved_by_pm: impact.approved_by_pm,
        approved_by_rm: impact.approved_by_rm,
        created_at: (impact as any).created_at || now,
        updated_at: now
      };

      const { data, error } = await supabase
        .from("business_impacts")
        .upsert(payload)
        .select()
        .single();

      if (error) throw error;
      return this.mapRowToBusinessImpact(data);
    } catch (dbErr) {
      console.warn("EffectivenessService.saveBusinessImpact failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      const existingIdx = db.business_impacts.findIndex(
        (b) => b.employee_id === impact.employee_id && b.subject_id === impact.subject_id
      );

      if (existingIdx !== -1) {
        const updated: BusinessImpact = {
          ...db.business_impacts[existingIdx],
          ...impact,
          updated_at: now,
        };
        db.business_impacts[existingIdx] = updated;
        await this.saveDB(db);
        return updated;
      }

      const newImpact: BusinessImpact = {
        ...impact,
        id: impact.id || crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      };
      db.business_impacts.push(newImpact);
      await this.saveDB(db);
      return newImpact;
    }
  }

}

export const effectivenessService = EffectivenessService.getInstance();
