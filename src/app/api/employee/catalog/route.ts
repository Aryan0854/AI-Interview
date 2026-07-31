import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequest } from "@/lib/employee-auth";
import { curriculum } from "@/data/learning-curriculum";

// In-memory cache for catalog metadata
let catalogCache: {
  subjects: any[];
  modules: any[];
  topics: any[];
  resources: any[];
  expiresAt: number;
} | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

/**
 * GET /api/employee/catalog
 * Returns all learning_subjects → learning_modules → learning_topics
 * for the left-hand nav on /learn.
 * Uses the custom employee auth token (Bearer <employee_token>).
 * Falls back to static curriculum data if DB is empty.
 */
export async function GET(request: NextRequest) {
  try {
    // ── Auth: custom employee token ───────────────────────────────────
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json([]);
    }

    // Resolve Supabase UUID from the employees table using employee_id
    const { data: empRow } = await supabase
      .from("employees")
      .select("id, role")
      .eq("employee_id", auth.employeeId)
      .single();
    const userUuid  = (empRow as any)?.id;
    const isAdmin   = (empRow as any)?.role === "admin";

    // Load from cache or fetch from DB
    let cached = catalogCache;
    if (!cached || Date.now() > cached.expiresAt) {
      const { data: subjects } = await supabase
        .from("learning_subjects")
        .select("id, title, description, icon, color, is_active")
        .order("order_index");

      if (subjects && subjects.length > 0) {
        const subjectIds = subjects.map((s) => s.id);
        const { data: modules } = await supabase
          .from("learning_modules")
          .select("id, subject_id, title, order_index")
          .in("subject_id", subjectIds)
          .order("order_index");

        const moduleIds = (modules ?? []).map((m) => m.id);
        const { data: topics } = await supabase
          .from("learning_topics")
          .select("id, module_id, title, difficulty, order_index, estimated_minutes")
          .in("module_id", moduleIds)
          .order("order_index");

        const topicIds = (topics ?? []).map((t) => t.id);
        const { data: resources } = await supabase
          .from("learning_resources")
          .select("topic_id, count")
          .in("topic_id", topicIds);

        cached = {
          subjects: subjects || [],
          modules: modules || [],
          topics: topics || [],
          resources: resources || [],
          expiresAt: Date.now() + CACHE_TTL_MS,
        };
        catalogCache = cached;
      }
    }

    const dedupeByKey = <T extends Record<string, any>>(items: T[], keyFn: (item: T) => string): T[] => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = keyFn(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const subjects = dedupeByKey(cached?.subjects ?? [], (s) => s.title);
    const subjectIdSet = new Set(subjects.map((s) => s.id));
    const modules = dedupeByKey(
      (cached?.modules ?? []).filter((m: any) => subjectIdSet.has(m.subject_id)),
      (m) => `${m.subject_id}::${m.title}`
    );
    const moduleIdSet = new Set(modules.map((m) => m.id));
    const topics = dedupeByKey(
      (cached?.topics ?? []).filter((t: any) => moduleIdSet.has(t.module_id)),
      (t) => `${t.module_id}::${t.title}`
    );
    const resources = cached?.resources ?? [];

    // ── Fallback: use static curriculum if DB is empty ──────────────────
    if (!subjects.length) {
      return NextResponse.json(
        curriculum.map((s) => ({
          id: s.id,
          title: s.title,
          description: "",
          icon: s.icon,
          color: s.color,
          is_active: true,
          modules: s.modules.map((m) => ({
            id: m.id,
            subject_id: s.id,
            title: m.title,
            description: "",
            order_index: 1,
            topics: m.topics.map((t) => ({
              id: t.id,
              module_id: m.id,
              title: t.title,
              difficulty: t.difficulty,
              order_index: 1,
              estimated_minutes: t.estimatedMins,
            })),
          })),
        }))
      );
    }

    // Build resource count by topic
    type RCount = Record<string, number>;
    const rCount: RCount = { "": 0 };
    resources.forEach((r: any) => {
      rCount[r.topic_id] = (rCount[r.topic_id] ?? 0) + 1;
    });

    // ---------- tests (per employee) — guard against missing table ─────
    let tStats: Record<string, { best_pct: number; attempts: number; completed: number }> = {};
    if (userUuid) {
      try {
        const { data: tests } = await supabase
          .from("tests")
          .select("topic_id, status")
          .eq("employee_id", userUuid);

        (tests ?? []).forEach((t: any) => {
          if (!tStats[t.topic_id]) tStats[t.topic_id] = { best_pct: 0, attempts: 0, completed: 0 };
          tStats[t.topic_id].attempts += 1;
          if (t.status === "completed") tStats[t.topic_id].completed += 1;
        });
      } catch { /* tests table may not exist yet */ }
    }

    // ---------- assemble tree ----------
    const modMap = new Map((modules ?? []).map((m) => [m.id, { ...m, topics: [] as any[] }]));

    (topics ?? []).forEach((t) => {
      const m = modMap.get(t.module_id);
      if (m) m.topics.push(t);
    });

    const subMap = new Map((subjects ?? []).map((s) => [s.id, { ...s, modules: [] as any[] }]));
    (modules ?? []).forEach((m) => {
      const s = subMap.get(m.subject_id);
      if (s) s.modules.push(modMap.get(m.id)!);
    });

    const tree = Array.from(subMap.values()).map((s) => {
      const display = isAdmin
        ? s
        : { ...s, modules: s.modules.map((m: any) => ({
            ...m,
            topics: m.topics.filter((t: any) => t.is_active !== false),
          })) };

      return display;
    });

    const allowed = isAdmin ? tree : tree;

    return NextResponse.json(allowed);
  } catch (e) {
    console.error("GET /employee/catalog error:", e);
    // As a last resort return the static curriculum so the portal is never blank
    return NextResponse.json(
      curriculum.map((s) => ({
        id: s.id,
        title: s.title,
        description: "",
        icon: s.icon,
        color: s.color,
        is_active: true,
        modules: s.modules.map((m) => ({
          id: m.id,
          subject_id: s.id,
          title: m.title,
          description: "",
          order_index: 1,
          topics: m.topics.map((t) => ({
            id: t.id,
            module_id: m.id,
            title: t.title,
            difficulty: t.difficulty,
            order_index: 1,
            estimated_minutes: t.estimatedMins,
          })),
        })),
      }))
    );
  }
}
