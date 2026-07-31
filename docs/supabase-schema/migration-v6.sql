-- ============================================================
-- Resume Intelligence Platform - Phase 6 Schema Upgrade
-- Run this in the Supabase SQL Editor → https://supabase.co/dashboard/sql
--
-- Fixes duplicate learning_subjects/learning_modules/learning_topics rows
-- (caused by seed-curriculum.sql being run more than once with no
-- conflict protection — each run inserted a fresh full set with new UUIDs).
--
-- SAFE BY DESIGN: this re-points every foreign key (learning_modules,
-- learning_topics, tests) from duplicate rows to a single canonical row
-- BEFORE deleting anything, so no employee test history is lost to the
-- ON DELETE CASCADE on these tables. Back up your database before running
-- regardless — this is a real DELETE, not a drill.
--
-- Run this once. It then adds UNIQUE constraints so duplicates can never
-- be reinserted again, and seed-curriculum.sql is updated to be safe to
-- re-run (ON CONFLICT DO NOTHING) going forward.
-- ============================================================

BEGIN;

-- ---- 1. Dedup learning_subjects by title -----------------------------
WITH ranked AS (
  SELECT id, title, ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at ASC, id ASC) AS rn
  FROM learning_subjects
),
canonical AS (SELECT title, id AS canonical_id FROM ranked WHERE rn = 1),
dups AS (SELECT r.id AS dup_id, c.canonical_id FROM ranked r JOIN canonical c USING (title) WHERE r.rn > 1)
UPDATE learning_modules m SET subject_id = d.canonical_id FROM dups d WHERE m.subject_id = d.dup_id;

WITH ranked AS (
  SELECT id, title, ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at ASC, id ASC) AS rn
  FROM learning_subjects
),
canonical AS (SELECT title, id AS canonical_id FROM ranked WHERE rn = 1),
dups AS (SELECT r.id AS dup_id, c.canonical_id FROM ranked r JOIN canonical c USING (title) WHERE r.rn > 1)
UPDATE tests t SET subject_id = d.canonical_id FROM dups d WHERE t.subject_id = d.dup_id;

WITH ranked AS (
  SELECT id, title, ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at ASC, id ASC) AS rn
  FROM learning_subjects
)
DELETE FROM learning_subjects WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ---- 2. Dedup learning_modules by (subject_id, title) -----------------
-- (Now safe: step 1 already merged every module onto its canonical subject.)
WITH ranked AS (
  SELECT id, subject_id, title, ROW_NUMBER() OVER (PARTITION BY subject_id, title ORDER BY created_at ASC, id ASC) AS rn
  FROM learning_modules
),
canonical AS (SELECT subject_id, title, id AS canonical_id FROM ranked WHERE rn = 1),
dups AS (SELECT r.id AS dup_id, c.canonical_id FROM ranked r JOIN canonical c USING (subject_id, title) WHERE r.rn > 1)
UPDATE learning_topics t SET module_id = d.canonical_id FROM dups d WHERE t.module_id = d.dup_id;

WITH ranked AS (
  SELECT id, subject_id, title, ROW_NUMBER() OVER (PARTITION BY subject_id, title ORDER BY created_at ASC, id ASC) AS rn
  FROM learning_modules
)
DELETE FROM learning_modules WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ---- 3. Dedup learning_topics by (module_id, title) -------------------
WITH ranked AS (
  SELECT id, module_id, title, ROW_NUMBER() OVER (PARTITION BY module_id, title ORDER BY created_at ASC, id ASC) AS rn
  FROM learning_topics
),
canonical AS (SELECT module_id, title, id AS canonical_id FROM ranked WHERE rn = 1),
dups AS (SELECT r.id AS dup_id, c.canonical_id FROM ranked r JOIN canonical c USING (module_id, title) WHERE r.rn > 1)
UPDATE tests t SET topic_id = d.canonical_id FROM dups d WHERE t.topic_id = d.dup_id;

WITH ranked AS (
  SELECT id, module_id, title, ROW_NUMBER() OVER (PARTITION BY module_id, title ORDER BY created_at ASC, id ASC) AS rn
  FROM learning_topics
)
DELETE FROM learning_topics WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ---- 4. Prevent recurrence ---------------------------------------------
ALTER TABLE learning_subjects ADD CONSTRAINT learning_subjects_title_unique UNIQUE (title);
ALTER TABLE learning_modules ADD CONSTRAINT learning_modules_subject_title_unique UNIQUE (subject_id, title);
ALTER TABLE learning_topics ADD CONSTRAINT learning_topics_module_title_unique UNIQUE (module_id, title);

COMMIT;
