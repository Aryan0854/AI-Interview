# Project Handover & Knowledge Transfer (KT) Documentation

**Project Name:** AI Resume Intelligence & Employee Assessment Platform  
**Repository:** `https://github.com/ics-anand-poc/AI-Interview.git`  
**Document Purpose:** Operational Transition, Knowledge Transfer Ownership & Team Readiness Matrix  
**Date:** July 21, 2026  

---

## Executive Summary

This document serves as the master Knowledge Transfer (KT) and Operational Handover guide for the **AI Resume Intelligence & Employee Assessment Platform**. It outlines the codebase architecture, technical & functional specifications, workflow engines, tools inventory, module ownership, and team readiness matrix required for seamless maintenance and future feature development following the transition.

---

## 1. Codebase Architecture & Structure

The project is built on Next.js (App Router) using standard TypeScript, Vanilla Tailwind CSS, Supabase (PostgreSQL), and integrated AI services (Google Gemini AI & OpenAI).

### Directory Layout

```
├── docs/                             # Architecture & Schema Specifications
│   ├── supabase-schema/              # SQL Migration Scripts (v1, v2, v3, combined)
│   │   ├── combined-migration.sql    # Full 18-table database schema build
│   │   └── seed-curriculum.sql       # Default subjects, topics & question pools
│   ├── SUPABASE_DOCUMENTATION.md     # Detailed Supabase guide & SQL manual entry
│   └── PROJECT_HANDOVER_AND_KT.md    # Master Handover & Transition Document
├── faceproj/                         # Python Facial Biometrics Engine
│   ├── compare_images.py             # Image comparison script (child_process)
│   └── face_match.py                 # Local biometric verification routines
├── src/
│   ├── app/                          # Next.js App Router (Pages & API Endpoints)
│   │   ├── admin/                    # HR Screening Console & Admin Management
│   │   │   ├── page.tsx              # Primary Admin Dashboard (Candidates, Employees, Outbox)
│   │   │   └── resumes/[id]/         # Candidate Screening & AI Response Review
│   │   ├── api/                      # Backend Serverless API Routes
│   │   │   ├── admin/                # Admin Endpoints (Resumes, Employees, Logs, JDs)
│   │   │   ├── employee/             # Employee Portal Endpoints (Tests, Analytics, Results)
│   │   │   └── portal_settings/      # Feature Toggle API
│   │   ├── employee/                 # Employee Learning & Assessment Portal
│   │   │   ├── dashboard/            # Employee Dashboard & Analytics Charts
│   │   │   └── tests/[id]/           # MCQ Test Runner Client & Integrity Proctoring
│   │   ├── layout.tsx                # Global Root Layout & Providers
│   │   └── page.tsx                  # Public Portal Router / Direct Login
│   ├── components/                   # Reusable React UI Components
│   │   ├── ui/                       # UI Primitive Elements (Button, Card, Badge)
│   │   ├── AdminResumeDetails.tsx    # Candidate Deep-Dive Modal Component
│   │   └── ThemeToggle.tsx           # Dark / Light Mode Switcher
│   ├── lib/                          # Core Utilities & Security Libraries
│   │   ├── db.ts                     # Supabase Client Initialization (Client & Server)
│   │   ├── cache-store.ts            # High-Performance In-Memory Cache Store
│   │   ├── employee-auth.ts          # Session Authentication & Token Verification
│   │   ├── gemini-ai.ts              # Google Gemini AI Resume Parsing & Face Verification
│   │   ├── security.ts               # CSRF Protection, Rate Limiting & Magic Byte Checks
│   │   └── structured-logger.ts     # System Audit & Application Logging Service
│   └── services/                     # Business Logic & Data Access Layer
│       ├── resume-service.ts         # Resume Ingestion, Extraction & AI Analysis
│       ├── automation-service.ts     # Automated Candidate Scoring & Job Matching
│       ├── local-tests-db.ts         # High-Availability Local JSON Database Fallback
│       └── session-service.ts        # Candidate & Admin Authentication Sessions
├── uploads/                          # Local Storage Backup & Data Cache
│   ├── local_tests_db.json           # Offline Test & Attempt Backup
│   └── resumes.json                  # Local Resume Cache Backup
└── package.json                      # Node.js Dependencies & Script Definitions
```

---

## 2. Technical Documentation

### Core Technology Stack
- **Framework:** Next.js 16.2 (App Router with Webpack)
- **Frontend Core:** React 18, TypeScript, Tailwind CSS, Framer Motion (Animations), Recharts (Analytics Charts), Lucide React (Icons)
- **Database & Storage:** Supabase (PostgreSQL Database & Storage Buckets) with local JSON fallback engine (`local-tests-db.ts`)
- **AI Processing Engines:**
  - **Google Gemini AI (`@google/generative-ai`):** Candidate resume parsing, suitability categorizing, interview question generation, and audio/video mock answer scoring.
  - **Python Facial Biometrics:** Local Python OpenCV/face-recognition script (`faceproj/compare_images.py`) spawned via Node.js `child_process` for identity verification.
