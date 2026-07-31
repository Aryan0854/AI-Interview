-- =============================================================================
-- AI INTERVIEW & EMPLOYEE PORTAL — MASTER DATABASE SCHEMA
-- =============================================================================
-- Purpose: Single source-of-truth SQL for disaster recovery, new environments,
--          and migrating from Supabase PostgreSQL → Azure Database for PostgreSQL.
--
-- Idempotent: Safe to re-run (IF NOT EXISTS, DO blocks, DROP POLICY IF EXISTS).
--
-- ---------------------------------------------------------------------------
-- TABLE INVENTORY (21 tables + 1 view)
-- ---------------------------------------------------------------------------
--  Candidate screening:
--    resumes, interview_questions, interview_attempts, candidate_sessions,
--    candidate_interview_data
--  Admin / HR:
--    job_descriptions, simulated_emails, reset_logs, audit_logs, portal_settings
--  Employee portal:
--    employees, tests, test_questions, test_attempts
--  Learning curriculum:
--    learning_subjects, learning_modules, learning_topics, learning_resources
--  Effectiveness (Kirkpatrick):
--    evaluations, behavior_evaluations, business_impacts
--  View:
--    employee_test_results
--
-- ---------------------------------------------------------------------------
-- AZURE MIGRATION CHECKLIST
-- ---------------------------------------------------------------------------
-- 1. Create Azure Database for PostgreSQL (Flexible Server, PG 15+).
-- 2. Enable extension: pgcrypto (Azure: allow-list in server parameters).
-- 3. Run THIS file on the empty Azure database.
-- 4. Export DATA from Supabase (see section 15 at bottom).
-- 5. Import data into Azure with psql or pg_restore.
-- 6. Update app env vars:
--      DATABASE_URL or NEXT_PUBLIC_SUPABASE_URL → Azure connection string
--      Replace Supabase Storage with Azure Blob (recordings, resumes, app-data, docs-ingest).
-- 7. RLS policies below use auth.uid() (Supabase Auth). On Azure the app uses
--    service-role / connection string and bypasses RLS — safe to DISABLE RLS
--    or skip policies if you do not run Supabase Auth (see section 10 notes).
-- 8. Skip NOTIFY pgrst (Supabase PostgREST only).
--
-- ---------------------------------------------------------------------------
-- NOT IN POSTGRES (migrate separately to Azure Blob / files)
-- ---------------------------------------------------------------------------
--   Supabase Storage buckets:
--     recordings      — interview + employee test videos (*.webm)
--     verifications   — candidate ID/selfie images
--     resumes         — uploaded resume binaries
--     app-data        — employee_test_manifest.json, local_tests_db.json
--     docs-ingest     — BR, JD, Resumes, Corp Pool uploads (Vercel prod)
--   Repo files (not DB):
--     Resource_Question_Mapping.xlsx, Employee_User_Credentials.xlsx
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Azure-only stub: create auth.uid() if missing (Supabase already has the real function).
DO $auth_stub$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS auth';
    EXECUTE $fn$
      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $body$ SELECT NULL::uuid $body$
    $fn$;
  END IF;
END
$auth_stub$;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE department_enum AS ENUM (
    'engineering', 'data-science', 'product', 'design',
    'marketing', 'hr', 'finance', 'operations', 'general'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE difficulty_level AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Resume Intelligence — candidate screening
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resumes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      text NOT NULL,
  text_content  text,
  parsed        jsonb,
  analysis      jsonb,
  enhanced      jsonb,
  report        jsonb,
  error         text,
  created_at    timestamptz DEFAULT now(),
  file_hash     text,
  file_base64   text,
  reset_count   integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS interview_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id       uuid NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  question_index  integer NOT NULL,
  question_text   text NOT NULL,
  created_at      timestamptz DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS candidate_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE,
  email            text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  used             boolean NOT NULL DEFAULT false,
  resume_id        uuid REFERENCES resumes(id) ON DELETE CASCADE,
  used_at          timestamptz
);

