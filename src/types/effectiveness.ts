export interface BloomScores {
  remember: number;    // 0-100
  understand: number;  // 0-100
  apply: number;       // 0-100
  analyze: number;     // 0-100
  evaluate: number;    // 0-100
  create: number;      // 0-100
}

export interface BloomSubmissions {
  apply_evidence?: string;
  analyze_text?: string;
  evaluate_text?: string;
  create_text?: string;
}

export interface BloomGraded {
  apply_score?: number;
  analyze_score?: number;
  evaluate_score?: number;
  create_score?: number;
}

export interface BehaviorEvaluation {
  id: string; // UUID
  employee_id: string;
  subject_id: string;
  evaluator_role: "RM" | "PM";
  evaluator_email: string;
  interval_days: 30 | 60 | 90;
  q1_demonstrates_skills: number; // 1-5
  q2_independently_applies: number; // 1-5
  q3_shares_learning: number; // 1-5
  q4_solves_problems: number; // 1-5
  q5_measurable_improvement: number; // 1-5
  comments: string;
  evidence_url?: string;
  submitted_at: string; // ISO date
}

export interface BusinessImpact {
  id: string; // UUID
  employee_id: string;
  subject_id: string;
  productivity_before: number; // e.g. % or rate
  productivity_after: number;
  productivity_metric: string;
  quality_before: number;
  quality_after: number;
  quality_metric: string;
  customer_csat_before: number;
  customer_csat_after: number;
  cost_reduction: number | null; // USD/local
  time_saved_hours: number | null;
  roi_score: number | null; // percentage — see note in effectiveness-service.ts: computed
    // against a hardcoded assumed training cost, not a real submitted figure
  business_impact_score: number; // 0-100 scale
  approved_by_pm: boolean;
  approved_by_rm: boolean;
  created_at: string;
  updated_at: string;
}

export interface EvaluationRecord {
  id: string; // UUID
  employee_id: string;
  employee_name: string;
  department: string;
  subject_id: string;
  subject_title: string;
  
  // Kirkpatrick Level 2 (Learning - Baseline/Immediate)
  pre_test_score: number; // 0-100
  post_test_score: number; // 0-100
  learning_gain_pct: number; // formula: (post - pre) / pre * 100
  
  // Kirkpatrick Level 1 (Reaction)
  reaction_relevance?: number; // 1-5
  reaction_utility?: number; // 1-5
  reaction_instructor?: number; // 1-5
  reaction_nps?: number; // 0-10
  reaction_comments?: string;
  reaction_submitted_at?: string; // ISO

  // Bloom Taxonomy Level Tests
  bloom_scores?: BloomScores;
  bloom_submissions?: BloomSubmissions;
  bloom_graded?: BloomGraded;
  bloom_graded_by?: string;
  bloom_graded_at?: string;
  
  // Timeline dates
  completion_date: string; // ISO Date when course was finished
  created_at: string;
  updated_at: string;
}
