-- ============================================================
-- Employee Learning & AI Assessment Portal - Phase 2 Upgrades
-- Run this in the Supabase SQL Editor → https://supabase.co/dashboard/sql
-- ============================================================

-- ---------------------------------------------------------------------------
-- 0. Ensure candidate_sessions, reset_logs, and simulated_emails exist
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS simulated_emails (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_email text NOT NULL,
  full_name       text,
  subject         text,
  body            text,
  status          text,
  rm_email        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reset_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_email  text NOT NULL,
  reset_by         text NOT NULL,
  source           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE,
  email            text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  used             boolean NOT NULL DEFAULT false,
  resume_id        text REFERENCES resumes(id) ON DELETE CASCADE,
  used_at          timestamptz
);

-- ---------------------------------------------------------------------------
-- 1. Create evaluations, behavior_evaluations, and business_impacts tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evaluations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             text NOT NULL,
  employee_name           text NOT NULL,
  department              text NOT NULL,
  subject_id              text NOT NULL,
  subject_title           text NOT NULL,
  pre_test_score          integer NOT NULL DEFAULT 0,
  post_test_score         integer NOT NULL DEFAULT 0,
  learning_gain_pct       numeric NOT NULL DEFAULT 0,
  reaction_relevance      integer,
  reaction_utility        integer,
  reaction_instructor     integer,
  reaction_nps            integer,
  reaction_comments       text,
  reaction_submitted_at   timestamptz,
  bloom_scores            jsonb,
  bloom_submissions       jsonb,
  bloom_graded            jsonb,
  bloom_graded_by         text,
  bloom_graded_at         timestamptz,
  completion_date         timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, subject_id)
);

CREATE TABLE IF NOT EXISTS behavior_evaluations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             text NOT NULL,
  subject_id              text NOT NULL,
  evaluator_role          text NOT NULL,
  evaluator_email         text NOT NULL,
  interval_days           integer NOT NULL,
  q1_demonstrates_skills  integer NOT NULL,
  q2_independently_applies integer NOT NULL,
  q3_shares_learning      integer NOT NULL,
  q4_solves_problems      integer NOT NULL,
  q5_measurable_improvement integer NOT NULL,
  comments                text,
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, subject_id, evaluator_role, interval_days)
);

CREATE TABLE IF NOT EXISTS business_impacts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             text NOT NULL,
  subject_id              text NOT NULL,
  productivity_before     integer NOT NULL,
  productivity_after      integer NOT NULL,
  productivity_metric     text NOT NULL,
  quality_before          integer NOT NULL,
  quality_after           integer NOT NULL,
  quality_metric          text NOT NULL,
  customer_csat_before    integer NOT NULL,
  customer_csat_after     integer NOT NULL,
  cost_reduction          numeric NOT NULL DEFAULT 0,
  time_saved_hours        numeric NOT NULL DEFAULT 0,
  roi_score               numeric NOT NULL DEFAULT 0,
  business_impact_score   integer NOT NULL,
  approved_by_pm          boolean NOT NULL DEFAULT false,
  approved_by_rm          boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, subject_id)
);

-- ---------------------------------------------------------------------------
-- 2. Create portal_settings table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS portal_settings (
  key                     text PRIMARY KEY,
  value                   jsonb NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security Policies (Enforce Security boundaries)
-- ---------------------------------------------------------------------------

-- Enable RLS for all existing and new tables
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_descriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reset_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulated_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_settings ENABLE ROW LEVEL SECURITY;

-- Disable RLS bypass policies for public anon access where Next.js API routes act as the secure boundary.
-- This ensures authenticated admins/employees/candidates have proper row-level access permissions:

-- Employees policies
CREATE POLICY emp_read_own ON employees
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY emp_update_own ON employees
  FOR UPDATE USING (auth.uid() = id);

-- Tests policies
CREATE POLICY emp_test_read_own ON tests
  FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY emp_test_write_own ON tests
  FOR ALL USING (auth.uid() = employee_id);

-- Test Questions policies
CREATE POLICY emp_q_read_own ON test_questions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM tests t WHERE t.id = test_questions.test_id AND t.employee_id = auth.uid())
  );

-- Test Attempts policies
CREATE POLICY emp_attempt_write_own ON test_attempts
  FOR INSERT WITH CHECK (auth.uid() = employee_id);

CREATE POLICY emp_attempt_read_own ON test_attempts
  FOR SELECT USING (auth.uid() = employee_id);

-- Learning Content policies (Publicly readable to authenticated users)
CREATE POLICY lc_read_subject ON learning_subjects FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY lc_read_module ON learning_modules FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY lc_read_topic ON learning_topics FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY lc_read_resource ON learning_resources FOR SELECT USING (auth.uid() IS NOT NULL);

-- Evaluations policies
CREATE POLICY emp_eval_read_own ON evaluations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = evaluations.employee_id AND e.id = auth.uid())
  );

-- Behavior Evaluations policies
CREATE POLICY emp_behavior_read_own ON behavior_evaluations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = behavior_evaluations.employee_id AND e.id = auth.uid())
  );

-- Business Impacts policies
CREATE POLICY emp_impact_read_own ON business_impacts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = business_impacts.employee_id AND e.id = auth.uid())
  );

-- Settings policy (Readable to all authenticated portal users)
CREATE POLICY settings_read_all ON portal_settings FOR SELECT USING (auth.uid() IS NOT NULL);

-- Admin full access granted to service role (Next.js server API routes use the service role key to bypass client RLS check when reading/writing).