CREATE TABLE IF NOT EXISTS candidate_interview_data (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_name        text,
  email                 text,
  interview_status      text DEFAULT 'Pending',
  score                 numeric,
  warning_count         integer DEFAULT 0,
  evaluation            text,
  interview_started_at  timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Admin & operations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_descriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jd_text     text NOT NULL,
  rm_email    text NOT NULL,
  file_name   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email   text NOT NULL,
  action        text NOT NULL,
  target        text NOT NULL,
  details       text,
  ip_address    text,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. Employee profiles (production auth columns included)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         text UNIQUE NOT NULL,
  email               text NOT NULL,
  full_name           text NOT NULL,
  department          department_enum NOT NULL DEFAULT 'general',
  role                text NOT NULL DEFAULT '',
  avatar_url          text,
  xp_points           integer NOT NULL DEFAULT 0,
  streak_days         integer NOT NULL DEFAULT 0,
  last_active_date    date,
  badges              jsonb NOT NULL DEFAULT '[]',
  skill_level         text NOT NULL DEFAULT 'beginner'
                        CHECK (skill_level IN ('beginner','intermediate','advanced','expert')),
  ai_readiness_score  integer NOT NULL DEFAULT 0 CHECK (ai_readiness_score BETWEEN 0 AND 100),
  is_first_login      boolean NOT NULL DEFAULT true,
  product             text,
  password_hash       text,
  password_salt       text,
  product_qb_eligible boolean NOT NULL DEFAULT false,
  assessment_only     boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Learning curriculum
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

CREATE TABLE IF NOT EXISTS learning_modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  uuid NOT NULL REFERENCES learning_subjects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS learning_resources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id         uuid NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
  type             text NOT NULL DEFAULT 'article'
                     CHECK (type IN ('video','article','documentation','course','practice')),
  title            text NOT NULL,
  url              text NOT NULL,
  source           text,
  duration_minutes integer,
  order_index      integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. Employee MCQ tests & product question-bank assessments
--    topic_id / subject_id are TEXT (UUIDs OR 'resource-product-assessment')
--    Videos stored in object storage: recordings/employee-tests/{test_id}.webm
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id            uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_code          text NOT NULL DEFAULT '',
  topic_id               text NOT NULL,
  subject_id             text NOT NULL,
  topic_title            text,
  subject_title          text,
  difficulty             text NOT NULL DEFAULT 'medium',
  total_questions        integer NOT NULL DEFAULT 25,
  time_limit_seconds     integer NOT NULL DEFAULT 1800,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','in_progress','completed','abandoned')),
  current_question_index integer NOT NULL DEFAULT 0,
  started_at             timestamptz,
  completed_at           timestamptz,
  in_progress            jsonb,
  session_recording_url  text,
  proctoring             jsonb,
  score_correct          integer,
  score_total            integer,
  score_percent          numeric(5,2),
  ai_analysis            text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, topic_id)
);

CREATE TABLE IF NOT EXISTS test_questions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id              uuid NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_index       integer NOT NULL,
  question_text        text NOT NULL,
  options              text[] NOT NULL,
  correct_option_index integer NOT NULL,
  explanation          text NOT NULL DEFAULT '',
  difficulty           text NOT NULL DEFAULT 'medium',
  topic_id             text NOT NULL,
  topic_title          text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(test_id, question_index)
);

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

-- Admin reporting view
CREATE OR REPLACE VIEW employee_test_results AS
SELECT
  t.id                          AS test_id,
  t.employee_code,
  e.full_name                   AS employee_name,
  e.email                       AS employee_email,
  e.product,
  t.topic_id,
  t.topic_title,
  t.subject_id,
  t.subject_title,
  t.status,
  t.total_questions,
  t.score_correct,
  t.score_total,
  t.score_percent,
  t.started_at,
  t.completed_at,
  t.session_recording_url       AS video_url,
  t.proctoring,
  t.ai_analysis,
  COUNT(ta.id)                  AS answers_submitted,
  COUNT(ta.id) FILTER (WHERE ta.is_correct) AS answers_correct
