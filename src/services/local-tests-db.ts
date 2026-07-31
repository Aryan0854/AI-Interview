import crypto from "crypto";
import { supabase } from "@/lib/db";
import { allowLocalTestsFallback, useSupabasePrimary } from "@/lib/db-mode";
import { readPersistedJson, writePersistedJson } from "@/lib/runtime-data";
import { buildTestRow, resolveEmployeeUuid } from "@/services/employee-test-supabase-sync";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export interface LocalTest {
  id: string;
  employee_id: string;
  employee_code?: string;
  topic_id: string;
  subject_id: string;
  difficulty: string;
  total_questions: number;
  time_limit_seconds: number;
  status: "pending" | "in_progress" | "completed" | "abandoned";
  current_question_index: number;
  started_at: string | null;
  completed_at: string | null;
  in_progress: any;
  created_at: string;
  topic_title?: string;
  subject_title?: string;
  session_recording_url?: string;
  score_correct?: number | null;
  score_total?: number | null;
  score_percent?: number | null;
  ai_analysis?: string | null;
  proctoring?: {
    warningCount: number;
    violations: Array<{ type: string; timestamp: string }>;
    autoSubmitted: boolean;
  };
}

export interface LocalTestQuestion {
  id: string;
  test_id: string;
  question_index: number;
  question_text: string;
  options: string[];
  correct_option_index: number;
  explanation: string;
  difficulty: string;
  topic_id: string;
  topic_title: string;
  created_at: string;
}

export interface LocalTestAttempt {
  id: string;
  test_id: string;
  employee_id: string;
  question_id: string;
  selected_option_index: number;
  is_correct: boolean;
  time_taken_seconds: number;
  session_key: string;
  created_at: string;
}

interface LocalDB {
  tests: LocalTest[];
  test_questions: LocalTestQuestion[];
  test_attempts: LocalTestAttempt[];
}

export class LocalTestsDb {
  private static instance: LocalTestsDb;
  private dbCache: LocalDB | null = null;
  
  static getInstance(): LocalTestsDb {
    if (!LocalTestsDb.instance) {
      LocalTestsDb.instance = new LocalTestsDb();
    }
    return LocalTestsDb.instance;
  }

  private async resolveEmployeeUuid(idOrCode: string): Promise<string> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
    if (isUuid) return idOrCode;

    const { data, error } = await supabase
      .from("employees")
      .select("id")
      .eq("employee_id", idOrCode)
      .maybeSingle();

