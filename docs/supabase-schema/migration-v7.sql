-- ============================================================
-- Resume Intelligence Platform - Phase 7 Schema Upgrade
-- Run this in the Supabase SQL Editor → https://supabase.co/dashboard/sql
--
-- Adds topic_source_documents: PDFs an admin uploads per learning topic,
-- whose extracted text grounds quiz question generation for that topic.
-- Questions can still be LLM-generated beyond the PDF's exact content —
-- the PDF constrains topical scope, it isn't the only source.
--
-- Also requires a Supabase Storage bucket named "quiz-source-docs"
-- (create it in the Supabase dashboard → Storage → New bucket, private).
-- ============================================================

CREATE TABLE IF NOT EXISTS topic_source_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id        uuid NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  storage_path    text NOT NULL,
  extracted_text  text,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topic_source_documents_topic ON topic_source_documents(topic_id);
