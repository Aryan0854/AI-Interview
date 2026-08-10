# Supabase Integration Documentation

This document provides a comprehensive technical overview of how **Supabase** is configured, structured, and utilized within this application. It explains data flow, table relationships, schema setup, and step-by-step instructions on how to inspect, query, or manually insert data into your Supabase database.

---

## 1. Architecture & Connection Overview

The application interacts with Supabase using `@supabase/supabase-js` via two client instances defined in [`src/lib/db.ts`](file:///c:/Users/aryanmi/OneDrive%20-%20Infinite%20Computer%20Solutions%20(India)%20Limited/Desktop/Interviee/src/lib/db.ts):

1. **Client-Side / Standard API Client (`supabase`)**:
   - Configured with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Used for standard reads and writes. Respects Row Level Security (RLS) policies where enabled.
2. **Server-Side Administrative Client (`supabaseServer`)**:
   - Configured with `SUPABASE_SERVICE_ROLE_KEY`.
   - Bypasses RLS policies. Used in server-side API routes for administrative tasks (e.g., bulk uploads, user session management, audit logging).

### Local Fallback Engine
To ensure high availability and prevent downtime when network or database limits occur, the system includes a local JSON database fallback ([`local-tests-db.ts`](file:///c:/Users/aryanmi/OneDrive%20-%20Infinite%20Computer%20Solutions%20(India)%20Limited/Desktop/Interviee/src/services/local-tests-db.ts) and [`resume-service.ts`](file:///c:/Users/aryanmi/OneDrive%20-%20Infinite%20Computer%20Solutions%20(India)%20Limited/Desktop/Interviee/src/services/resume-service.ts)). If a Supabase query fails, the application automatically falls back to local storage (`uploads/local_tests_db.json`, `uploads/resumes.json`).

---

## 2. Complete Database Schema Reference

The database consists of **18 primary tables** divided into three main operational domains:

```
                          ┌───────────────────────────┐
                          │         EMPLOYEES         │
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
┌─────────────────────┐      ┌─────────────────────┐      ┌─────────────────────┐
│       RESUMES       │      │        TESTS        │      │     EVALUATIONS     │
├─────────────────────┤      ├─────────────────────┤      ├─────────────────────┤
│ - parsed (jsonb)    │      │ - topic_id (uuid)   │      │ - bloom_scores      │
│ - analysis (jsonb)  │      │ - subject_id (uuid) │      │ - roi_score         │
│ - report (jsonb)    │      │ - status            │      │ - ai_readiness      │
└──────────┬──────────┘      └──────────┬──────────┘      └─────────────────────┘
           │                            │
           ▼                            ▼
┌─────────────────────┐      ┌─────────────────────┐
│ INTERVIEW_ATTEMPTS  │      │    TEST_ATTEMPTS    │
└─────────────────────┘      └─────────────────────┘
```

### Domain A: Candidate Screening & Resume Intelligence
- **`resumes`**: Stores candidate resume records.
  - `id` (uuid, Primary Key)
  - `filename` (text)
  - `text_content` (text, raw extracted text)
  - `parsed` (jsonb: personal details, skills, experience, education)
  - `analysis` (jsonb: suitability category, match score, breakdown)
  - `report` (jsonb: HR evaluation report and recommended questions)
  - `file_hash` (text, SHA-256 for deduplication)
  - `file_base64` (text, raw base64 binary representation)
- **`job_descriptions`**: Stores upload/scanned Job Description (JD) and Business Requirement (BR) documents.
- **`interview_questions`**: Persists AI-generated custom interview questions per candidate resume.
- **`interview_attempts`**: Stores candidate audio/video mock responses, AI score, and feedback.

### Domain B: Employee Assessment & Learning Portal
- **`employees`**: Profile records for internal employees and registered candidate accounts.
  - `id` (uuid, PK)
  - `employee_id` (text, Unique ID, e.g., `"1807232"`)
  - `email` (text)
  - `full_name` (text)
  - `department` (enum: `'engineering'`, `'data-science'`, `'product'`, `'hr'`, etc.)
  - `xp_points` (integer), `ai_readiness_score` (integer), `skill_level` (text)
- **`learning_subjects`**: Top-level curriculum subjects (e.g., *"Python Programming"*, *"SQL & Databases"*, *"AI / ML"*).
- **`learning_modules`**: Modules grouping topics under a subject.
- **`learning_topics`**: Specific assessment topics (e.g., *"Pandas DataFrames"*, *"Neural Networks Intro"*).
- **`learning_resources`**: Educational materials linked to topics.
- **`tests`**: Test session instances generated for an employee.
  - `id` (uuid, PK)
  - `employee_id` (uuid -> `employees.id`)
  - `topic_id` (uuid -> `learning_topics.id`)
  - `subject_id` (uuid -> `learning_subjects.id`)
  - `difficulty` (enum: `'beginner'`, `'intermediate'`, `'advanced'`, `'expert'`)
  - `status` (text: `'pending'`, `'in_progress'`, `'completed'`, `'abandoned'`)
- **`test_questions`**: Persisted question set for a specific test session.
- **`test_attempts`**: Individual question responses submitted by an employee.
  - `test_id` (uuid -> `tests.id`)
  - `selected_option_index` (integer)
  - `is_correct` (boolean)
- **`evaluations`**, **`behavior_evaluations`**, **`business_impacts`**: Analytical evaluation matrices calculated post-test.

### Domain C: System & Administration
- **`audit_logs`**: System audit trail (captures shortlisting, batch deletions, security events).
- **`simulated_emails`**: Outbox log for candidate automated emails.
- **`reset_logs`**: Logs candidate session reset requests.
- **`candidate_sessions`**: Active authentication tokens and session keys.
- **`portal_settings`**: Application feature toggles.

---

## 3. How Data Flows From Application to Supabase

### A. Resume Upload & Processing Flow
```
User uploads CV (.pdf / .docx / .zip)
  │
  ▼
API: /api/admin/resumes/upload_bulk
  │
  ▼
service: resumeService.processResumeSync()
  ├── Extracts text & generates SHA-256 hash
  ├── Calls AI for parsing & suitability scoring
  └── Supabase Upsert:
      supabase.from('resumes').upsert({ id, filename, parsed, analysis, report, file_hash })
```

### B. Employee Assessment & MCQ Test Flow
```
Employee starts test on Portal
  │
  ▼
API: /api/employee/tests/generate
  ├── Checks / Inserts record in `tests`
  └── Generates & saves 10-15 MCQ items in `test_questions`
  │
  ▼
Employee submits question answers
  │
  ▼
API: /api/employee/tests/[id]
  ├── Inserts answer row in `test_attempts` (is_correct: true/false)
  └── Upon final question: updates `tests.status = 'completed'` and `completed_at = now()`
```

---

## 4. How to Manually Add & Modify Data in Supabase

You can insert or modify data in Supabase using two methods: **Supabase Dashboard (GUI)** or **SQL Editor (Scripts)**.

### Method 1: Using Supabase Dashboard (Table Editor GUI)
1. Log in to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project.
3. Click on **Table Editor** (grid icon) on the left sidebar.
4. Select the table you want to modify (e.g., `employees`, `resumes`, or `learning_subjects`).
5. Click **Insert row** at the top right.
6. Fill in the field values:
   - For `UUID` fields (like `id`), leave blank to let Supabase auto-generate `gen_random_uuid()`, or enter a valid UUID.
   - For `jsonb` fields (like `parsed` or `analysis`), paste valid JSON objects (e.g., `{"email": "john@example.com"}`).
7. Click **Save**.

---

### Method 2: Using Supabase SQL Editor (SQL Scripts)

Open **SQL Editor** in your Supabase Dashboard and run any of the following copy-pasteable scripts:

#### A. Manually Insert a New Employee
```sql
INSERT INTO employees (
  employee_id,
  email,
  full_name,
  department,
  role,
  xp_points,
  ai_readiness_score,
  skill_level
) VALUES (
  'EMP-9901',
  'john.doe@enterprise.com',
  'John Doe',
  'engineering',
  'Senior Full-Stack Developer',
  1500,
  88,
  'Intermediate'
);
```

#### B. Manually Add a New Learning Subject & Topic
```sql
-- 1. Create the Subject
INSERT INTO learning_subjects (id, title, description, icon_name, order_index, is_active)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'React & Next.js Frameworks',
  'Modern Web Architecture & SSR',
  'Code',
  1,
  true
);

-- 2. Create a Topic under the Subject
INSERT INTO learning_topics (id, subject_id, title, description, order_index, is_active)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'App Router & Server Components',
  'Master Next.js 14+ App Directory paradigm',
  1,
  true
);
```

#### C. Manually Add a Candidate Resume Record
```sql
INSERT INTO resumes (
  id,
  filename,
  text_content,
  parsed,
  analysis,
  created_at
) VALUES (
  gen_random_uuid(),
  'John_Doe_Resume.pdf',
  'Extracted plain text of the resume goes here...',
  '{
    "personal": {
      "name": "John Doe",
      "email": "john.doe@enterprise.com",
      "phone": "+1-555-0199"
    },
    "skills": ["React", "TypeScript", "Node.js", "Supabase"]
  }'::jsonb,
  '{
    "suitability": "Suitable",
    "score": 92,
    "summary": "Strong candidate with comprehensive stack experience."
  }'::jsonb,
  NOW()
);
```

#### D. Manually Create a Test Session for an Employee
```sql
INSERT INTO tests (
  id,
  employee_id,
  topic_id,
  subject_id,
  difficulty,
  total_questions,
  status,
  started_at,
  completed_at
) VALUES (
  gen_random_uuid(),
  (SELECT id FROM employees WHERE employee_id = '1807232' LIMIT 1),
  (SELECT id FROM learning_topics LIMIT 1),
  (SELECT id FROM learning_subjects LIMIT 1),
  'intermediate',
  10,
  'completed',
  NOW() - INTERVAL '15 minutes',
  NOW()
);
```

#### E. Reset / Clean Up Candidate Data
```sql
-- Reset candidate attempts for a specific resume
DELETE FROM interview_attempts WHERE resume_id = 'YOUR_RESUME_UUID';
DELETE FROM candidate_sessions WHERE resume_id = 'YOUR_RESUME_UUID';

-- Reset resume row
UPDATE resumes SET reset_count = reset_count + 1 WHERE id = 'YOUR_RESUME_UUID';
```

---

## 5. Environment Variables & Setup Checklist

Ensure your `.env.local` file contains valid Supabase keys:

```env
# Public Supabase URL (found in Project Settings -> API)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co

# Public Anon Key (safe for browser)
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Secret Service Role Key (Server-only, bypasses RLS)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 6. Schema Initialization & Migrations

All database tables and seed data can be initialized at any time using the SQL files located in `docs/supabase-schema/`:

1. **[`combined-migration.sql`](file:///c:/Users/aryanmi/OneDrive%20-%20Infinite%20Computer%20Solutions%20(India)%20Limited/Desktop/Interviee/docs/supabase-schema/combined-migration.sql)**: Builds all 18 tables, indexes, enums, and foreign keys.
2. **[`seed-curriculum.sql`](file:///c:/Users/aryanmi/OneDrive%20-%20Infinite%20Computer%20Solutions%20(India)%20Limited/Desktop/Interviee/docs/supabase-schema/seed-curriculum.sql)**: Seeds default subjects (*AI/ML, Data Science, Python, SQL, Cloud Infrastructure, MLOps*), topics, and question pools.

To execute, paste the contents of these `.sql` files into the **Supabase Dashboard → SQL Editor** and click **Run**.