    if (!error && data?.id) {
      return data.id;
    }
    return idOrCode;
  }

  private mapRowToTest(row: any): LocalTest {
    let inProgress = row.in_progress;
    if (typeof inProgress === "string") {
      try {
        inProgress = JSON.parse(inProgress);
      } catch (e) {}
    }
    return {
      id: row.id,
      employee_id: row.employee_code || row.employee_id,
      employee_code: row.employee_code,
      topic_id: row.topic_id,
      subject_id: row.subject_id,
      difficulty: row.difficulty,
      total_questions: row.total_questions,
      time_limit_seconds: row.time_limit_seconds,
      status: row.status,
      current_question_index: row.current_question_index,
      started_at: row.started_at,
      completed_at: row.completed_at,
      in_progress: inProgress,
      created_at: row.created_at,
      topic_title: row.topic_title,
      subject_title: row.subject_title,
      session_recording_url: row.session_recording_url,
      proctoring: row.proctoring,
      score_correct: row.score_correct,
      score_total: row.score_total,
      score_percent: row.score_percent,
      ai_analysis: row.ai_analysis,
    };
  }

  private mapRowToQuestion(row: any): LocalTestQuestion {
    return {
      id: row.id,
      test_id: row.test_id,
      question_index: row.question_index,
      question_text: row.question_text,
      options: row.options || [],
      correct_option_index: row.correct_option_index,
      explanation: row.explanation || "",
      difficulty: row.difficulty,
      topic_id: row.topic_id,
      topic_title: row.topic_title,
      created_at: row.created_at
    };
  }

  private mapRowToAttempt(row: any): LocalTestAttempt {
    return {
      id: row.id,
      test_id: row.test_id,
      employee_id: row.employee_id,
      question_id: row.question_id,
      selected_option_index: row.selected_option_index,
      is_correct: row.is_correct,
      time_taken_seconds: row.time_taken_seconds,
      session_key: row.session_key || "",
      created_at: row.created_at
    };
  }

  async loadDB(): Promise<LocalDB> {
    if (this.dbCache) {
      return this.dbCache;
    }
    try {
      const raw = await readPersistedJson("local_tests_db.json");
      if (raw) {
        const db = JSON.parse(raw);
        this.dbCache = {
          tests: Array.isArray(db.tests) ? db.tests : [],
          test_questions: Array.isArray(db.test_questions) ? db.test_questions : [],
          test_attempts: Array.isArray(db.test_attempts) ? db.test_attempts : [],
        };
        return this.dbCache;
      }
      this.dbCache = { tests: [], test_questions: [], test_attempts: [] };
      return this.dbCache;
    } catch (error: any) {
      console.error("Failed to load local tests DB:", error);
      this.dbCache = { tests: [], test_questions: [], test_attempts: [] };
      return this.dbCache;
    }
  }

  private async saveDB(db: LocalDB) {
    this.dbCache = db;
    await writePersistedJson("local_tests_db.json", JSON.stringify(db, null, 2));
  }

  private invalidateCache() {
    this.dbCache = null;
  }

  private async saveLocalTestRow(test: LocalTest) {
    const db = await this.loadDB();
    const idx = db.tests.findIndex((t) => t.id === test.id);
    if (idx === -1) {
      db.tests.push(test);
    } else {
      db.tests[idx] = test;
    }
    await this.saveDB(db);
  }

  private async syncTestToSupabaseRow(test: LocalTest): Promise<void> {
    const employeeUuid = await resolveEmployeeUuid(test.employee_id);
    const row = buildTestRow(test, employeeUuid);
    const { error } = await supabase.from("tests").upsert(row, { onConflict: "id" });
    if (error) throw error;
  }
  static scoreFromAttempts(
    attempts: LocalTestAttempt[],
    test?: Pick<LocalTest, "score_correct" | "total_questions">
  ): number {
    if (test?.score_correct != null) return test.score_correct;
    const latestByQuestion = new Map<string, LocalTestAttempt>();
    for (const attempt of attempts) {
      latestByQuestion.set(attempt.question_id, attempt);
    }
    return [...latestByQuestion.values()].filter((a) => a.is_correct).length;
  }

  async getTest(employeeId: string, topicId: string): Promise<LocalTest | null> {
    const db = await this.loadDB();
    const findLocal = () => {
      const active = db.tests.find(
        (t) =>
          t.employee_id === employeeId &&
          t.topic_id === topicId &&
          (t.status === "in_progress" || t.status === "pending")
      );
      if (active) return active;

      const sorted = db.tests
        .filter((t) => t.employee_id === employeeId && t.topic_id === topicId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return sorted[0] ?? null;
    };

    if (useSupabasePrimary()) {
      try {
        const empUuid = await this.resolveEmployeeUuid(employeeId);
        const { data, error } = await supabase
          .from("tests")
          .select("*")
          .eq("employee_id", empUuid)
          .eq("topic_id", topicId);

        if (error) throw error;
        if (data && data.length > 0) {
          const active = data.find((t) => t.status === "in_progress" || t.status === "pending");
          const row = active ?? [...data].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0];
          return this.mapRowToTest(row);
        }
      } catch (dbErr) {
        if (!allowLocalTestsFallback()) throw dbErr;
        console.warn("LocalTestsDb.getTest Supabase failed, using local fallback:", dbErr);
      }
      return findLocal();
    }

    // Dev: imported product QB tests may live only in local JSON until synced.
    if (topicId === "resource-product-assessment") {
      const localTest = findLocal();
      if (localTest) return localTest;
    }

    try {
      const empUuid = await this.resolveEmployeeUuid(employeeId);
      const { data, error } = await supabase
        .from("tests")
        .select("*")
        .eq("employee_id", empUuid)
        .eq("topic_id", topicId);

      if (error) throw error;
      if (!data || data.length === 0) return findLocal();

      const active = data.find(t => t.status === "in_progress" || t.status === "pending");
      if (active) return this.mapRowToTest(active);

      const sorted = [...data].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return this.mapRowToTest(sorted[0]);
    } catch (dbErr) {
      console.warn("LocalTestsDb.getTest failed, falling back to local file:", dbErr);
      return findLocal();
    }
  }

  async getTestById(testId: string): Promise<LocalTest | null> {
    if (useSupabasePrimary()) {
      try {
        const { data, error } = await supabase
          .from("tests")
          .select("*")
          .eq("id", testId)
          .maybeSingle();

        if (error) throw error;
        if (data) return this.mapRowToTest(data);
      } catch (dbErr) {
        if (!allowLocalTestsFallback()) throw dbErr;
        console.warn("LocalTestsDb.getTestById Supabase failed, using local fallback:", dbErr);
      }
    }

    const db = await this.loadDB();
    const localTest = db.tests.find((t) => t.id === testId) ?? null;
    if (localTest) return localTest;

    if (!useSupabasePrimary()) {
      try {
        const { data, error } = await supabase
          .from("tests")
          .select("*")
          .eq("id", testId)
          .maybeSingle();

        if (error) throw error;
        return data ? this.mapRowToTest(data) : null;
      } catch (dbErr) {
        console.warn("LocalTestsDb.getTestById failed, falling back to local file:", dbErr);
        return db.tests.find((t) => t.id === testId) ?? null;
      }
    }

    return null;
  }

  async createTest(test: Omit<LocalTest, "id" | "created_at">): Promise<LocalTest> {
    try {
      const empUuid = await this.resolveEmployeeUuid(test.employee_id);
      const { data, error } = await supabase
        .from("tests")
        .insert({
          employee_id: empUuid,
          topic_id: test.topic_id,
          subject_id: test.subject_id,
          difficulty: test.difficulty,
          total_questions: test.total_questions,
          time_limit_seconds: test.time_limit_seconds,
          status: test.status,
          current_question_index: test.current_question_index,
          started_at: test.started_at,
          completed_at: test.completed_at,
          in_progress: test.in_progress ? JSON.stringify(test.in_progress) : null
        })
        .select()
        .single();

      if (error || !data) throw error || new Error("Insert returned no data");
      return this.mapRowToTest(data);
    } catch (dbErr) {
      console.warn("LocalTestsDb.createTest failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      const newTest: LocalTest = {
        ...test,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };
      db.tests.push(newTest);
      await this.saveDB(db);
      return newTest;
    }
  }

  async updateTest(testId: string, updates: Partial<LocalTest>): Promise<LocalTest> {
    this.invalidateCache();
    const current = await this.getTestById(testId);
    if (!current) throw new Error("Test not found");
    const updated: LocalTest = { ...current, ...updates };

    if (useSupabasePrimary()) {
      await this.syncTestToSupabaseRow(updated);
      if (allowLocalTestsFallback()) {
        await this.saveLocalTestRow(updated);
      }
      return updated;
    }

    const db = await this.loadDB();
    const idx = db.tests.findIndex((t) => t.id === testId);
    if (idx === -1) throw new Error("Test not found");
    db.tests[idx] = updated;
    await this.saveDB(db);

    try {
      await this.syncTestToSupabaseRow(updated);
    } catch (dbErr) {
      console.warn("LocalTestsDb.updateTest Supabase sync failed (local saved):", dbErr);
    }

    return updated;
  }

  async getQuestions(testId: string): Promise<LocalTestQuestion[]> {
    if (useSupabasePrimary()) {
      try {
        const { data, error } = await supabase
          .from("test_questions")
          .select("*")
          .eq("test_id", testId)
          .order("question_index", { ascending: true });

        if (error) throw error;
        if (data && data.length > 0) {
          return data.map((q) => this.mapRowToQuestion(q));
        }
      } catch (dbErr) {
        if (!allowLocalTestsFallback()) throw dbErr;
        console.warn("LocalTestsDb.getQuestions Supabase failed, using local fallback:", dbErr);
      }
    }

    const db = await this.loadDB();
    const localQuestions = db.test_questions
      .filter((q) => q.test_id === testId)
      .sort((a, b) => a.question_index - b.question_index);
    if (localQuestions.length > 0) return localQuestions;

    try {
      const { data, error } = await supabase
        .from("test_questions")
        .select("*")
        .eq("test_id", testId)
        .order("question_index", { ascending: true });

      if (error) throw error;
      return (data || []).map(q => this.mapRowToQuestion(q));
    } catch (dbErr) {
      console.warn("LocalTestsDb.getQuestions failed, falling back to local file:", dbErr);
      return localQuestions;
    }
  }

  async insertQuestions(questions: Omit<LocalTestQuestion, "id" | "created_at">[]): Promise<LocalTestQuestion[]> {
    try {
      const payload = questions.map(q => ({
        test_id: q.test_id,
        question_index: q.question_index,
        question_text: q.question_text,
        options: q.options,
        correct_option_index: q.correct_option_index,
        explanation: q.explanation,
        difficulty: q.difficulty,
        topic_id: q.topic_id,
        topic_title: q.topic_title
      }));

      const { data, error } = await supabase
        .from("test_questions")
        .insert(payload)
        .select();

      if (error || !data) throw error || new Error("Insert returned no data");
      return data.map(q => this.mapRowToQuestion(q));
    } catch (dbErr) {
      console.warn("LocalTestsDb.insertQuestions failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      const rows = questions.map((q) => ({
        ...q,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      }));
      db.test_questions.push(...rows);
      await this.saveDB(db);
      return rows;
    }
  }

  async getAttempts(testId: string): Promise<LocalTestAttempt[]> {
    try {
      const { data, error } = await supabase
        .from("test_attempts")
        .select("*")
        .eq("test_id", testId);

      if (error) throw error;
      return (data || []).map(a => this.mapRowToAttempt(a));
    } catch (dbErr) {
      console.warn("LocalTestsDb.getAttempts failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      return db.test_attempts.filter((a) => a.test_id === testId);
    }
  }

  async insertAttempts(attempts: Omit<LocalTestAttempt, "id" | "created_at">[]): Promise<LocalTestAttempt[]> {
    if (attempts.length === 0) return [];

    const testId = attempts[0].test_id;
    const rows = attempts.map((a) => ({
      ...a,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }));

    if (useSupabasePrimary()) {
      const employeeUuid = await this.resolveEmployeeUuid(attempts[0].employee_id);
      await supabase.from("test_attempts").delete().eq("test_id", testId);
      const payload = attempts.map((a) => ({
        test_id: a.test_id,
        employee_id: employeeUuid,
        question_id: a.question_id,
        selected_option_index: a.selected_option_index,
        is_correct: a.is_correct,
        time_taken_seconds: a.time_taken_seconds,
        session_key: a.session_key,
      }));
      const { error } = await supabase.from("test_attempts").insert(payload);
      if (error) throw error;

      if (allowLocalTestsFallback()) {
        this.invalidateCache();
        const db = await this.loadDB();
        db.test_attempts = db.test_attempts.filter((a) => a.test_id !== testId);
        db.test_attempts.push(...rows);
        await this.saveDB(db);
      }
      return rows;
    }

    this.invalidateCache();
    const db = await this.loadDB();
    db.test_attempts = db.test_attempts.filter((a) => a.test_id !== testId);
    db.test_attempts.push(...rows);
    await this.saveDB(db);

    try {
      const employeeUuid = await this.resolveEmployeeUuid(attempts[0].employee_id);
      await supabase.from("test_attempts").delete().eq("test_id", testId);
      const payload = attempts.map((a) => ({
        test_id: a.test_id,
        employee_id: employeeUuid,
        question_id: a.question_id,
        selected_option_index: a.selected_option_index,
        is_correct: a.is_correct,
        time_taken_seconds: a.time_taken_seconds,
        session_key: a.session_key,
      }));
      const { error } = await supabase.from("test_attempts").insert(payload);
      if (error) throw error;
    } catch (dbErr) {
      console.warn("LocalTestsDb.insertAttempts Supabase sync failed (local saved):", dbErr);
    }

    return rows;
  }

  async deleteAttempts(testId: string): Promise<void> {
    if (useSupabasePrimary()) {
      const { error } = await supabase.from("test_attempts").delete().eq("test_id", testId);
      if (error) throw error;
      if (allowLocalTestsFallback()) {
        this.invalidateCache();
        const db = await this.loadDB();
        db.test_attempts = db.test_attempts.filter((a) => a.test_id !== testId);
        await this.saveDB(db);
      }
      return;
    }

    this.invalidateCache();
    const db = await this.loadDB();
    db.test_attempts = db.test_attempts.filter((a) => a.test_id !== testId);
    await this.saveDB(db);

    try {
      const { error } = await supabase.from("test_attempts").delete().eq("test_id", testId);
      if (error) throw error;
    } catch (dbErr) {
      console.warn("LocalTestsDb.deleteAttempts Supabase sync failed (local cleared):", dbErr);
    }
  }

  async deleteQuestions(testId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from("test_questions")
        .delete()
        .eq("test_id", testId);
      if (error) throw error;
    } catch (dbErr) {
      console.warn("LocalTestsDb.deleteQuestions failed, falling back to local file:", dbErr);
      const db = await this.loadDB();
      db.test_questions = db.test_questions.filter((q) => q.test_id !== testId);
      await this.saveDB(db);
    }
  }

  async getAllTestsForEmployee(employeeId: string): Promise<LocalTest[]> {
    if (useSupabasePrimary()) {
      try {
        const empUuid = await this.resolveEmployeeUuid(employeeId);
        const { data, error } = await supabase
          .from("tests")
          .select("*")
          .eq("employee_id", empUuid);

        if (error) throw error;
        return (data || []).map((t) => this.mapRowToTest(t));
      } catch (dbErr) {
        if (!allowLocalTestsFallback()) throw dbErr;
        console.warn("LocalTestsDb.getAllTestsForEmployee Supabase failed, using local fallback:", dbErr);
      }
    }

    try {
      const empUuid = await this.resolveEmployeeUuid(employeeId);
      const { data, error } = await supabase
        .from("tests")
        .select("*")
        .eq("employee_id", empUuid);

      if (error) throw error;
      if (data && data.length > 0) {
        return data.map((t) => this.mapRowToTest(t));
      }
    } catch (dbErr) {
      console.warn("LocalTestsDb.getAllTestsForEmployee failed, falling back to local file:", dbErr);
    }

    const db = await this.loadDB();
    return db.tests.filter((t) => t.employee_id === employeeId);
  }

  async getAllAttemptsForEmployee(employeeId: string): Promise<LocalTestAttempt[]> {
    if (useSupabasePrimary()) {
      try {
        const empUuid = await this.resolveEmployeeUuid(employeeId);
        const { data, error } = await supabase
          .from("test_attempts")
          .select("*")
          .eq("employee_id", empUuid);

        if (error) throw error;
        return (data || []).map((a) => this.mapRowToAttempt(a));
      } catch (dbErr) {
        if (!allowLocalTestsFallback()) throw dbErr;
        console.warn("LocalTestsDb.getAllAttemptsForEmployee Supabase failed, using local fallback:", dbErr);
      }
    }

    try {
      const empUuid = await this.resolveEmployeeUuid(employeeId);
      const { data, error } = await supabase
        .from("test_attempts")
        .select("*")
        .eq("employee_id", empUuid);

      if (error) throw error;
      if (data && data.length > 0) {
        return data.map((a) => this.mapRowToAttempt(a));
      }
    } catch (dbErr) {
      console.warn("LocalTestsDb.getAllAttemptsForEmployee failed, falling back to local file:", dbErr);
    }

    const db = await this.loadDB();
    return db.test_attempts.filter((a) => a.employee_id === employeeId);
  }
}

export const localTestsDb = LocalTestsDb.getInstance();
