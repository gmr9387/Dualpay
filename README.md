# Claim Clarity — DualPay Core Ledger

> Enterprise healthcare reimbursement intelligence platform that eliminates revenue leakage by automating denial recovery, contract underpayment detection, and claim transparency for healthcare billing operations.

---

## Table of Contents

* [Overview](#overview)
* [Why This Exists](#why-this-exists)
* [Enterprise Highlights](#enterprise-highlights)
* [Key Features](#key-features)
* [Architecture](#architecture)
* [Technology Stack](#technology-stack)
* [Project Structure](#project-structure)
* [Core Workflows](#core-workflows)
* [Security](#security)
* [Database Design](#database-design)
* [API Overview](#api-overview)
* [Installation](#installation)
* [Configuration](#configuration)
* [Testing](#testing)
* [Deployment](#deployment)
* [Performance](#performance)
* [Roadmap](#roadmap)
* [Documentation](#documentation)
* [Screenshots](#screenshots)
* [Contributing](#contributing)
* [License](#license)
* [Author](#author)
* [Acknowledgements](#acknowledgements)

---

# Overview

Claim Clarity is a production-grade healthcare reimbursement intelligence platform built for denial recovery and revenue protection. It serves healthcare billing managers, revenue cycle teams, and executives who need to understand where money is stuck, why it was denied or underpaid, who is responsible for recovering it, and how much has actually been returned.

The platform ingests claims and remittance data (CSV or native X12 EDI 835/837), runs deterministic adjudication and Coordination of Benefits (COB) logic, identifies recoverable denials and contract underpayments, orchestrates recovery workflows, and surfaces every outcome in real-time executive dashboards — with a complete audit trail linking every dollar of recovered revenue back to the original claim, engine decision, and team action.

Claim Clarity is the commercial wedge of the **Valtaris** ecosystem, supported by Cloud (tenancy/security/audit), Glue (workflow runtime), Core (COB/adjudication), and Weaver (context intelligence).

---

# Why This Exists

## Business Problem

Healthcare providers lose an estimated 3–5% of annual revenue to unpaid, underpaid, or incorrectly denied claims. Billing teams lack the tools to systematically identify which denials are recoverable, which payers are consistently underpaying against contracted rates, and whether appeal efforts are generating a measurable return. Without unified visibility, revenue leaks silently and consistently.

## Technical Challenge

Healthcare reimbursement involves layered complexity: COB primacy rules across multiple payers, CARC/RARC denial reason codes with hundreds of permutations, contract fee schedules with multiple reimbursement methods, X12 EDI transaction formats, multi-tenant data isolation requirements, and strict HIPAA considerations for PHI handling. Building reliable automation on top of this requires deterministic engines, idempotent execution, and an immutable audit trail — not heuristics or black-box ML.

## Solution

Claim Clarity solves this by providing a fully deterministic intelligence stack:

- **Denial Intelligence** classifies every denial by recoverability, severity, and required evidence using CARC/RARC codes.
- **Contract Intelligence** matches claims to payer contracts and computes exact expected reimbursement to detect underpayments to the cent.
- **Autonomous Recovery Pipeline** chains these engines into an orchestrated job pipeline that runs server-side without requiring browser sessions.
- **Executive Value Realization** attributes every recovered dollar to its category, payer, playbook, and team member — with deterministic narrative generation.
- **Complete Audit Trail** ensures every metric, decision, and action is traceable to persisted rows; no fabricated numbers.

---

# Enterprise Highlights

* **Multi-tenant architecture** — every table is org-scoped with `org_id NOT NULL`; complete data isolation between organizations
* **Row-Level Security (RLS)** — Postgres RLS policies enforce org membership on every operational table; no globally permissive policies
* **Role-Based Access Control (RBAC)** — five-tier role hierarchy (viewer → analyst → manager → admin → owner) with granular UI and API enforcement
* **Immutable audit logging** — `ops_events` is append-only; every workflow action, job execution, document upload, and audit export is permanently recorded
* **Idempotent execution** — payment state transitions require unique idempotency keys; contract recovery jobs use deduplicate keys to prevent double-processing
* **Durable workflow execution** — server-side edge worker pipeline for contract recovery, remittance analysis, and dispute generation; jobs survive browser session termination
* **Retry and recovery mechanisms** — dead-letter queue captures failed jobs with full error context for inspection and retry without data loss
* **Queue-based processing** — work queues with priority assignment, SLA tracking, and worklist management per analyst
* **Event-driven architecture** — every state transition, workflow action, and pipeline step emits typed `ops_events` with actor, org, payload, and timestamp
* **Deterministic intelligence engines** — all adjudication, COB, denial scoring, and contract math is rule-based and reproducible; no ML or fabricated outputs
* **RESTful APIs** — PostgREST auto-generated REST endpoints over all operational tables, scoped by JWT and RLS
* **Real-time dashboards** — executive command center, payer scorecards, playbook effectiveness, and recovery attribution dashboards
* **Structured observability** — every engine decision and job execution emits typed `ops_events` with actor, org, payload, and timestamp
* **Production-ready infrastructure** — SECURITY DEFINER functions restricted to `authenticated`; `PUBLIC`/`anon` execute rights revoked across all helpers
* **Scalable cloud deployment** — Supabase Edge Functions scale to zero and spin up on demand; idempotent job execution allows safe parallel invocation
* **SOC 2 aligned security practices** — immutable audit log, least-privilege access, no anonymous data access, org-scoped data isolation
* **HIPAA-ready architecture** — PHI handling, access controls, audit logging, and incident response plans documented in `docs/`
* **X12 EDI native processing** — parse, validate, and normalize 835/837P/837I transactions without intermediate CSV conversion
* **Replay-verifiable adjudication** — every adjudication run is fingerprinted with canonical JSON + SHA-256; results are deterministically reproducible

---

# Key Features

## Core Capabilities

* **Claim adjudication** — fee schedule application, deductible/coinsurance accumulation, cross-line accumulator tracking, and full COB allocation across four policy types (Standard, Non-Duplication, Carve-Out, Maintenance of Benefits)
* **COB Rules Engine** — timezone-safe birthday rule, length-of-coverage rule, primacy output validation, largest-remainder multi-payer rounding (exact cent accuracy)
* **CARC/RARC Denial Intelligence** — denial classification, recoverability scoring, severity scoring, evidence requirements, and next-best-action recommendations per denial reason code
* **Contract Underpayment Detection** — matches claims to payer contracts (fixed / case / per-diem / percent-of-billed / percent-of-Medicare) and detects variance to the cent
* **X12 EDI Gateway** — native ingestion of 835, 837P, and 837I transactions with structural validation, envelope integrity checks, and canonical normalization
* **Remittance Lineage** — end-to-end traceability from every imported remittance row through claims, underpayments, disputes, cases, and outcomes
* **Appeal Packet Generator** — deterministic Markdown appeal packets with claim details, denial context, evidence checklist, and readiness gate

## Administrative Features

* **Admin Console** — org-level KPIs (members, audit events, exports, stored documents), RLS policy inventory, and audit export configuration
* **PHI-Safe Audit Export** — CSV or JSON export in Full (admin/owner) or Redacted (manager+) mode; every export permanently logged
* **Security Inventory** — browsable RLS policy list and SECURITY DEFINER helper inventory at `/admin/security`
* **Role-Aware UI** — controls hidden (not just disabled) for unauthorized roles; `RequireRole` guards protect admin routes

## Automation

* **Autonomous Recovery Pipeline** — seven-step orchestrated job chain (remittance analysis → contract matching → underpayment detection → dispute generation → case generation → queue assignment → executive recalculation)
* **Automation Rules Engine** — configurable triggers (`underpayment_threshold`, `sla_risk`, `evidence_stale`, `denial_severity`, `repeat_payer_issue`) with automatic case creation, manager assignment, and escalation actions
* **Server-Side Contract Recovery** — edge worker pipeline that discovers underpayment candidates, matches contracts, computes variance, and writes idempotent dispute records without browser involvement

## Reporting

* **Executive Value Realization** — at-risk vs recovered breakdown, expected future recovery, monthly/category/payer narrative (deterministic; "Insufficient Outcome History" returned for slices with fewer than 5 outcomes)
* **Recovery Attribution** — attribute every recovered dollar to category, payer, playbook, owner, and resolution action
* **Payer Scorecards** — denial rate, underpayment rate, recovery rate, appeal success, and top failure categories per payer
* **Playbook Effectiveness** — rank playbooks by recovery rate, total dollars, resolution time, and appeal success rate
* **Recovery Intelligence Dashboard** — SLA status, escalation tracking, workload management, and payer operations

---

# Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                  │
│  Command Center · Denial Intelligence · Claims Workbench    │
│  Evidence Vault · Executive Dashboards · EDI Gateway        │
│  Automation Center · Admin Console · Recovery Factory       │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / Supabase JS SDK
┌────────────────────────▼────────────────────────────────────┐
│                    Supabase Platform                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │  PostgreSQL  │  │ Edge Functions│  │  Storage Buckets  │ │
│  │  + RLS       │  │ (Deno/TS)    │  │  evidence-docs    │ │
│  │  + Triggers  │  │              │  │  appeal-packets   │ │
│  └──────────────┘  │ worker-      │  └───────────────────┘ │
│                    │ dispatcher   │                         │
│  ┌──────────────┐  │ scheduler-   │  ┌───────────────────┐ │
│  │  Supabase    │  │ dispatcher   │  │  Supabase Auth    │ │
│  │  Auth        │  │ invite-member│  │  (JWT / RLS)      │ │
│  └──────────────┘  └──────────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│              Deterministic Intelligence Engines             │
│  (TypeScript — runs in browser and mirrored in workers)     │
│                                                             │
│  calculation-engine  │  cob-rules       │  denial-intel     │
│  contract-match      │  dispute-gen     │  job-runner       │
│  x12-parser          │  edi-normalizer  │  pipeline-orch    │
│  value-realization   │  payer-perf      │  appeal-packet    │
└─────────────────────────────────────────────────────────────┘
```

---

## System Components

### Frontend

React 18 single-page application with TypeScript, Vite, Tailwind CSS v3, and shadcn/ui components. All intelligence engines are TypeScript modules that run in the browser for interactive exploration; the same logic is mirrored server-side in edge workers for durable execution. React Query manages server state and cache invalidation. React Router v6 handles 70+ routes across the platform.

### Backend

Supabase (hosted Postgres + PostgREST + Auth + Storage + Edge Functions). All data access goes through the Supabase JS SDK using the authenticated user's JWT; RLS policies enforce org-level isolation at the database layer. Three edge functions handle durable work: `worker-dispatcher` (job execution), `scheduler-dispatcher` (scheduled triggers), and `invite-member` (org invitation flow).

### Database

PostgreSQL with 30+ operational tables, all `org_id NOT NULL`, protected by org-scoped RLS policies. SECURITY DEFINER helper functions (`is_org_member`, `has_org_role`, `current_org_id`) are restricted to `authenticated` role. Triggers maintain `updated_at` timestamps and handle new-user org creation automatically.

### Authentication

Supabase Auth with email/password. JWTs are automatically included in all SDK requests; RLS policies evaluate `auth.uid()` against `organization_members` to enforce org membership. The `handle_new_user_org` trigger creates a personal organization for every new signup. MFA tracking columns are present in schema; TOTP enforcement is a roadmap item.

### Storage

Two private Supabase Storage buckets: `evidence-documents` (uploaded claim evidence — PDF, PNG, JPG, DOCX, XLSX) and `appeal-packets` (generated appeal packet snapshots). Storage RLS is keyed off the first path segment (`org_id`). Files are never overwritten; re-uploads auto-increment a version counter and preserve parent links.

### AI Services

No third-party AI services are used in the current release. All intelligence — adjudication, COB allocation, denial scoring, contract matching, and value attribution — is performed by deterministic TypeScript engines with explicit rule logic. This ensures reproducibility, auditability, and HIPAA-safe operation without sending PHI to external AI providers. AI-assisted automation is on the future roadmap.

### Background Workers

Three Supabase Edge Functions (Deno + TypeScript): `worker-dispatcher` executes durable jobs (remittance analysis, contract recovery, dispute generation, case generation, queue assignment, executive recalculation); `scheduler-dispatcher` handles time-based triggers; `invite-member` manages org invitations. Workers emit typed `ops_events` on every significant state change.

### Integrations

Native X12 EDI processing (835, 837P, 837I) via `x12-parser.ts`, `edi-validator.ts`, and `edi-normalizer.ts`. XLSX export via the `xlsx` library. PDF generation via `jsPDF`. Future: direct payer API integrations for 270/271 eligibility and 276/277 claim status.

---

## Data Flow

```
1. Claim Ingestion
   CSV upload / X12 EDI paste → Recovery Factory / EDI Gateway
   → row validation → field mapping → commitBatch()
   → claims + remittance_lines + claim_source_links + lineage_events persisted

2. Adjudication
   Claim selected → calculation-engine (fee schedule → deductible → COB)
   → state-machine transition (RECEIVED → ADJUDICATED)
   → adjudication_run + trace + replay_record persisted
   → ops_events: adjudication_completed

3. Denial Intelligence
   Adjudicated claim → denial-intelligence (CARC/RARC classification)
   → recoverability score + severity + evidence requirements
   → next-action recommendations → playbook assignment
   → ops_events: denial_classified

4. Recovery Workflow
   Analyst opens claim → assignment created (priority + due date)
   → appeal submitted → evidence uploaded to vault
   → appeal packet generated → outcome recorded
   → ops_events: assignment_created, appeal_submitted, outcome_recorded

5. Contract Recovery (Server-Side)
   job: contract_recovery_analysis dispatched to worker-dispatcher
   → load contracts + fee schedules → discover candidates from claims
   → contract-match → contract-underpayment → variance detected
   → underpayment_disputes written (idempotent dedupe_key)
   → ops_events: underpayment_detected, dispute_created

6. Executive Attribution
   Executive dashboard loads → value-realization aggregates
   recovery_outcomes + underpayment_disputes → attribute to payer/playbook/owner
   → deterministic narrative generated
   → insufficient: true returned for slices < 5 outcomes
```

---

# Technology Stack

## Frontend

* **React 18** — component model and concurrent rendering
* **TypeScript 5** — strict typing across all engines and UI
* **Vite 5** — fast dev server and optimized production builds
* **Tailwind CSS v3** — utility-first styling
* **shadcn/ui** — accessible component primitives (Radix UI)
* **React Router v6** — client-side routing (70+ routes)
* **TanStack Query v5** — server state, caching, background refetch
* **Recharts** — data visualization for dashboards
* **React Hook Form + Zod** — form management and schema validation
* **jsPDF** — client-side PDF generation for appeal packets
* **xlsx** — spreadsheet export

## Backend

* **Supabase** — hosted Postgres, Auth, Storage, Edge Functions, PostgREST
* **PostgreSQL** — relational database with RLS, triggers, SECURITY DEFINER functions
* **Deno (Edge Functions)** — worker-dispatcher, scheduler-dispatcher, invite-member
* **Supabase JS SDK v2** — browser client with automatic JWT injection

## Infrastructure

* **Supabase Cloud** — managed Postgres + Auth + Storage + Edge runtime
* **Supabase Storage** — private object storage for evidence and appeal packets
* **Supabase Auth** — JWT-based authentication with org-scoped RLS

## AI

* No external AI services in current release — all intelligence is deterministic TypeScript
* Future roadmap: AI-assisted denial pattern analysis and appeal recommendation

## DevOps

* **GitHub** — source control and PR workflow
* **Vitest** — unit and integration test runner
* **ESLint** — static analysis and code quality
* **Bun / npm** — package management

---

# Project Structure

```text
dualpay-core-ledger/
│
├── src/
│   ├── engine/                    # Deterministic intelligence engines (50+)
│   ├── pages/                     # Route-level page components (70+)
│   ├── components/                # Shared UI components
│   ├── hooks/                     # React Query data hooks
│   ├── data/                      # Repository functions (DB access)
│   ├── lib/                       # Shared utilities
│   ├── types/                     # Shared TypeScript types
│   ├── integrations/              # Supabase client + generated types
│   └── test/                      # Vitest test files
│
├── supabase/
│   ├── migrations/                # Ordered SQL migration files
│   └── functions/                 # Edge Functions (Deno)
│       ├── worker-dispatcher/
│       ├── scheduler-dispatcher/
│       └── invite-member/
│
├── docs/
│   ├── SECURITY.md
│   ├── HIPAA_OVERVIEW.md
│   ├── ACCESS_CONTROL_POLICY.md
│   ├── DATA_CLASSIFICATION.md
│   ├── INCIDENT_RESPONSE_PLAN.md
│   └── RISK_REGISTER.md
│
├── public/
├── DEV_SETUP.md
├── HARDENING_PR_SUMMARY.md
├── PATCH_REPORT_PHASE1.md
├── PHASE_3A_SUMMARY.md
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

# Core Workflows

## Claim Denial Recovery

**Purpose:** Guide a billing analyst from a received denial to a recovered payment, with every step audited.

**Process:**
1. Claim imported via Recovery Factory (CSV) or EDI Gateway (X12 835/837)
2. Adjudication engine computes allowed amounts, applies COB rules, and flags the denial reason (CARC/RARC)
3. Denial Intelligence scores recoverability and severity; next-action engine recommends the optimal playbook
4. Analyst is assigned the claim with a priority level and due date via the operational workflow layer
5. Evidence uploaded to the Evidence Vault; readiness engine checks completeness against required documents
6. Appeal packet generated with deterministic Markdown including claim details, denial context, evidence inventory, and recovery opportunity
7. Appeal submitted; lifecycle events (`appeal_submitted`, `appeal_responded`, `appeal_resolved`) appended to `ops_events`
8. Recovery outcome recorded; executive attribution engine maps the recovered dollars to payer, playbook, and owner

**Expected Result:** Recovered payment with full audit trail from denial event to outcome, linked to the responsible analyst and the playbook that drove recovery.

---

## Contract Underpayment Detection & Dispute

**Purpose:** Automatically identify claims paid below contracted rates and generate formal dispute records.

**Process:**
1. Recovery pipeline job `contract_recovery_analysis` dispatched to `worker-dispatcher` edge function
2. Worker loads org-scoped `payer_contracts` and `fee_schedules`
3. Candidate claims discovered from `remittance_lines` (preferred) or `claims.payload.intel.payer_responses`
4. `contract-match` engine selects the applicable contract version by payer, effective date, and service type
5. `contract-underpayment` engine computes expected reimbursement using the contract method (fixed, case, per-diem, percent-of-billed, percent-of-Medicare) and calculates variance
6. `underpayment_disputes` row inserted with a deterministic `dedupe_key` (`claim_id|contract_id|variance_amount_cents|service_date`); duplicate runs are safely skipped by unique index
7. Dispute appears in Contract Disputes dashboard; analyst reviews and initiates formal dispute process
8. Lineage event `underpayment_detected` links the dispute back to the originating remittance line

**Expected Result:** Complete, idempotent set of underpayment disputes with contract-level evidence, ready for formal payer submission.

---

## Autonomous Recovery Pipeline

**Purpose:** Run the full denial-to-recovery workflow automatically for all eligible claims in one orchestrated execution, without manual claim-by-claim intervention.

**Process:**
1. User clicks "Run Recovery Pipeline" in Automation Center or pipeline is triggered by an automation rule
2. `pipeline-orchestrator` creates a shared `pipeline_id` and chains seven jobs sequentially: `remittance_analysis` → `contract_matching` → `underpayment_detection` → `dispute_generation` → `recovery_case_generation` → `queue_assignment` → `executive_recalculation`
3. Each job reads existing persisted state from Supabase, executes the corresponding deterministic engine, and writes results back
4. `auto-case-generator` creates `cases` + initial `case_events` for detected recovery opportunities
5. `automation-rules` evaluates configured triggers (SLA risk, denial severity, repeat payer issues) and fires actions (auto-assign manager, escalate)
6. Pipeline run recorded in `automation_jobs` with per-step status, record counts, and recovery value; every state change appended to `ops_events`

**Expected Result:** All recoverable claims processed, cases opened, queues populated, and executive metrics refreshed in a single audited pipeline execution.

---

# Security

## Authentication

Supabase Auth with email/password. JWTs are short-lived and automatically refreshed by the Supabase JS SDK. All API requests include the user JWT; the Postgres `auth.uid()` function resolves the identity for RLS enforcement. `handle_new_user_org` trigger auto-provisions a personal organization for every new user.

## Authorization

Five-tier RBAC: `viewer` (read-only), `analyst` (read + write + assign), `manager` (analyst + delete + escalate + redacted exports), `admin` (manager + org settings + security console + full exports), `owner` (admin + delete organization). Roles are stored in `organization_members.role` and enforced at three layers: Postgres RLS policies, SECURITY DEFINER helper functions, and React UI guards (`RequireRole` component, `role-permissions.ts`). UI controls are hidden — not just disabled — for unauthorized roles.

## Data Protection

All data is stored in Supabase's hosted Postgres with `org_id NOT NULL` on every operational table. Storage objects are in private buckets with RLS keyed off `org_id`. PHI identifiers are stripped from redacted audit exports. SECURITY DEFINER functions (`is_org_member`, `has_org_role`, `current_org_id`) have EXECUTE revoked from `PUBLIC` and `anon` — callable only by `authenticated` sessions.

## Audit Logging

`ops_events` is an append-only table (no UPDATE or DELETE RLS policy). Every workflow action, job execution, document upload, state transition, pipeline run, and audit export is permanently recorded with actor ID, org ID, event kind, payload, and timestamp. Audit exports themselves emit `audit_export_requested` and `audit_export_completed` events. See `docs/ACCESS_CONTROL_POLICY.md` for the full access control audit framework.

## Input Validation

All import rows are validated by `import-validation.ts` before ingestion. X12 EDI input is validated by `edi-validator.ts` (envelope integrity, control-number matching, segment-count balancing). Form inputs use Zod schemas via React Hook Form. Unknown COB policy types throw explicit errors (fail-fast) rather than silently applying wrong values.

## Error Handling

Intelligence engines throw typed errors with descriptive messages. Failed automation jobs are captured by the dead-letter queue (`dead-letter-queue.ts`) with retry tracking. Import exceptions are preserved with full error context and can be corrected and retried. Pipeline failures are recorded in `automation_jobs` with result JSON including error details.

## Compliance

HIPAA-ready architecture with documented PHI handling, access controls, audit logging, and incident response plan. See `docs/HIPAA_OVERVIEW.md`, `docs/INCIDENT_RESPONSE_PLAN.md`, `docs/DATA_CLASSIFICATION.md`, and `docs/RISK_REGISTER.md`. SOC 2-aligned practices: immutable audit log, least-privilege access, no anonymous data access, org-scoped data isolation.

---

# Database Design

## Overview

PostgreSQL hosted on Supabase with 30+ tables organized into functional domains. Every operational table carries `org_id NOT NULL` with a foreign key to `organizations`, enforcing multi-tenant isolation at the schema level. Postgres RLS policies use SECURITY DEFINER helper functions to gate all reads and writes by org membership and role. Migrations are applied in sequence from `supabase/migrations/`.

## Core Tables

| Domain | Tables |
|--------|--------|
| **Claims & Adjudication** | `claims`, `member_accumulators`, `adjudication_runs`, `traces` |
| **Replay & Idempotency** | `replay_records`, `replay_ledger_events`, `idempotency_keys` |
| **Ops & Cases** | `ops_events`, `cases`, `case_claim_links`, `case_events`, `claim_assignments`, `recovery_outcomes` |
| **Recovery Factory** | `import_batches`, `import_exceptions`, `field_mappings`, `remittance_batches` |
| **Evidence** | `evidence_documents` |
| **Contracts** | `payer_contracts`, `fee_schedules`, `underpayment_disputes` |
| **Automation** | `automation_jobs`, `automation_rules` |
| **EDI** | `edi_transactions`, `edi_segments`, `edi_errors` |
| **Lineage** | `remittance_lines`, `claim_source_links`, `recovery_lineage_events` |
| **Identity** | `organizations`, `organization_members` |

## Relationships

- `claims` → `member_accumulators` (member/plan year accumulation)
- `claims` → `adjudication_runs` → `traces` (full adjudication audit chain)
- `cases` → `case_claim_links` → `claims` (many-to-many via link table)
- `ops_events` references `claim_id` and `case_id` (append-only event log)
- `evidence_documents` → `parent_document_id` (self-referential versioning)
- `underpayment_disputes` → `remittance_line_id` (lineage traceability)
- `recovery_lineage_events` links any row across domains via polymorphic `entity_id` + `entity_type`
- `organization_members` → `organizations` + `auth.users` (RBAC join)

## Indexing Strategy

- `org_id` indexes on every operational table for RLS-aligned filtered scans
- `(org_id, claim_id)` composite indexes on high-join tables (ops_events, assignments, outcomes)
- `(org_id, dedupe_key)` unique index on `underpayment_disputes` for idempotent contract recovery
- `assigned_to_user_id`, `due_date`, `priority`, `(status, priority DESC)` indexes on `claim_assignments` for worklist queries
- `assigned_at DESC` index for recent-assignment queries

---

# API Overview

## Authentication

All requests require a Supabase JWT (`Authorization: ****** Tokens are obtained via `supabase.auth.signInWithPassword()` or `supabase.auth.signUp()`. RLS policies evaluate `auth.uid()` server-side; no client-supplied `org_id` or `user_id` is trusted for access decisions.

## Primary Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /rest/v1/claims` | List org-scoped claims (RLS filtered) |
| `GET /rest/v1/ops_events` | Audit event stream |
| `GET /rest/v1/cases` | Recovery cases |
| `GET /rest/v1/recovery_outcomes` | Recorded outcomes |
| `GET /rest/v1/evidence_documents` | Evidence file metadata |
| `GET /rest/v1/payer_contracts` | Contract records |
| `GET /rest/v1/underpayment_disputes` | Contract dispute records |
| `GET /rest/v1/automation_jobs` | Job execution history |
| `GET /rest/v1/edi_transactions` | Parsed EDI transactions |
| `GET /rest/v1/remittance_lines` | Remittance line items |
| `POST /functions/v1/worker-dispatcher` | Dispatch durable jobs |
| `POST /functions/v1/invite-member` | Invite user to org |

## Response Format

PostgREST returns JSON arrays with column selection, filtering (`?column=eq.value`), ordering, and pagination via standard PostgREST query parameters. Edge functions return `{ ok: boolean, data?: any, error?: string }`. All responses are org-scoped; cross-org data access returns empty results rather than errors.

---

# Installation

## Prerequisites

* Node.js 18+ or Bun
* A Supabase project (cloud or local CLI)
* Supabase URL and anon key

## Clone Repository

```bash
git clone https://github.com/gmr9387/dualpay-core-ledger.git
cd dualpay-core-ledger
```

## Install Dependencies

```bash
npm install
```

## Configure Environment

Create a `.env` file at the project root and add the required environment variables:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_DEMO_MODE=true
```

## Apply Database Migrations

```bash
supabase db push
# or for local development:
supabase start
supabase db reset
```

## Start Development Server

```bash
npm run dev
# App available at http://localhost:5173
```

## Create a Dev User (Demo Mode)

In the browser console after the app loads:

```javascript
import { ensureDevUser } from '@/lib/dev-auth-helper';
await ensureDevUser('dev@example.com', 'devpassword123', 'analyst');
```

Then sign in with those credentials. See `DEV_SETUP.md` for full details.

---

# Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (public, safe for browser) |
| `VITE_DEMO_MODE` | Optional | `true` to auto-seed Demo Organization + sample data on first load |

**Edge Function secrets** (set in Supabase dashboard → Edge Functions → Secrets):

| Secret | Description |
|--------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for worker-dispatcher privileged writes |
| `SUPABASE_URL` | Project URL available inside edge functions |

No secrets are committed to source control. The `.env` file is in `.gitignore`.

---

# Testing

## Unit Tests

Engine logic is tested with Vitest. Run the full suite:

```bash
npm run test
```

Key test files:

| File | Coverage |
|------|---------|
| `src/test/cob-rules.test.ts` | 50+ tests — birthday rule, COB allocation policies, primacy validation, rounding |
| `src/test/calculation-engine.test.ts` | 32 tests — adjudication math, deductible, coinsurance, multi-payer COB |
| `src/test/state-machine.test.ts` | 23 tests — idempotency keys, payment transitions, COB primacy confirmation |
| `src/data/__tests__/operational-workflows.test.ts` | 40+ tests — assignment, notes, worklist, timeline, RLS scoping |

## Integration Tests

Workflow integration tests verify that repository functions correctly scope queries to `org_id` and that RLS policies are not bypassed. Run with the same `npm run test` command.

## Manual Testing

After applying migrations and creating a dev user (see Installation), verify:
- Claims visible on `/platform` or `/claims`
- Adjudication executes and writes `adjudication_runs` row
- Duplicate fingerprint does not create a new `replay_record`
- Idempotency key blocks duplicate payment transitions
- Evidence upload creates `evidence_documents` row and storage object
- Automation job completes and appears in `/automation/jobs`

## Performance Testing

Run with coverage to inspect branch and line coverage on critical path engines:

```bash
npm run test -- --coverage
# Target: src/engine/cob-rules.ts at 100% lines/branches/functions
```

---

# Deployment

## Development

```bash
npm run dev          # Vite dev server with HMR at localhost:5173
supabase start       # Local Supabase stack (Docker)
```

## Staging

```bash
npm run build        # Production build in dist/
npm run preview      # Preview production build locally
supabase db push --linked  # Push migrations to linked project
```

## Production

1. Connect repository to Supabase project (linked project)
2. Apply all migrations: `supabase db push`
3. Deploy edge functions: `supabase functions deploy worker-dispatcher scheduler-dispatcher invite-member`
4. Build and deploy the React SPA to your static hosting provider (Vercel, Netlify, Cloudflare Pages, etc.)
5. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in your hosting provider
6. Set `SUPABASE_SERVICE_ROLE_KEY` as an edge function secret in the Supabase dashboard
7. Set `VITE_DEMO_MODE=false` (or omit) for production — `seedIfEmpty()` becomes a no-op

### Rollout Checklist

- [ ] Migrations applied cleanly (`supabase db push`)
- [ ] Edge functions deployed and secrets set
- [ ] RLS policies verified in `/admin/security`
- [ ] Demo mode disabled (`VITE_DEMO_MODE` unset)
- [ ] Smoke test: sign up, create org, import a claim, run adjudication
- [ ] Monitor `ops_events` for unexpected error kinds

---

# Performance

## Optimization

All intelligence engines are pure TypeScript functions with no external I/O — they execute in microseconds in the browser. Database queries are scoped by `org_id` on indexed columns, keeping result sets small. PostgREST column selection (`?select=col1,col2`) is used throughout to avoid over-fetching.

## Caching

TanStack Query caches all server state with configurable `staleTime` and `gcTime`. Claim lists, org metadata, and contract data are cached and refetched in the background. Executive metrics are aggregated on read; a future phase will add materialized views for high-cardinality dashboards.

## Background Processing

Long-running operations (contract recovery, pipeline execution) are dispatched to Supabase Edge Functions via the `worker-dispatcher`. This removes them from the browser event loop entirely. The dead-letter queue captures failed jobs for inspection and retry without data loss.

## Scalability

- Multi-tenant data isolation via `org_id` allows horizontal scaling without query interference between organizations
- Idempotent job execution (`dedupe_key` unique index) allows safe parallel invocation
- Edge Functions scale to zero and spin up on demand (Supabase-managed)
- Storage objects in private buckets scale independently of the database

---

# Roadmap

## Current Release

- ✅ Core adjudication engine with COB (all four policy types, hardened)
- ✅ CARC/RARC denial intelligence with next-action and playbook recommendations
- ✅ Contract intelligence — import, match, underpayment detection, dispute generation
- ✅ Server-side contract recovery with idempotent dispute writes
- ✅ Autonomous recovery pipeline (7-step orchestrated job chain)
- ✅ X12 EDI Gateway — 835, 837P, 837I parse, validate, normalize
- ✅ Remittance lineage (row → claim → dispute → case → outcome)
- ✅ Evidence Vault with versioning and appeal packet generator
- ✅ Executive Intelligence — value realization, payer scorecards, playbook effectiveness
- ✅ Identity & RBAC with org-scoped RLS
- ✅ Production hardening — NOT NULL org_id, tightened RLS, PHI-safe audit export
- ✅ Operational workflows — assignment, worklist, appeal lifecycle, recovery events

## Next Release

- [ ] **EDI auto-promote** — wire normalized 835/837 output into `remittance_batches` / `claims` rows automatically
- [ ] **Idempotency key persistence** — persist in-memory idempotency keys to Supabase to survive page reloads
- [ ] **Automation rule config editor** — in-app UI for editing rule thresholds and actions
- [ ] **Lineage completion** — emit `case_created`, `outcome_recorded`, and `executive_value_attributed` lineage events
- [ ] **TypeScript strict mode** — enable `noImplicitAny` and `strictNullChecks`
- [ ] **Background scheduler** — replace synchronous browser-triggered pipelines with cron-based scheduled execution

## Future Vision

- Real-time SLA alerting with push notifications for breach risk
- Direct payer API integrations for 270/271 eligibility and 276/277 claim status queries
- Bulk dispute packet transmission to payers
- SNIP-2/3 payer-business EDI validation and 270/271/277/278/999/TA1 normalizers
- Multi-org hierarchy (holding company / health system model)
- Observability stack (metrics, distributed tracing, alerting, error budgets)
- SSO, TOTP MFA, and password rotation policies
- Materialized views for executive dashboard performance at scale
- AI-assisted denial pattern analysis and appeal recommendation

---

# Documentation

| Document | Description |
|----------|-------------|
| `DEV_SETUP.md` | Development environment setup, dev user creation, RLS troubleshooting, role hierarchy |
| `docs/SECURITY.md` | Security architecture, threat model, and controls |
| `docs/HIPAA_OVERVIEW.md` | HIPAA applicability, PHI handling, safeguards |
| `docs/ACCESS_CONTROL_POLICY.md` | RBAC model, RLS policy inventory, access audit framework |
| `docs/DATA_CLASSIFICATION.md` | Data sensitivity tiers and handling requirements |
| `docs/INCIDENT_RESPONSE_PLAN.md` | Security incident detection, containment, and notification procedures |
| `docs/RISK_REGISTER.md` | Known risks, likelihood, impact, and mitigation status |
| `HARDENING_PR_SUMMARY.md` | COB Rules Engine hardening PR — bugs fixed, test coverage, breaking changes |
| `PATCH_REPORT_PHASE1.md` | Phase 1 patch report — MOB COB fix, idempotency tests, remaining risks |
| `PHASE_3A_SUMMARY.md` | Phase 3A operational workflow foundation — schema, functions, tests |

---

# Screenshots

> Add screenshots, diagrams, dashboards, or workflow illustrations.

---

# Contributing

1. **Branch strategy** — feature branches off `main` using `feat/`, `fix/`, `docs/`, `chore/` prefixes
2. **Coding conventions** — TypeScript throughout; no `any` in engine files; Zod for all external data shapes
3. **Do not duplicate engines** — extend existing intelligence; never copy logic from one engine to another
4. **Test coverage** — all engine changes require corresponding Vitest tests; target 100% coverage on critical path files
5. **Audit trail** — new workflow actions must emit a typed `ops_events` kind
6. **RLS discipline** — new tables must include `org_id NOT NULL` with a corresponding RLS policy; no globally permissive policies
7. **Pull requests** — include a summary of what changed, what was reused, remaining limitations, and typecheck status (`tsc --noEmit`)
8. **Breaking changes** — document explicitly; COB policy type errors are an example of an intentional breaking change that was previously a silent failure

---

# License

Proprietary. All rights reserved. © 2026 Valtaris Technologies.

---

# Author

**George Rios**

Founder & Software Engineer

**Valtaris Technologies**

---

# Acknowledgements

- [Supabase](https://supabase.com) — Postgres, Auth, Storage, and Edge Functions platform
- [React](https://react.dev) — UI component model
- [Vite](https://vitejs.dev) — build tooling
- [Tailwind CSS](https://tailwindcss.com) — utility-first CSS
- [shadcn/ui](https://ui.shadcn.com) — accessible component primitives built on Radix UI
- [TanStack Query](https://tanstack.com/query) — server state management
- [Recharts](https://recharts.org) — composable charting library
- [Zod](https://zod.dev) — TypeScript-first schema validation
- [Vitest](https://vitest.dev) — fast unit testing powered by Vite
- [jsPDF](https://github.com/parallax/jsPDF) — client-side PDF generation
- [xlsx](https://github.com/SheetJS/sheetjs) — spreadsheet parsing and export
- The X12 Standards organization for healthcare EDI transaction specifications