FROM tests t
JOIN employees e ON e.id = t.employee_id
LEFT JOIN test_attempts ta ON ta.test_id = t.id
GROUP BY t.id, e.full_name, e.email, e.product;

-- ---------------------------------------------------------------------------
-- 7. Kirkpatrick / effectiveness evaluations
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
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id               text NOT NULL,
  subject_id                text NOT NULL,
  evaluator_role            text NOT NULL,
  evaluator_email           text NOT NULL,
  interval_days             integer NOT NULL,
  q1_demonstrates_skills    integer NOT NULL,
  q2_independently_applies  integer NOT NULL,
  q3_shares_learning        integer NOT NULL,
  q4_solves_problems        integer NOT NULL,
  q5_measurable_improvement integer NOT NULL,
  comments                  text,
  submitted_at              timestamptz NOT NULL DEFAULT now(),
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
  customer_csat_before      integer NOT NULL,
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
-- 8. Upgrade patch (safe on fresh installs AND existing Supabase DBs)
-- ---------------------------------------------------------------------------
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_hash text;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_base64 text;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS reset_count integer DEFAULT 0;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_salt text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS product_qb_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS assessment_only boolean NOT NULL DEFAULT false;

ALTER TABLE tests ADD COLUMN IF NOT EXISTS employee_code text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS topic_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS subject_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS session_recording_url text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS proctoring jsonb;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_correct integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_total integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_percent numeric(5,2);
ALTER TABLE tests ADD COLUMN IF NOT EXISTS ai_analysis text;

UPDATE tests t
SET employee_code = e.employee_id
FROM employees e
WHERE t.employee_id = e.id
  AND (t.employee_code IS NULL OR t.employee_code = '');

ALTER TABLE tests DROP CONSTRAINT IF EXISTS tests_topic_id_fkey;
ALTER TABLE tests DROP CONSTRAINT IF EXISTS tests_subject_id_fkey;
ALTER TABLE tests DROP CONSTRAINT IF EXISTS tests_employee_id_topic_id_key;

DO $$ BEGIN
  ALTER TABLE tests ALTER COLUMN topic_id TYPE text USING topic_id::text;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE tests ALTER COLUMN subject_id TYPE text USING subject_id::text;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE tests ALTER COLUMN difficulty TYPE text USING difficulty::text;
EXCEPTION WHEN others THEN NULL;
END $$;

ALTER TABLE test_questions DROP CONSTRAINT IF EXISTS test_questions_topic_id_fkey;

DO $$ BEGIN
  ALTER TABLE test_questions ALTER COLUMN topic_id TYPE text USING topic_id::text;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE test_questions ALTER COLUMN difficulty TYPE text USING difficulty::text;