- **Excel & Document Parsing:** `exceljs` (Native `.xlsx` export), `adm-zip` (ZIP batch extraction), `pdf-parse`, `mammoth` (DOCX parsing).

### Security Architecture
- **Dual-Client Supabase Access:**
  - `supabase`: Client-side queries using `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - `supabaseServer`: Admin API operations using secret `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS).
- **Session Authentication:** Token-based validation (`lib/employee-auth.ts`) using sessionStorage tokens (`admin_token`, `employee_token`).
- **Data Protection:** CSRF header check (`checkCsrf`), IP Rate Limiting (`isRateLimited`), File Magic Byte validation (`validateFileSignature`), and Audit Logging (`audit_logs`).

---

## 3. Functional Documentation

The application comprises two core functional portals:

### A. HR Admin Screening & Management Console (`/admin`)
1. **Requirements (BR/JD) Management:** Upload and manage Job Descriptions (JDs) and Business Requirements (BRs).
2. **Bulk CV Ingestion & Parsing:** Upload individual candidate CVs (`.pdf`, `.docx`) or ZIP packages. Automated text extraction, AI scoring, and suitability categorization (*Suitable*, *Non-Suitable*).
3. **Candidate Response & Video Review:** Deep-dive into candidate resume analysis, AI summary, generated interview questions, and proctored video/audio response reviews.
4. **Employee Portal Management:** Centralized tab tracking internal employee test participation, total attempts, average scores, and one-click **Export to Excel (`.xlsx`)** reporting.
5. **Email Outbox Simulation:** Automated email generation and simulated outbound communications log.

### B. Employee Learning & Assessment Portal (`/employee`)
1. **Learning Dashboard (`/employee/dashboard`):** Real-time learning analytics, XP Points tracking, Skill Level badges, Subject Mastery (Radar chart), and Score History trends.
2. **Proctored MCQ Assessment Runner (`/employee/tests/[id]`):**
   - Active webcam capturing and proctoring.
   - Automatic fullscreen lock with warning alerts.
   - Maximum limit enforcement (e.g. 3 warnings triggers auto-submission).
   - Real-time score calculation and database persistence.

---

## 4. Workflows & Automation Engine

```
                                  WORKFLOW MAP
                                  
 [Candidate CV / ZIP] ──► [Bulk Ingestion API] ──► [Gemini AI Engine] ──► [Supabase DB / Resumes]
                                                                                │
 [Proctored Webcam] ──► [MCQ Test Runner] ────► [Test Attempts API] ───────────┤
                                                                                ▼
 [Excel Exporter]   ◄── [Admin Console]    ◄── [In-Memory Cache]  ◄── [Employees & Attempts]
```

### Automation Services
- **Folder Scanner Engine:** Scans `docs/BR` and `docs/RESUMES` directories to auto-ingest new job descriptions and candidate CVs without manual uploads.
- **In-Memory Cache Layer (`lib/cache-store.ts`):** 5-second TTL cache for employee and resume API endpoints. Auto-invalidates instantly upon POST, PUT, or DELETE write operations.

---

## 5. User Management & Authentication Matrix

| Role | Target Portal | Auth Mechanism | Permissions |
| :--- | :--- | :--- | :--- |
| **HR / Admin** | `/admin` | Admin Session Token (`admin_token`) | Full read/write, shortlist candidate, delete resumes, export Excel reports, clear audit logs. |
| **Corporate Employee** | `/employee/dashboard` | Employee Session Token (`employee_token`) | Take MCQ assessments, view personal analytics, view test history, manage profile. |
| **External Candidate** | `/employee?org=BizX` | Candidate Credentials / Auto-Registered | Access assessment portal, take assigned candidate screening tests. |

---

## 6. Tools & Software Inventory

| Software / Tool | Version / Library | Purpose | Hosting / Environment |
| :--- | :--- | :--- | :--- |
| **Next.js** | `16.2.9` | Full-Stack Framework | Vercel / Node.js Server |
| **React** | `18.3.1` | UI Library | Web Browser |
| **Supabase (Postgres)**| `@supabase/supabase-js v2.105` | Primary Relational DB & File Storage | Cloud Supabase Managed Service |
| **Google Gemini AI** | `@google/generative-ai v0.24` | AI Resume Parsing & Scoring | Google Cloud API |
| **Python** | `Python 3.x` | Biometric Facial Comparison | Local Environment (`faceproj/`) |
| **ExcelJS** | `exceljs v4.4.0` | Native `.xlsx` File Exporter | Browser / Client-Side |
| **Adm-Zip** | `adm-zip v0.5.17` | ZIP Package Ingestion | Server-Side |
| **TailwindCSS** | `tailwindcss v3.4.14` | CSS Framework | Client-Side Styling |

