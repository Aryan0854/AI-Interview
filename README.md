# 🚀 Resume Intelligence

**Hybrid AI Architecture — Local Heuristic Analysis + Cloud-Backed Persistence**

A production-grade resume intelligence system built with Next.js, TypeScript, and TailwindCSS.
The AI scoring engine runs entirely offline using rule-based heuristics; resume data and
interview records are persisted in a cloud-hosted Supabase PostgreSQL database.

---

## 📋 What Does It Do?

This platform analyzes, scores, and enhances resumes using a local TypeScript heuristic engine
and securely stores all results in the cloud. It provides:

1. **Resume Upload** — Drag & drop PDF/DOC/DOCX files (10 MB max)
2. **Intelligent Parsing** — Extracts structured data (experience, education, skills, projects)
3. **Deep Analysis** — Evaluates resume quality across 6 dimensions via a rule-based engine
4. **Weakness Detection** — Identifies poor wording, missing metrics, formatting issues
5. **Smart Enhancement** — Rewrites weak bullet points using local heuristics
6. **ATS Optimization** — Keyword analysis and compatibility scoring
7. **Visual Report** — Interactive charts, scores, and recruiter-style insights
8. **Admin Dashboard** — Review all candidate submissions, session management
9. **Interview Pipeline** — Auto-generated technical questions and AI-evaluated candidate answers

---

## 🏗️ System Architecture

### High-Level Flow

```
Candidate Upload
      │
      ▼
Resume Parsing  ──  pdf-parse / mammoth  (local text extraction)
      │
      ▼
Local AI Analysis Engine  ──  src/lib/local-ai.ts  (heuristic scoring)
      │
      ▼
Supabase PostgreSQL Storage
      │  ┌──────────────────────────────────────────┐
      └─►│  resumes      (parsed text, scores,      │
         │               analysis, report, metadata)│
         │  interview_questions  (15 Qs per resume) │
         │  interview_attempts  (answers + feedback)│
         └──────────────────────────────────────────┘
      │
      ▼
Admin Dashboard / Interview Pipeline
```

### Technology Stack

| Layer | Technology | File |
|---|---|---|
| **Frontend** | Next.js 14 · React 18 · TypeScript · TailwindCSS | `src/app/` |
| **UI Components** | Radix UI · Framer Motion · Recharts · Lucide Icons | `src/components/` |
| **AI / Analysis** | Local TypeScript heuristic engine (rule-based, no LLM) | `src/lib/local-ai.ts` |
| **Text Extraction** | `pdf-parse` (PDF), `mammoth` (DOCX) | `src/services/resume-service.ts` |
| **Database / Auth** | Supabase Postgres (hosted) · Supabase JS SDK | `src/lib/db.ts` |
| **Session Store** | JSON file on local disk | `src/services/session-service.ts` |

---

## 🤖 AI / Analysis Layer

The analysis engine is a **pure TypeScript rule-based system** located at
`src/lib/local-ai.ts`. It uses no Python, no ML models, and no external LLM APIs.
All heuristics run synchronously inside the Next.js Node.js runtime.

### Scoring Dimensions

| Dimension | Weight | What It Measures |
|---|---|---|
| Overall | — | Composite score |
| ATS | 20 % | Section presence, duplicates, whitespace, contact fields |
| Technical | 20 % | Tech-term density, depth language (architected, built from scratch) |
| Impact | 20 % | Strong verb usage, metric patterns (`/\d+%/`, `/\$[\d,]+/`) |
| Formatting | 15 % | Line length, required sections, whitespace |
| Clarity | 15 % | Passive voice, filler words, sentence length |
| Consistency | 10 % | Date-format conflicts |

### Key Heuristics

- **Weak verb list**: "responsible for", "helped with", "assisted in", "worked on", …
- **Strong verb categories**: Leadership, Technical, Business, Creative
- **Metric patterns**: `/\d+%/`, `/\$[\d,]+/`, `/\d+ users|clients|projects/`, `/team of \d+/i`
- **Passive voice detectors**: `/(was|were|has been|have been) \w+ed/i`
- **Readability**: Simplified Flesch Reading Ease, average sentence length, syllable estimation
- **Keyword matching**: 36 tech terms across software, data-engineering, and design industries
- **Redundant phrase detection**: "in order to", "due to the fact that", "in the process of", …

### Enhancement Engine

The same heuristic class短板 (`enhanceBulletPoint`, `rewriteSummary`) applies rule-based
rewrites to improve resume bullets before they reach the report:

- Prefix replacement: "Responsible for managing…" → "Led a team of…"
- Metric augmentation:动词/名词短语后附加可量化结果（by 40%, saving 20 h/week）
- Verb intensification: "worked on" → "delivered", "helped with" → "drove"
- Overlong-bullet condensing: removes filler clauses to stay under 200 chars

---

## 💾 Persistence Layer

### Why Supabase?

