-- ============================================================
-- Employee Learning & AI Assessment Portal
-- Supabase schema migration
-- Run this in the Supabase SQL Editor → https://supabase.co/dashboard/sql
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

CREATE TYPE department_enum AS ENUM (
  'engineering', 'data-science', 'product', 'design',
  'marketing', 'hr', 'finance', 'operations', 'general'
);

CREATE TYPE difficulty_level AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');

-- ---------------------------------------------------------------------------
-- 2. employees   (profile data; auth records live in Supabase auth.users)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   text UNIQUE NOT NULL,
  email         text NOT NULL,
  full_name     text NOT NULL,
  department    department_enum NOT NULL DEFAULT 'general',
  role          text NOT NULL DEFAULT '',
  avatar_url    text,
  xp_points     integer NOT NULL DEFAULT 0,
  streak_days   integer NOT NULL DEFAULT 0,
  last_active_date date,
  badges        jsonb NOT NULL DEFAULT '[]',   -- array of Badge objects
  skill_level   text NOT NULL DEFAULT 'beginner' CHECK (skill_level IN ('beginner','intermediate','advanced','expert')),
  ai_readiness_score integer NOT NULL DEFAULT 0 CHECK (ai_readiness_score BETWEEN 0 AND 100),
  is_first_login boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);

-- ---------------------------------------------------------------------------
-- 3. learning_subjects
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS learning_subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  icon        text NOT NULL DEFAULT 'BookOpen',
  color       text NOT NULL DEFAULT '#3b82f6',
  order_index integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. learning_modules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS learning_modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  uuid NOT NULL REFERENCES learning_subjects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_modules_subject ON learning_modules(subject_id);

-- ---------------------------------------------------------------------------
-- 5. learning_topics
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS learning_topics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id          uuid NOT NULL REFERENCES learning_modules(id) ON DELETE CASCADE,
  title              text NOT NULL,
  description        text,
  difficulty         difficulty_level NOT NULL DEFAULT 'beginner',
  order_index        integer NOT NULL DEFAULT 0,
  estimated_minutes  integer NOT NULL DEFAULT 30,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_topics_module ON learning_topics(module_id);

-- ---------------------------------------------------------------------------
-- 6. learning_resources
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS learning_resources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id   uuid NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
  type       text NOT NULL DEFAULT 'article' CHECK (type IN ('video','article','documentation','course','practice')),
  title      text NOT NULL,
  url        text NOT NULL,
  source     text,
  duration_minutes integer,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_resources_topic ON learning_resources(topic_id);

-- ---------------------------------------------------------------------------
-- 7. tests  (one active test per employee per topic)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  topic_id              uuid NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
  subject_id            uuid NOT NULL REFERENCES learning_subjects(id) ON DELETE CASCADE,
  difficulty            difficulty_level NOT NULL DEFAULT 'beginner',
  total_questions       integer NOT NULL DEFAULT 15,
  time_limit_seconds    integer NOT NULL DEFAULT 900,
  status                text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','in_progress','completed','abandoned')),
  current_question_index integer NOT NULL DEFAULT 0,
  started_at            timestamptz,
  completed_at          timestamptz,
  in_progress           jsonb,          -- last-selected options per question
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, topic_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_emp_topic ON tests(employee_id, topic_id);

-- ---------------------------------------------------------------------------
-- 8. test_questions  (15 questions per test, persisted for persistence)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS test_questions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id              uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_index       integer NOT NULL,
  question_text        text NOT NULL,
  options              text[] NOT NULL,
  correct_option_index integer NOT NULL,
  explanation          text NOT NULL,
  difficulty           difficulty_level NOT NULL,
  topic_id             uuid NOT NULL,
  topic_title          text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(test_id, question_index)
);

-- ---------------------------------------------------------------------------
-- 9. test_attempts  (one row per question answered)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS test_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id               uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  question_id           uuid NOT NULL REFERENCES test_questions(id) ON DELETE CASCADE,
  selected_option_index integer NOT NULL,
  is_correct            boolean NOT NULL,
  time_taken_seconds    integer NOT NULL DEFAULT 0,
  session_key           text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_attempts_test ON test_attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_employee ON test_attempts(employee_id);

-- ---------------------------------------------------------------------------
-- 10. Row Level Security
--     Auth users always see/edit only their own rows
-- ---------------------------------------------------------------------------

-- Row level security is disabled for public-anon access since Next.js API routes act as the secure boundary
-- ALTER TABLE employees                 ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tests                     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE test_questions            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE test_attempts             ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE learning_subjects         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE learning_modules          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE learning_topics           ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE learning_resources        ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY emp_read_own ON employees
--   FOR SELECT USING (auth.uid() = id);

-- CREATE POLICY emp_update_own ON employees
--   FOR UPDATE USING (auth.uid() = id);

-- CREATE POLICY emp_test_read_own ON tests
--   FOR SELECT USING (auth.uid() = employee_id);

-- CREATE POLICY emp_test_write_own ON tests
--   FOR ALL USING (auth.uid() = employee_id);

-- CREATE POLICY emp_q_read_own ON test_questions
--   FOR SELECT USING (
--     EXISTS (SELECT 1 FROM tests t WHERE t.id = test_questions.test_id AND t.employee_id = auth.uid())
--   );

-- CREATE POLICY emp_attempt_write_own ON test_attempts
--   FOR INSERT WITH CHECK (auth.uid() = employee_id);

-- CREATE POLICY emp_attempt_read_own ON test_attempts
--   FOR SELECT USING (auth.uid() = employee_id);

-- Learning content is publicly readable to all authenticated users
-- CREATE POLICY lc_read ON learning_subjects  FOR SELECT USING (auth.uid() IS NOT NULL);
-- CREATE POLICY lc_read ON learning_modules   FOR SELECT USING (auth.uid() IS NOT NULL);
-- CREATE POLICY lc_read ON learning_topics    FOR SELECT USING (auth.uid() IS NOT NULL);
-- CREATE POLICY lc_read ON learning_resources FOR SELECT USING (auth.uid() IS NOT NULL);

-- Admin full access granted in the Supabase dashboard per-role; keep policy-free here.

-- ---------------------------------------------------------------------------
-- 11. Realtime (optional — broadcast new attempts to admin dashboard)
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE tests;
ALTER PUBLICATION supabase_realtime ADD TABLE test_attempts;

-- ---------------------------------------------------------------------------
-- 12. job_descriptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS job_descriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jd_text     text NOT NULL,
  rm_email    text NOT NULL,
  file_name   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- End of schema
-- ============================================================

-- ---------------------------------------------------------------------------
-- 13. simulated_emails
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

-- ---------------------------------------------------------------------------
-- 14. resumes alterations for persistence
-- ---------------------------------------------------------------------------

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_hash text;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_base64 text;

-- ---------------------------------------------------------------------------
-- 15. reset_logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reset_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_email  text NOT NULL,
  reset_by         text NOT NULL,
  source           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 16. candidate_sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS candidate_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE,
  email            text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  used             boolean NOT NULL DEFAULT false,
  resume_id        uuid REFERENCES resumes(id) ON DELETE CASCADE,
  used_at          timestamptz
);