---

## 7. Knowledge Transfer (KT) Ownership Matrix

*Note: Team member names are to be assigned during final transition sign-off.*

| Module / System Component | Primary Owner | Secondary / Backup Owner | KT Sign-Off Status | Notes / Key Focus Area |
| :--- | :--- | :--- | :--- | :--- |
| **Candidate Ingestion & AI Engine** | `[Assign Name]` | `[Assign Name]` | `[ ] Pending` | Gemini AI prompt formatting, resume parsing, and hash verification (`resume-service.ts`). |
| **Admin Screening Console UI** | `[Assign Name]` | `[Assign Name]` | `[ ] Pending` | Admin dashboard tabs, Excel exporter (`exceljs`), candidate detail modals (`page.tsx`). |
| **Employee Assessment Portal & MCQ** | `[Assign Name]` | `[Assign Name]` | `[ ] Pending` | Test runner, proctoring warnings, webcam feeds, and submission logic (`TestRunnerClient.tsx`). |
| **Supabase DB & Schema Administration** | `[Assign Name]` | `[Assign Name]` | `[ ] Pending` | Schema migrations, SQL seed scripts, Supabase dashboard table editor, RLS security. |
| **Local Cache & Fallback Architecture** | `[Assign Name]` | `[Assign Name]` | `[ ] Pending` | In-memory cache store (`cache-store.ts`), local JSON DB backup (`local-tests-db.ts`). |
| **Facial Biometrics & Python Integration**| `[Assign Name]` | `[Assign Name]` | `[ ] Pending` | Python script spawning (`compare_images.py`), child process handling in Node.js. |

---

## 8. Team Members & Roles Inventory

*Note: Team member details are to be populated prior to handover completion.*

| Team Member Name | Transition Role | Designated Application Modules | Contact Email | Readiness Status |
| :--- | :--- | :--- | :--- | :--- |
| `[Assign Name]` | Lead Full-Stack Engineer | Admin Dashboard, API Architecture, Gemini AI | `[Email]` | `[ ] Ready` |
| `[Assign Name]` | Frontend Engineer | Employee Portal, Test Runner UI, Recharts | `[Email]` | `[ ] Ready` |
| `[Assign Name]` | Database & Cloud Engineer | Supabase Administration, SQL Migrations, Security | `[Email]` | `[ ] Ready` |
| `[Assign Name]` | QA & Support Specialist | System Verification, Proctoring Validation, User Testing | `[Email]` | `[ ] Ready` |
| `[Assign Name]` | Engineering Manager / Delivery | Project Oversight, Transition Authorization | `[Email]` | `[ ] Ready` |

---

## 9. Operational Readiness & Support Matrix

This checklist evaluates team preparedness to maintain, debug, and enhance the application following transition completion:

| Assessment Category | Evaluation Question | Readiness Criteria | Status | Action Plan / Remediation |
| :--- | :--- | :--- | :--- | :--- |
| **Environment Setup** | Can the team spin up the app locally from scratch? | `npm install` $\rightarrow$ `.env.local` $\rightarrow$ `npm run dev` working cleanly. | `[x] Complete` | Verified typecheck and server startup on local ports. |
| **Database Ops** | Can the team execute schema changes & manual edits? | Familiarity with `docs/SUPABASE_DOCUMENTATION.md` and SQL Editor. | `[x] Complete` | SQL scripts for manual data entry documented & tested. |
| **AI API Key Management** | Can the team update Gemini / OpenAI API credentials? | Knowledge of updating API keys in `.env.local` or environment variables. | `[x] Complete` | Documented in Technical Documentation section. |
| **Bug Fixing & Patching** | Can the team trace Next.js API routes & React state? | Understanding of App Router structure (`app/api/`) and cache store logic. | `[x] Complete` | Code base uses standard TypeScript & modular routes. |
| **Reporting & Exporting** | Can the team modify Excel export columns & formats? | Ability to update `exceljs` column mapping in `admin/page.tsx`. | `[x] Complete` | Native Excel exporter implemented and verified. |
| **Support Readiness** | Is the team ready to take full maintenance ownership? | All KT modules reviewed, sign-off complete, backup owners assigned. | `[ ] Pending` | Final names assignment and sign-off pending transition meeting. |

---

## 10. Transition Sign-Off Authorization

| Authorization Role | Name | Signature | Date |
| :--- | :--- | :--- | :--- |
| **Outgoing Lead / Transitioner** | `[Assign Name]` | `______________________` | `___ / ___ / 2026` |
| **Incoming Lead Owner** | `[Assign Name]` | `______________________` | `___ / ___ / 2026` |
| **Engineering Manager** | `[Assign Name]` | `______________________` | `___ / ___ / 2026` |
