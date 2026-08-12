-- ============================================================
-- Resume Intelligence Platform - Phase 8 Schema Upgrade
-- Run this in the Supabase SQL Editor → https://supabase.co/dashboard/sql
--
-- Adds tests.topic_title / tests.subject_title: the topic/subject name is
-- captured at test-creation time and stored directly on the row, instead of
-- being resolved purely through topic_id/subject_id foreign keys every time
-- it's displayed.
--
-- Why: if a topic/subject row is ever deleted or re-pointed later (e.g. a
-- catalog cleanup that didn't carefully re-point every foreign key first),
-- older tests referencing the old id show as "Unknown Topic" forever, with
-- no way to recover what they used to say. Denormalizing the title means a
-- test's own history is self-contained and survives catalog changes.
--
-- Additive and nullable — falls back to the topic_id/subject_id lookup for
-- existing rows created before this column existed.
-- ============================================================

ALTER TABLE tests ADD COLUMN IF NOT EXISTS topic_title text;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS subject_title text;