| Reason | Detail |
|---|---|
| **Multi-user concurrency** | Postgres handles thousands of simultaneous connections natively; SQLite uses file-level writes and is single-writer only |
| **Production-grade PostgreSQL** | Managed WAL logging, point-in-time recovery, automatic failover |
| **Scalability** | No manual provisioning needed; columnstore, read replicas, connection pooling available |
| **Row-level security (RLS)** | Policies restrict what each authenticated role can read/write — adds a security boundary |
| **Realtime / subscriptions** | `supabase.channel()` can push DB change events to clients without polling |
| **Type-safe JS SDK** | `supabase.from('t').insert/upsert/delete()` — no handwritten SQL, no injection risk |
| **Simpler deployment** | One connection string replaces provisioning/managing a standalone Postgres server |

### Database Schema

The Supabase project pointed at by `src/lib/db.ts` contains three tables:

**`resumes`**

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key |
| `filename` | `text` | Original uploaded filename |
| `text_content` | `text` | Raw extracted text from PDF/DOCX |
| `parsed` | `jsonb` | Structured parse: personal, experience, education, skills, … |
| `analysis` | `jsonb` | Full scoring output: scores, weaknesses, strengths, keywords |
| `enhanced` | `jsonb` | Rewritten bullets and improvement suggestions |
| `report` | `jsonb` | Final candidate-facing report |
| `error` | `text` | Optional processing error message |

**`interview_questions`**

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key |
| `resume_id` | `uuid` | FK → `resumes.id` |
| `question_index` | `integer` | Ordinal position (0–14) |
| `question_text` | `text` | The generated technical interview question |

**`interview_attempts`**

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key |
| `resume_id` | `uuid` | FK → `resumes.id` |
| `question_index` | `integer` | Which question this answer addresses |
| `question_text` | `text` | The question asked |
| `candidate_answer` | `text` | The candidate's written response |
| `mock_score` | `integer` | 1–10 evaluation score |
| `mock_feedback` | `text` | Written feedback |

### Access Pattern

All data access goes through the **Supabase JavaScript SDK** (`@supabase/supabase-js`).
No raw SQL strings appear anywhere in the codebase.

```typescript
// Read
supabase.from('resumes').select('*').eq('id', resumeId).single()

// Create / Update
supabase.from('resumes').upsert({ id, filename, text_content, … })

// Delete
supabase.from('resumes').delete().eq('id', id)

// Batch insert (interview questions)
supabase.from('interview_questions').insert(rows)
```

---

## 🔐 Data Privacy — Important Disclosure

> **Candidate resumes and interview records are stored in Supabase cloud infrastructure.**
>
> The **AI analysis engine itself** runs locally and does not send resume content to any
> external LLM or AI API during the heuristic-scoring path.
> However, the Supabase **PostgreSQL hosting layer is externally managed** and the
> uploaded files, parsed text, and interview data **persist on Supabase servers**,
> not solely on local disk.

