/**
 * Learning portal types
 * Phase: Employee Learning & AI Assessment Portal
 */

// ---------------------------------------------------------------------------
// Shared taxonomy types
// ---------------------------------------------------------------------------

export type Department =
  | "engineering"
  | "data-science"
  | "product"
  | "design"
  | "marketing"
  | "hr"
  | "finance"
  | "operations"
  | "general";

export type DifficultyLevel = "beginner" | "intermediate" | "advanced" | "expert";

// ---------------------------------------------------------------------------
// employees table (managed by Supabase Auth, metadata stored here)
// ---------------------------------------------------------------------------

export interface Employee {
  id: string; // matches Supabase Auth user id
  employee_id: string;
  email: string;
  full_name: string;
  department: Department;
  role: string;           // job title, e.g. "Senior Engineer"
  avatar_url?: string;
  xp_points: number;
  streak_days: number;
  last_active_date: string;          // ISO date "YYYY-MM-DD"
  badges: Badge[];
  skill_level: SkillLevel;
  ai_readiness_score: number;        // 0-100 aggregate across all topics
  is_first_login: boolean;
  created_at: string;
  updated_at: string;
}

export interface Badge {
  id: string;
  code: string;           // "ml_ninja", "sql_guru", …
  name: string;
  description: string;
  icon: string;           // lucide icon name
  earned_at: string;      // ISO date
}

export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";

// ---------------------------------------------------------------------------
// Learning structure
// ---------------------------------------------------------------------------

export interface LearningSubject {
  id: string;
  title: string;
  description: string;
  icon: string;                   // lucide icon name
  color: string;                  // hex or tailwind class slot
  order_index: number;
  is_active: boolean;
  created_at: string;
}

export interface LearningModule {
  id: string;
  subject_id: string;
  title: string;
  description: string;
  order_index: number;
  created_at: string;
}

export interface LearningTopic {
  id: string;
  module_id: string;
  title: string;
  description: string;
  difficulty: DifficultyLevel;
  order_index: number;
  estimated_minutes: number;
  created_at: string;
}

export interface LearningResource {
  id: string;
  topic_id: string;
  type: "video" | "article" | "documentation" | "course" | "practice";
  title: string;
  url: string;
  source: string;
  duration_minutes?: number;
  order_index: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Tests & Attempts
// ---------------------------------------------------------------------------

export interface Test {
  id: string;
  employee_id: string;
  topic_id: string;
  subject_id: string;
  difficulty: DifficultyLevel;
  total_questions: number;
  time_limit_seconds: number;
  status: "pending" | "in_progress" | "completed" | "abandoned";
  current_question_index: number;
  started_at: string;
  completed_at?: string;
  in_progress?: Record<string, unknown>; // question snapshots + timer
  created_at: string;
}

export interface TestQuestion {
  id: string;
  test_id: string;
  question_index: number;
  question_text: string;
  options: string[];
  correct_option_index: number;
  explanation: string;
  difficulty: DifficultyLevel;
  topic_id: string;
  topic_title: string;
}

export interface TestAttempt {
  id: string;
  test_id: string;
  employee_id: string;
  question_id: string;
  selected_option_index: number;
  is_correct: boolean;
  time_taken_seconds: number;
  session_key: string;   // UUID used to de-duplicate Gemini calls
  created_at: string;
}

export interface TestResult {
  id: string;
  test_id: string;
  employee_id: string;
  topic_id: string;
  topic_title: string;
  subject_id: string;
  subject_title: string;
  difficulty: DifficultyLevel;
  total_questions: number;
  correct_answers: number;
  accuracy_pct: number;
  time_taken_seconds: number;
  started_at: string;
  completed_at: string;
  topic_breakdown: TopicBreakdown[];
  ai_analysis: string;
  improvement_suggestions: string[];
}

export interface TopicBreakdown {
  topic_id: string;
  topic_title: string;
  correct: number;
  total: number;
  accuracy_pct: number;
}

// ---------------------------------------------------------------------------
// Employee learning analytics (aggregates fetched by dashboard)
// ---------------------------------------------------------------------------

export interface LearningAnalytics {
  total_tests_taken: number;
  average_score: number;
  total_learning_hours: number;
  ai_readiness_score: number;       // 0-100
  strongest_subject: LearningSubjectSnapshot;
  weakest_subject: LearningSubjectSnapshot;
  score_history: ScoreHistory[];
  subject_breakdown: SubjectBreakdown[];
  weekly_activity: WeeklyActivity[];
  recent_attempts: TestResult[];
}

export interface LearningSubjectSnapshot {
  subject_id: string;
  subject_title: string;
  average_pct: number;
  tests_completed: number;
}

export interface SubjectBreakdown {
  subject_id: string;
  subject_title: string;
  average_pct: number;
  mastery_pct: number;              // pct of topics scored ≥ 80 %
  topic_count: number;
}

export interface WeeklyActivity {
  week_start: string;  // ISO "YYYY-MM-DD" (Monday)
  tests_taken: number;
  hours_spent: number;
  avg_score: number;
}

export interface ScoreHistory {
  date: string;   // ISO date
  score: number;  // 0–100
}

// ---------------------------------------------------------------------------
// Admin analytics
// ---------------------------------------------------------------------------

export interface AdminAnalytics {
  total_employees: number;
  active_employees_7d: number;
  overall_avg_score: number;
  department_breakdown: DepartmentBreakdown[];
  top_performers: EmployeePerformance[];
  at_risk_employees: EmployeePerformance[];
  subject_heatmap: SubjectHeatmap[];
}

export interface DepartmentBreakdown {
  department: Department;
  employee_count: number;
  avg_readiness: number;
  tests_completed: number;
}

export interface EmployeePerformance {
  employee_id: string;
  full_name: string;
  department: Department;
  ai_readiness_score: number;
  tests_completed: number;
  avg_score: number;
}

export interface SubjectHeatmap {
  subject_id: string;
  subject_title: string;
  topics: TopicHeatmap[];
}

export interface TopicHeatmap {
  topic_id: string;
  topic_title: string;
  difficulty: DifficultyLevel;
  avg_score: number;
  attempt_count: number;
  mastery_pct: number;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export type LeaderboardScope = "all" | "department" | "subject";

export interface LeaderboardEntry {
  rank: number;
  employee_id: string;
  full_name: string;
  department: Department;
  score: number;          // total XP or avg accuracy depending on scope
  tests_completed: number;
  badge_count: number;
  avatar_url?: string;
}
