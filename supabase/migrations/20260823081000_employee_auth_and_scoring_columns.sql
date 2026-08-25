-- ============================================================
-- Employee auth + product-assessment + test-scoring columns
--
-- This is migration-v9 from docs/supabase-schema/migration-v9.sql,
-- moved into supabase/migrations/ so it is actually tracked and applied
-- by the normal migration pipeline (`supabase db push` / CI deploy).
-- It was previously only a loose file in docs/, which is why the columns
-- below were missing from the live database even though the application
-- code (src/lib/employee-auth.ts, src/services/employee-account-store.ts)
-- already reads and writes them. That mismatch is what produced errors
-- like:
--   "Failed to upsert employee account: Could not find the 'assessment_only'
--    column of 'employees' in the schema cache"
-- which silently broke employee signup/login in production.
--
-- All statements are additive, nullable/defaulted, and idempotent
-- (IF NOT EXISTS) — safe to run against an existing database with live
-- data, and safe to run more than once.
-- ============================================================

-- employees: password auth + product-assessment fields
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_salt text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS product_qb_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS assessment_only boolean NOT NULL DEFAULT false;

-- tests: denormalized display titles, proctoring/recording, and score
-- persistence written by the submit route.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS topic_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS subject_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS employee_code text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS session_recording_url text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS proctoring jsonb;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_correct integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_total integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_percent integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS ai_analysis jsonb;
