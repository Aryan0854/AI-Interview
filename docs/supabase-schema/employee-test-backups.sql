-- Append-only backups of Employee Portal tests.
-- Live `tests` / `test_attempts` rows are unchanged. Admin still shows pending, in progress, and completed.

CREATE TABLE IF NOT EXISTS employee_test_backups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id        text NOT NULL,
  employee_code  text,
  event          text NOT NULL,
  snapshot       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_test_backups_test
  ON employee_test_backups (test_id, created_at DESC);

ALTER TABLE employee_test_backups ENABLE ROW LEVEL SECURITY;