EXCEPTION WHEN others THEN NULL;
END $$;

ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS topic_title text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE candidate_sessions ALTER COLUMN resume_id TYPE uuid USING resume_id::uuid;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_email ON audit_logs(actor_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_questions_resume ON interview_questions(resume_id);
CREATE INDEX IF NOT EXISTS idx_interview_attempts_resume ON interview_attempts(resume_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_learning_modules_subject ON learning_modules(subject_id);
CREATE INDEX IF NOT EXISTS idx_learning_topics_module ON learning_topics(module_id);
CREATE INDEX IF NOT EXISTS idx_learning_resources_topic ON learning_resources(topic_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_emp_topic ON tests(employee_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_tests_employee_code ON tests(employee_code);
CREATE INDEX IF NOT EXISTS idx_tests_status ON tests(status);
CREATE INDEX IF NOT EXISTS idx_tests_completed_at ON tests(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_questions_test ON test_questions(test_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_test ON test_attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_employee ON test_attempts(employee_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_question ON test_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_candidate_interview_email ON candidate_interview_data(email);
CREATE INDEX IF NOT EXISTS idx_job_descriptions_created ON job_descriptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulated_emails_candidate ON simulated_emails(candidate_email);

-- ---------------------------------------------------------------------------
-- 10. Row Level Security
--     App uses server connection string / service role → bypasses RLS in practice.
--     AZURE: If not using Supabase Auth, you may DISABLE RLS on all tables:
--       ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
--       (repeat for each table below)
-- ---------------------------------------------------------------------------
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_interview_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_descriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulated_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE reset_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_impacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emp_read_own ON employees;
CREATE POLICY emp_read_own ON employees FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS emp_update_own ON employees;
CREATE POLICY emp_update_own ON employees FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS emp_test_read_own ON tests;
CREATE POLICY emp_test_read_own ON tests FOR SELECT USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS emp_test_write_own ON tests;
CREATE POLICY emp_test_write_own ON tests FOR ALL USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS emp_q_read_own ON test_questions;
CREATE POLICY emp_q_read_own ON test_questions FOR SELECT USING (
  EXISTS (SELECT 1 FROM tests t WHERE t.id = test_questions.test_id AND t.employee_id = auth.uid())
);

DROP POLICY IF EXISTS emp_attempt_write_own ON test_attempts;
CREATE POLICY emp_attempt_write_own ON test_attempts FOR INSERT WITH CHECK (auth.uid() = employee_id);

DROP POLICY IF EXISTS emp_attempt_read_own ON test_attempts;
CREATE POLICY emp_attempt_read_own ON test_attempts FOR SELECT USING (auth.uid() = employee_id);

DROP POLICY IF EXISTS lc_read_subject ON learning_subjects;
CREATE POLICY lc_read_subject ON learning_subjects FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS lc_read_module ON learning_modules;
CREATE POLICY lc_read_module ON learning_modules FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS lc_read_topic ON learning_topics;
CREATE POLICY lc_read_topic ON learning_topics FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS lc_read_resource ON learning_resources;
CREATE POLICY lc_read_resource ON learning_resources FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS emp_eval_read_own ON evaluations;
CREATE POLICY emp_eval_read_own ON evaluations FOR SELECT USING (
  EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = evaluations.employee_id AND e.id = auth.uid())
);

DROP POLICY IF EXISTS emp_behavior_read_own ON behavior_evaluations;
CREATE POLICY emp_behavior_read_own ON behavior_evaluations FOR SELECT USING (
  EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = behavior_evaluations.employee_id AND e.id = auth.uid())
);

DROP POLICY IF EXISTS emp_impact_read_own ON business_impacts;
CREATE POLICY emp_impact_read_own ON business_impacts FOR SELECT USING (
  EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = business_impacts.employee_id AND e.id = auth.uid())
);

DROP POLICY IF EXISTS settings_read_all ON portal_settings;
CREATE POLICY settings_read_all ON portal_settings FOR SELECT USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 11. Default portal settings
-- ---------------------------------------------------------------------------
INSERT INTO portal_settings (key, value, updated_at)
VALUES (
  'portal_features',
  '{"showSystemLogsViewer":true}'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. Learning curriculum seed (14 subjects)
--     For the FULL topic tree also run: docs/supabase-schema/seed-curriculum.sql
-- ---------------------------------------------------------------------------
INSERT INTO learning_subjects (title, description, icon, color, order_index)
SELECT v.title, v.description, v.icon, v.color, v.order_index
FROM (VALUES
  ('Artificial Intelligence',         'Neural networks, expert systems, and foundational AI theory',                           'Brain',             '#3b82f6', 1),
  ('Machine Learning',               'Supervised, unsupervised, and reinforcement learning algorithms',                       'Activity',          '#8b5cf6', 2),
  ('Data Science',                   'Statistics, EDA, and end-to-end data pipelines',                                        'BarChart3',         '#10b981', 3),
  ('Deep Learning',                  'CNNs, RNNs, transformers, and advanced neural architectures',                           'Layers',            '#f59e0b', 4),
  ('Natural Language Processing',   'Text mining, sentiment analysis, and LLM engineering',                                  'MessageSquare',     '#ef4444', 5),
  ('Computer Vision',                'Image classification, object detection, and segmentation models',                       'Eye',               '#06b6d4', 6),
  ('Generative AI',                  'GANs, VAEs, diffusion models, and LLM fine-tuning',                                    'Sparkles',          '#ec4899', 7),
  ('Python Programming',             'Core language features, OOP, async, and standard library',                             'Terminal',          '#22c55e', 8),
  ('SQL & Databases',                'Query design, indexing, transactions, and optimization',                                'Database',          '#6366f1', 9),
  ('Cloud Computing',                'AWS/GCP/Azure fundamentals, IaaS/PaaS/SaaS, cost management',                          'Cloud',             '#0ea5e9', 10),
  ('MLOps',                          'CI/CD for ML, model serving, monitoring, and drift detection',                          'Gauge',             '#f97316', 11),
  ('Data Engineering',               'Pipelines, ETL/ELT, orchestration with Airflow / dbt, lakehouse',                      'GitBranch',         '#14b8a6', 12),
  ('Large Language Models',         'Prompt engineering, fine-tuning, RAG, function calling, evaluation',                   'Bot',               '#a855f7', 13),
  ('AI Ethics & Governance',        'Bias mitigation, responsible AI, EU AI Act, model auditing',                           'Shield',            '#64748b', 14)
) AS v(title, description, icon, color, order_index)
WHERE NOT EXISTS (SELECT 1 FROM learning_subjects LIMIT 1);

INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Introduction to AI', 'History, definitions, and key milestones of artificial intelligence', 1
FROM learning_subjects WHERE title = 'Artificial Intelligence'
  AND NOT EXISTS (SELECT 1 FROM learning_modules lm JOIN learning_subjects ls ON lm.subject_id = ls.id WHERE ls.title = 'Artificial Intelligence');

INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT ls.id, t.title, t.description, t.ord
FROM learning_subjects ls
CROSS JOIN (VALUES
  ('Search Algorithms', 'BFS, DFS, A*, minimax, and alpha-beta pruning', 2),
  ('Knowledge Representation', 'Ontologies, logic, frames, and semantic networks', 3),
  ('Expert Systems', 'Rule-based systems, inference engines, and MYCIN architecture', 4),
  ('AI Agents', 'Goal-directed agents, environments, and utility-based decision-making', 5)
) AS t(title, description, ord)
WHERE ls.title = 'Artificial Intelligence'
  AND NOT EXISTS (SELECT 1 FROM learning_modules WHERE subject_id = ls.id AND title = t.title);

INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT ls.id, t.title, t.description, t.ord
FROM learning_subjects ls
CROSS JOIN (VALUES
  ('Supervised Learning', 'Linear/logistic regression, decision trees, k-NN, and SVM', 1),
  ('Unsupervised Learning', 'K-means, PCA, t-SNE, and Gaussian mixture models', 2),
  ('Reinforcement Learning', 'Q-learning, policy gradients, and actor-critic architectures', 3),
  ('Model Evaluation', 'Metrics, cross-validation, ROC-AUC, F1, and hyperparameter tuning', 4),
  ('Ensemble Methods', 'Random forests, XGBoost, bagging, and boosting', 5)
) AS t(title, description, ord)
WHERE ls.title = 'Machine Learning'
  AND NOT EXISTS (SELECT 1 FROM learning_modules WHERE subject_id = ls.id AND title = t.title);

INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT ls.id, t.title, t.description, t.ord
FROM learning_subjects ls
CROSS JOIN (VALUES
  ('Statistical Foundations', 'Probability, distributions, hypothesis testing, and Bayesian inference', 1),
  ('EDA & Visualization', 'Matplotlib, seaborn, EDA techniques, and storytelling with data', 2),
  ('Pandas & NumPy Deep Dive', 'Vectorised operations, pivoting, and time-series analysis', 3)
) AS t(title, description, ord)
WHERE ls.title = 'Data Science'
  AND NOT EXISTS (SELECT 1 FROM learning_modules WHERE subject_id = ls.id AND title = t.title);

INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT ls.id, 'Core Concepts', 'Foundational topics for ' || ls.title, 1
FROM learning_subjects ls
WHERE ls.title NOT IN ('Artificial Intelligence', 'Machine Learning', 'Data Science')
  AND NOT EXISTS (SELECT 1 FROM learning_modules WHERE subject_id = ls.id AND title = 'Core Concepts');

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
JOIN learning_subjects s ON s.id = m.subject_id
CROSS JOIN (VALUES
  ('History of AI', 'beginner', 1, 20),
  ('Search Algorithms (BFS/DFS)', 'intermediate', 2, 30),
  ('Expert Systems', 'advanced', 3, 30)
) AS t(title, difficulty, ord, mins)
WHERE s.title = 'Artificial Intelligence' AND m.title = 'Introduction to AI'
  AND NOT EXISTS (SELECT 1 FROM learning_topics WHERE module_id = m.id LIMIT 1);

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
JOIN learning_subjects s ON s.id = m.subject_id
CROSS JOIN (VALUES
  ('Linear Regression', 'beginner', 1, 25),
  ('Decision Trees', 'intermediate', 2, 30),
  ('Support Vector Machines', 'intermediate', 3, 30)
) AS t(title, difficulty, ord, mins)
WHERE s.title = 'Machine Learning' AND m.title = 'Supervised Learning'
  AND NOT EXISTS (SELECT 1 FROM learning_topics WHERE module_id = m.id LIMIT 1);

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Fundamentals', 'beginner', 1, 25),
  ('Intermediate Concepts', 'intermediate', 2, 30),
  ('Advanced Topics', 'advanced', 3, 35)
) AS t(title, difficulty, ord, mins)
WHERE m.title = 'Core Concepts'
  AND NOT EXISTS (SELECT 1 FROM learning_topics WHERE module_id = m.id LIMIT 1);

-- ---------------------------------------------------------------------------
-- 13. Supabase-only (skip on Azure)
-- ---------------------------------------------------------------------------
-- NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 14. POST-SCHEMA: Load production employee test data (run AFTER this file)
-- =============================================================================
-- These are NOT SQL — run from project root with .env.local configured:
--
--   npx tsx scripts/sync-employee-accounts-to-supabase.ts   → employees table
--   npx tsx scripts/sync-local-tests-to-supabase.ts         → tests, questions, attempts
--   npx tsx scripts/sync-manifest-to-supabase.ts            → app-data bucket (manifest)
--   npx tsx scripts/sync-docs-to-cloud.ts                   → docs-ingest bucket
--
-- =============================================================================
-- 15. EXPORT DATA FROM SUPABASE (before Azure import)
-- =============================================================================
-- Replace connection string with your Supabase direct Postgres URL:
--   Project Settings → Database → Connection string (URI)
--
-- Export schema-only (already covered by this file):
--   pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges -f schema-backup.sql
--
-- Export data-only (all app tables):
--   pg_dump "$SUPABASE_DB_URL" --data-only --no-owner --no-privileges \
--     -t employees -t tests -t test_questions -t test_attempts \
--     -t resumes -t interview_questions -t interview_attempts \
--     -t candidate_sessions -t candidate_interview_data \
--     -t job_descriptions -t simulated_emails -t reset_logs \
--     -t audit_logs -t portal_settings \
--     -t learning_subjects -t learning_modules -t learning_topics -t learning_resources \
--     -t evaluations -t behavior_evaluations -t business_impacts \
--     -f data-backup.sql
--
-- Import into Azure:
--   psql "$AZURE_DB_URL" -f master-azure-migration.sql
--   psql "$AZURE_DB_URL" -f data-backup.sql
--
-- Or full dump (schema + data) one shot from Supabase:
--   pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges -F c -f full-backup.dump
--   pg_restore -d "$AZURE_DB_URL" --no-owner --no-privileges full-backup.dump
--
-- =============================================================================
-- 16. AZURE BLOB STORAGE MAPPING (replaces Supabase Storage)
-- =============================================================================
--   recordings/              → Azure container: recordings
--   verifications/             → Azure container: verifications
--   resumes/                   → Azure container: resumes
--   app-data/                  → Azure container: app-data
--   docs-ingest/               → Azure container: docs-ingest
-- =============================================================================
-- END master-azure-migration.sql
-- =============================================================================
