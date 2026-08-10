
-- ============================================================
-- 0. Create resumes table (Pre-requisite for migrations)
-- ============================================================
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

ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- 0b. Create audit_logs, interview_questions, and interview_attempts tables
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

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_email ON audit_logs(actor_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS interview_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id       uuid NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  question_index  integer NOT NULL,
  question_text   text NOT NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_interview_questions_resume ON interview_questions(resume_id);

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

ALTER TABLE interview_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_interview_attempts_resume ON interview_attempts(resume_id);


-- ============================================================

-- 1. Phase 1 Migration

-- ============================================================

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




-- ============================================================

-- 2. Phase 2 Migration

-- ============================================================

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


-- ============================================================

-- 3. Seed Curriculum Data

-- ============================================================

-- ============================================================
-- Employee Learning Portal — Seed data for initial deployment
-- Run after runs migration-v1.sql
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Learning Subjects (14)
-- ---------------------------------------------------------------------------
INSERT INTO learning_subjects (title, description, icon, color, order_index)
VALUES
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
  ('AI Ethics & Governance',        'Bias mitigation, responsible AI, EU AI Act, model auditing',                           'Shield',            '#64748b', 14);

-- ---------------------------------------------------------------------------
-- 2. Modules — Artificial Intelligence (subject 1)
-- ---------------------------------------------------------------------------
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Introduction to AI',          'History, definitions, and key milestones of artificial intelligence',       1 FROM learning_subjects WHERE title = 'Artificial Intelligence';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Search Algorithms',          'BFS, DFS, A*, minimax, and alpha-beta pruning',                            2 FROM learning_subjects WHERE title = 'Artificial Intelligence';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Knowledge Representation',   'Ontologies, logic, frames, and semantic networks',                         3 FROM learning_subjects WHERE title = 'Artificial Intelligence';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Expert Systems',            'Rule-based systems, inference engines, and MYCIN architecture',            4 FROM learning_subjects WHERE title = 'Artificial Intelligence';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'AI Agents',                 'Goal-directed agents, environments, and utility-based decision-making',    5 FROM learning_subjects WHERE title = 'Artificial Intelligence';

-- ---------------------------------------------------------------------------
-- 3. Modules — Machine Learning (subject 2)
-- ---------------------------------------------------------------------------
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Supervised Learning',       'Linear/logistic regression, decision trees, k-NN, and SVM',            1 FROM learning_subjects WHERE title = 'Machine Learning';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Unsupervised Learning',     'K-means, PCA, t-SNE, and Gaussian mixture models',                       2 FROM learning_subjects WHERE title = 'Machine Learning';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Reinforcement Learning',    'Q-learning, policy gradients, and actor-critic architectures',           3 FROM learning_subjects WHERE title = 'Machine Learning';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Model Evaluation',         'Metrics, cross-validation, ROC-AUC, F1, and hyperparameter tuning',    4 FROM learning_subjects WHERE title = 'Machine Learning';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Ensemble Methods',         'Random forests, XGBoost, bagging, and boosting',                         5 FROM learning_subjects WHERE title = 'Machine Learning';

-- ---------------------------------------------------------------------------
-- 4. Modules — Data Science (subject 3)  (sample only — extend as needed)
-- ---------------------------------------------------------------------------
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Statistical Foundations',   'Probability, distributions, hypothesis testing, and Bayesian inference', 1 FROM learning_subjects WHERE title = 'Data Science';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'EDA & Visualization',       'Matplotlib, seaborn, EDA techniques, and storytelling with data',        2 FROM learning_subjects WHERE title = 'Data Science';
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Pandas & NumPy Deep Dive',  'Vectorised operations, pivoting, and time-series analysis',              3 FROM learning_subjects WHERE title = 'Data Science';

-- Remaining 11 subjects get a single generic module each as a starting point
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Core Concepts', 'Foundational topics for ' || title, 1
FROM learning_subjects WHERE title NOT IN ('Artificial Intelligence','Machine Learning','Data Science');

-- ============================================================
-- 5. Topics  (SQL names from snake_case; not lucide)
-- ============================================================

-- ---------- Artificial Intelligence subject ----------
INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('History of AI',                 'beginner',    1, 20),
  ('Search Algorithms (BFS/DFS)',  'intermediate',2, 30),
  ('Adversarial Search',            'intermediate',3, 30),
  ('Knowledge Representation',      'advanced',    4, 30),
  ('Expert Systems',                'advanced',    5, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'Introduction to AI'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('BFS & DFS',                     'beginner',    1, 20),
  ('A* Search',                     'intermediate',2, 30),
  ('Minimax',                       'intermediate',3, 30),
  ('Alpha-Beta Pruning',            'advanced',    4, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'Search Algorithms'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Ontologies & Frames',           'intermediate',1, 25),
  ('Propositional Logic',           'intermediate',2, 25),
  ('Semantic Networks',             'advanced',    3, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'Knowledge Representation'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Rule-Based Systems',            'intermediate',1, 25),
  ('Inference Engines',             'intermediate',2, 25),
  ('MYCIN Architecture',            'advanced',    3, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'Expert Systems'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Goal-Directed Agents',          'beginner',    1, 20),
  ('Utility-Based Decision Making', 'intermediate',2, 25),
  ('Reinforcement Learning Basics', 'advanced',    3, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'AI Agents'
ORDER BY t.ord;

-- ---------- Machine Learning subject ----------
INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Linear Regression',             'beginner',    1, 25),
  ('Logistic Regression',           'beginner',    2, 25),
  ('Decision Trees',                'intermediate',3, 30),
  ('k-NN',                          'beginner',    4, 20),
  ('Support Vector Machines',       'intermediate',5, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Supervised Learning'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('K-Means Clustering',            'intermediate',1, 25),
  ('PCA',                           'intermediate',2, 25),
  ('t-SNE',                         'advanced',    3, 30),
  ('Gaussian Mixture Models',       'advanced',    4, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Unsupervised Learning'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Q-Learning',                    'advanced',    1, 30),
  ('Policy Gradients',              'advanced',    2, 30),
  ('Actor-Critic Methods',          'expert',      3, 35)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Reinforcement Learning'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Classification Metrics',        'intermediate',1, 25),
  ('ROC-AUC & F1',                  'intermediate',2, 25),
  ('Cross-Validation',              'beginner',    3, 20),
  ('Hyperparameter Tuning',         'intermediate',4, 25)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Model Evaluation'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Random Forests',                'intermediate',1, 25),
  ('XGBoost & LightGBM',            'intermediate',2, 30),
  ('Bagging & Boosting',            'intermediate',3, 25),
  ('Stacking',                      'advanced',    4, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Ensemble Methods'
ORDER BY t.ord;

-- ---------- Data Science subject ----------
INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Probability Distributions',     'intermediate',1, 25),
  ('Hypothesis Testing',            'intermediate',2, 25),
  ('Bayesian Inference',            'advanced',    3, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Data Science')
  AND m.title = 'Statistical Foundations'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Visualization Principles',      'beginner',    1, 20),
  ('Missing Data Handling',         'intermediate',2, 25),
  ('Outlier Detection',             'intermediate',3, 25)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Data Science')
  AND m.title = 'EDA & Visualization'
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Vectorised Operations',         'beginner',    1, 20),
  ('GroupBy & Pivot Tables',        'intermediate',2, 25),
  ('Time-Series Indexing',          'intermediate',3, 25)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Data Science')
  AND m.title = 'Pandas & NumPy Deep Dive'
ORDER BY t.ord;

-- ---------- All 11 remaining subjects (each has "Core Concepts" module) ----------
INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Fundamentals',                  'beginner',    1, 25),
  ('Intermediate Concepts',         'intermediate',2, 30),
  ('Advanced Topics',               'advanced',    3, 35)
) AS t(title, difficulty, ord, mins)
WHERE m.title = 'Core Concepts'
ORDER BY m.subject_id, t.ord;

-- ============================================================
-- Seed completed
-- ============================================================
