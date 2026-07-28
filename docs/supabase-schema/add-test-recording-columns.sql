-- Run in Supabase SQL Editor if employee test video download fails with missing columns.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS session_recording_url text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_correct integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_total integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS score_percent integer;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS employee_code text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS topic_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS subject_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS ai_analysis text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS proctoring jsonb;
