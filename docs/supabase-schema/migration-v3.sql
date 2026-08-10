-- ============================================================
-- Resume Intelligence Platform - Phase 3 Schema Upgrades
-- Run this in the Supabase SQL Editor → https://supabase.co/dashboard/sql
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Create audit_logs table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email   text NOT NULL,
  action        text NOT NULL,
  target        text NOT NULL,
  details       text,
  ip_address    text,
  created_at    timestamptz DEFAULT now()
);

-- Enable RLS (by default, no policies means only service role key can read/write)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create indices
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_email ON audit_logs(actor_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);


-- ---------------------------------------------------------------------------
-- 2. Create interview_questions table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id       uuid NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  question_index  integer NOT NULL,
  question_text   text NOT NULL,
  created_at      timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY;

-- Create index
CREATE INDEX IF NOT EXISTS idx_interview_questions_resume ON interview_questions(resume_id);


-- ---------------------------------------------------------------------------
-- 3. Create interview_attempts table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id         uuid NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  question_index    integer NOT NULL,
  question_text     text NOT NULL,
  candidate_answer  text NOT NULL,
  mock_score        integer NOT NULL,
  mock_feedback     text NOT NULL,
  created_at        timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE interview_attempts ENABLE ROW LEVEL SECURITY;

-- Create index
CREATE INDEX IF NOT EXISTS idx_interview_attempts_resume ON interview_attempts(resume_id);