| Data Type | Storage Location |
|---|---|
| Uploaded PDF / DOCX files | Local `uploads/` folder + Supabase |
| Parsed resume text, analysis, report | **Supabase cloud PostgreSQL** |
| Interview questions & candidate answers | **Supabase cloud PostgreSQL** |
| AI scoring logic (heuristic rules) | **Local source code only** |

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL (used by client and server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `EMPLOYEE_AUTH_SECRET` | ✅ | Secret used for custom employee bearer tokens in the local auth flow |
| `GEMINI_API_KEY` | optional | Google Gemini API key — enables AI-powered analysis; without it the local heuristic engine is used |
| `REDIS_URL` | optional | Redis connection URL (not yet wired; reserved for future caching) |
| `OPENAI_API_KEY` | optional | OpenAI API key (not yet wired; reserved for future LLM features) |
| `NEXTAUTH_SECRET` | optional | NextAuth secret (not yet wired) |

Example `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
EMPLOYEE_AUTH_SECRET=your-employee-auth-secret
GEMINI_API_KEY=AIzaSy…
```

> If you see an error about the `tests` table or schema cache, provision your Supabase schema using `docs/supabase-schema/migration-v1.sql` before running the employee learning quiz flows.

---

## 🖥️ Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
# → Open http://localhost:3000

# Type-check
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build
npm start
```

---

## 📦 Deployment

### Docker (recommended for self-hosted)

```bash
docker build -t resume-intelligence .
docker run -p 3000:3000 resume-intelligence
```

The Docker Compose stack (`docker-compose.yml`) provisions PostgreSQL, Redis, and the
application as three linked services for a fully self-contained deployment.

### Vercel / Railway / Render

Deploy as a standard Next.js application. The following environment variables **must**
be set in your hosting provider's dashboard before the first deploy:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## 🔐 Security

| Aspect | Implementation |
|---|---|
| **Database access** | Supabase anon key scoped by Row-Level Security policies |
| **File storage** | Uploaded files are written to the server's local `uploads/` folder |
| **AI processing** | Local heuristic engine — no external model API calls are required |
| **Responsible disclosure** | Upload secrets should not be committed to version control |
| **Network transport** | TLS (HTTPS) enforced by Supabase and any compliant hosting platform |

---

## 🐛 Troubleshooting

**PDF parsing fails:**
- Ensure the PDF is not password-protected
- Use DOCX format for scanned documents (OCR not implemented)

**Processing slow:**
- Files are limited to 10 MB; very large PDFs (~10 MB) take 2–5 s
- Gemini rate limits cause a fallback to the local (slightly faster) heuristic engine

**Scores seem off:**
- The parser may miss sections in complex, multi-column layouts
- Enhancement is rule-based — expect grammatical imperfections

**Clean uploads:**
```bash
rm -rf uploads/*
```

---

## 🧩 Future Enhancements

- [ ] OCR for scanned PDFs (Tesseract.js)
- [ ] Spell checking (Hunspell)
- [ ] Grammar checking (LanguageTool API)
- [ ] Export enhanced resume as PDF
- [ ] Batch processing
- [ ] Industry-specific scoring profiles
- [ ] Redis-backed response cache
- [ ] WebSocket live session for admin dashboard

---

## 📚 Technical Architecture (Source Map)

```
src/
├── app/
│   ├── page.tsx              # Candidate portal — upload → processing → report
│   ├── admin/page.tsx        # Admin dashboard — resume records, session mgmt
│   └── api/
│       ├── upload/route.ts   # Accepts multipart upload, delegates to ResumeService
│       ├── resume/[id]/route.ts          # GET status / DELETE resume
│       ├── resume/[id]/report/route.ts   # GET final report JSON
│       ├── resume/[id]/analyze/route.ts  # POST re-run analysis
│       ├── resume/[id]/enhance/route.ts  # POST re-run enhancement
│       ├── resume/[id]/parse/route.ts    # GET parsed sections
│       ├── resume/[id]/stream/route.ts   # SSE progress stream
│       ├── interview/[id]/questions/route.ts       # GET interview Qs
│       ├── interview/[id]/submit_answer/route.ts   # POST candidate answer
│       ├── interview/attempts/route.ts  # GET all attempts
│       ├── admin/sessions/route.ts      # Session CRUD
│       └── admin/resumes/route.ts       # Resume list / individual CRUD
├── lib/
│   ├── db.ts                 # Supabase client bootstrap
│   ├── local-ai.ts           # *** Core heuristic engine (~710 lines) ***
│   ├── gemini-ai.ts          # Optional Gemini API wrapper (used when API key is set)
│   ├── sse-queue.ts          # In-memory SSE progress queue per resumeId
│   └── utils.ts              # cn(), formatScore(), etc.
├── services/
│   ├── resume-service.ts     # Orchestration: upload → parse → analyze → store
│   ├── session-service.ts    # One-time session-code management
│   └── interview-service.ts  # Question generation + answer evaluation
├── types/
│   └── resume.ts             # ParsedResume, ResumeAnalysis, EnhancedResume, …
└── components/
    ├── ResumeUpload.tsx      # Drag-and-drop + session-code input
    ├── ResumeReport.tsx      # Score cards, radar chart, weakness table
    ├── ProcessingState.tsx   # Progress indicator during analysis
    └── ui/                   # Radix UI primitives (Button, Card, Badge, …)
```

### AI Model Support

| Model | State | Env Var |
|---|---|---|
| Google Gemini (`gemini-2.0-flash`) | **Optional** (falls back silently) | `GEMINI_API_KEY` |
| Local heuristic engine | **Always active** — never removed | None |

When `GEMINI_API_KEY` is set and Gemini is rate-limited, processing transparently falls
back to `src/lib/local-ai.ts` so the user experience is unaffected.

---

## 📜 Historical / Deprecated Migration Notes

### `DEPLOYMENT_GUIDE.md` — DEPRECATED

> ⚠️ **DO NOT FOLLOW**
>
> This document describes a SQLite → `@libsql/client` (Turso) database migration plan that
> was **superseded** before production. The application no longer uses `@libsql/client`,
> Turso, or any local SQLite database. All data is now persisted in **Supabase Postgres**.
> See *Persistence Layer* and *System Architecture* above for the current setup.

### `MIGRATION_COMPLETE.md` — DEPRECATED

> ⚠️ **DO NOT FOLLOW**
>
> This document describes the SQLite3 → LibSQL migration that was completed before the
> project switched to **Supabase Postgres**. It is kept as historical reference only.
> None of the steps described here apply to the current codebase:
>
> - The current `src/lib/db.ts` imports `@supabase/supabase-js`, **not** `@libsql/client`
> - There is no `TURSO_CONNECTION_URL` or `TURSO_AUTH_TOKEN` environment variable
> - There is no `LibSqlDatabase` wrapper class
>
> See the README intro and *Does It Do?* sections (above) for the current architecture.

---

---

## 📄 License

Proprietary — Enterprise License

---

## 🤝 Support

- Check `src/lib/local-ai.ts` for heuristic algorithm details
- View browser DevTools console for errors
- Open a GitHub issue with a sanitised sample resume (redact PII)
