-- =============================================================================
-- Upgrade existing Supabase project (migration-v1) → production employee tests
-- Run ONCE in Supabase SQL Editor before sync-local-tests-to-supabase.ts
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- employees.product + auth columns
ALTER TABLE employees ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_salt text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS product_qb_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS assessment_only boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- tests: allow product-assessment topic IDs (text, not UUID FK)
-- ---------------------------------------------------------------------------
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
WHERE t.employee_id = e.id AND (t.employee_code IS NULL OR t.employee_code = '');

CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_employee_topic
  ON tests (employee_id, topic_id);

-- ---------------------------------------------------------------------------
-- test_questions: text topic_id + text difficulty (product QB uses "medium")
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Admin read view
-- ---------------------------------------------------------------------------
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

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
