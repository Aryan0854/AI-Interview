-- ============================================================
-- Resume Intelligence Platform - Phase 9 Schema Upgrade
-- Run this in the Supabase SQL Editor → https://supabase.co/dashboard/sql
--
-- Adds columns the application code already reads/writes but that were
-- missing from the deployed schema — this was causing real runtime errors:
--   "Failed to upsert employee account: Could not find the 'assessment_only'
--    column of 'employees' in the schema cache"
-- and would also have broken test submission (score_correct/score_total/
-- score_percent/proctoring/ai_analysis on `tests`) once a user got that far.
--
-- All additive and nullable/defaulted — safe to run against an existing
-- database with live data.
-- ============================================================

-- employees: password auth + product-assessment fields
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_salt text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS product_qb_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS assessment_only boolean NOT NULL DEFAULT false;

-- tests: denormalized display titles (also covered by migration-v8 for
-- databases that already ran it — IF NOT EXISTS makes this safe either way),
-- proctoring/recording, and score persistence written by the submit route.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS topic_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS subject_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS employee_code text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS session_recording_url text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS proctoring jsonb;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_correct integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_total integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_percent integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS ai_analysis jsonb;
