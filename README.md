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
* **Durable job orchestration** — server-side edge worker pipeline for contract recovery, remittance analysis, and dispute generation; jobs survive browser session termination
* **Deterministic intelligence engines** — all adjudication, COB, denial scoring, and contract math is rule-based and reproducible; no ML or fabricated outputs
* **X12 EDI native processing** — parse, validate, and normalize 835/837P/837I transactions without intermediate CSV conversion
* **Evidence vault with versioning** — private Supabase Storage buckets with org-scoped RLS; file versions preserved, never overwritten
* **PHI-safe audit export** — redacted export mode strips member IDs, personal identifiers, and sensitive filenames; full export restricted to admin/owner
* **HIPAA-ready architecture** — PHI handling, access controls, audit logging, and incident response plans documented (see `docs/`)
* **Production hardening** — SECURITY DEFINER functions restricted to `authenticated`; `PUBLIC`/`anon` execute rights revoked across all helpers
* **Replay-verifiable adjudication** — every adjudication run is fingerprinted with canonical JSON + SHA-256; results are deterministically reproducible
* **Structured observability** — every engine decision and job execution emits typed `ops_events` with actor, org, payload, and timestamp

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
* **Evidence Vault** — versioned document management with org-scoped private storage, readiness scoring, and appeal packet generation
* **PHI-Safe Audit Export** — CSV or JSON export in Full (admin/owner) or Redacted (manager+) mode; every export permanently logged
* **Security Inventory** — browsable RLS policy list and SECURITY DEFINER helper inventory at `/admin/security`
* **Role-Aware UI** — controls hidden (not just disabled) for unauthorized roles; `RequireRole` guards protect admin routes

## Automation

* **Autonomous Recovery Pipeline** — seven-step orchestrated job chain (remittance analysis → contract matching → underpayment detection → dispute generation → case generation → queue assignment → executive recalculation)
* **Automation Rules Engine** — configurable triggers (`underpayment_threshold`, `sla_risk`, `evidence_stale`, `denial_severity`, `repeat_payer_issue`) with automatic case creation, manager assignment, and escalation actions
* **Server-Side Contract Recovery** — edge worker pipeline that discovers underpayment candidates, matches contracts, computes variance, and writes idempotent dispute records without browser involvement
* **Operational Workflows** — assignment with priority/due date, appeal lifecycle logging, recovery event recording, worklist queries, and unified claim timeline

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
│   ├── engine/                    # Deterministic intelligence engines
│   │   ├── calculation-engine.ts  # Core adjudication math
│   │   ├── cob-rules.ts           # COB primacy rules + allocation
│   │   ├── state-machine.ts       # Claim lifecycle + idempotency
│   │   ├── denial-intelligence.ts # CARC/RARC classification
│   │   ├── contract-match.ts      # Payer contract matching
│   │   ├── contract-underpayment.ts
│   │   ├── dispute-generator.ts
│   │   ├── job-runner.ts          # Automation job registry
│   │   ├── pipeline-orchestrator.ts
│   │   ├── x12-parser.ts          # X12 EDI parsing
│   │   ├── edi-validator.ts
│   │   ├── edi-normalizer.ts
│   │   ├── value-realization.ts   # Executive metrics
│   │   ├── appeal-packet-generator.ts
│   │   ├── replay-engine.ts       # Deterministic replay
│   │   └── ... (50+ engines total)
│   │
│   ├── pages/                     # Route-level page components (70+)
│   │   ├── CommandCenter.tsx
│   │   ├── DenialIntelligence.tsx
│   │   ├── ClaimsWorkbench.tsx
│   │   ├── EvidenceVault.tsx
│   │   ├── ExecutiveHome.tsx
│   │   ├── AutomationHome.tsx
│   │   ├── EdiHome.tsx
│   │   ├── AdminConsole.tsx
│   │   └── ...
│   │
│   ├── components/                # Shared UI components
│   ├── hooks/                     # React Query data hooks
│   │   ├── use-auth.tsx
│   │   ├── use-org.tsx
│   │   ├── use-clarity-data.ts
│   │   ├── use-contracts.ts
│   │   ├── use-automation.ts
│   │   └── ...
│   │
│   ├── data/                      # Repository functions (DB access)
│   │   ├── repository.ts
│   │   ├── operational-workflows.ts
│   │   └── __tests__/
│   │
│   ├── lib/                       # Shared utilities
│   │   ├── audit-export.ts        # PHI-safe audit export
│   │   ├── role-permissions.ts    # RBAC helpers
│   │   └── dev-auth-helper.ts
│   │
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
├── docs/                          # Security and compliance documentation
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

All requests require a Supabase JWT (`Authorization: ****** Tokens are obtained via `supabase.auth.signInWithPassword()` or `supabase.auth.signUp()`. RLS policies evaluate `auth.uid()` server-side; no client-supplied org_id or user_id is trusted for access decisions.

## Primary Endpoints (PostgREST)

| Resource | Purpose |
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

Create a `.env` file at the project root:

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

**No secrets are committed to source control.** The `.env` file is in `.gitignore`.

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

## Watch Mode

```bash
npm run test:watch
```

## Coverage

```bash
npm run test -- --coverage
# Target: src/engine/cob-rules.ts at 100% lines/branches/functions
```

## Manual Testing

After applying migrations and creating a dev user (see Installation), verify:
- Claims visible on `/platform` or `/claims`
- Adjudication executes and writes `adjudication_runs` row
- Duplicate fingerprint does not create a new `replay_record`
- Idempotency key blocks duplicate payment transitions
- Evidence upload creates `evidence_documents` row and storage object
- Automation job completes and appears in `/automation/jobs`

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
- [ ] Dev user / seed data disabled (`VITE_DEMO_MODE` unset)
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
- [ ] **Idempotency key persistence** — persist in-memory idempotency keys to Supabase to survive page reloads and prevent duplicate payment transitions
- [ ] **Automation rule config editor** — in-app UI for editing rule thresholds and actions (currently JSON-via-console)
- [ ] **Lineage completion** — emit `case_created`, `outcome_recorded`, and `executive_value_attributed` lineage events from case/outcome engines
- [ ] **TypeScript strict mode** — enable `noImplicitAny` and `strictNullChecks`
- [ ] **Background scheduler** — replace synchronous browser-triggered pipelines with cron-based scheduled execution

## Future Vision

- Real-time SLA alerting with push notifications for breach risk
- Direct payer API integrations for 270/271 eligibility and 276/277 claim status queries
- Bulk dispute packet transmission to payers
- SNIP-2/3 payer-business EDI validation
- 270/271/277/278/999/TA1 normalizers
- Multi-org hierarchy (holding company / health system model)
- Observability stack (metrics, distributed tracing, alerting, error budgets)
- SSO, TOTP MFA, and password rotation policies
- Materialized views for executive dashboard performance at scale

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

---

## Product Vision

> Where is the money, why is it stuck, who owns it, what action recovers it, and how much did Claim Clarity actually return?

The preferred data flow is:

```
Claim data → denial intelligence → transparency → next action →
recovery operations → persistent outcome → recovery analytics →
executive attribution & value realization
```

Claim Clarity is the commercial wedge of the Valtaris ecosystem, supported by Cloud (tenancy/security/audit), Glue (workflow runtime), Core (COB/adjudication), and Weaver (context intelligence).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18, TypeScript 5, Vite 5, Tailwind v3, shadcn/ui, Recharts |
| Backend | Supabase (Postgres + RLS + Edge Functions + Storage) |
| Intelligence | Deterministic TypeScript engines — no ML, no fabricated data |
| Testing | Vitest, Testing Library |
| Auth | Supabase Auth (email/password; org-scoped RBAC) |

---

## Development Setup

### Prerequisites

- Node.js 18+ / Bun
- Supabase project (or local Supabase CLI)
- `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

### Quick Start

```bash
npm install
npm run dev       # dev server at localhost:5173
npm run build     # production build
npm run test      # run Vitest suite
npm run lint      # ESLint
```

### Demo Mode

Set `VITE_DEMO_MODE=true` in `.env` to auto-seed a Demo Organization with sample claims, accumulators, and traces on first load. No database writes are required from other users.

### Dev User / RLS Setup

After enabling demo mode, create a dev user with org membership so RLS policies pass:

```javascript
// In browser console after app loads:
import { ensureDevUser } from '@/lib/dev-auth-helper';
const result = await ensureDevUser('dev@example.com', 'devpassword123', 'analyst');
```

Then sign in with those credentials. See `DEV_SETUP.md` for full role options and troubleshooting.

### Role Hierarchy

| Role | Capabilities |
|------|-------------|
| `viewer` | Read-only — no upload, edit, assign, escalate, or delete |
| `analyst` | Read + write claims/runs/traces, upload evidence, assign work |
| `manager` | Analyst + delete, escalate, run redacted audit exports |
| `admin` | Manager + org settings, security console, full audit exports |
| `owner` | Admin + delete organization |

---

## Development Principle

**Do not duplicate existing intelligence. Extend the existing system.**

---

## Implemented Features

### Core Adjudication & COB Engine

- Full claim adjudication with fee schedule, deductible, coinsurance, and out-of-pocket accumulation
- Cross-line accumulator: line N sees deductible consumed by prior lines in the same run
- Coordination of Benefits (COB) with four policy types:
  - **Standard** — secondary pays remaining after primary
  - **Non-Duplication** — secondary pays nothing if primary paid ≥ secondary allowed
  - **Carve-Out** — secondary is completely eliminated after any primary payment
  - **Maintenance of Benefits (MOB)** — secondary bridges the gap only when primary paid less than allowed
- Idempotency-keyed payment state machine (ADJUDICATED → PAYMENT_IN_PROGRESS → PAID)
- COB primacy rules: birthday rule (timezone-safe ISO parsing), length-of-coverage rule
- Multi-payer distribution using largest-remainder method (exact cent accuracy)
- Replay engine with canonical JSON fingerprinting and deterministic hash verification

### COB Rules Engine — Hardened (Phase 1 Patch + COB Hardening PR)

Surgical fixes and comprehensive test coverage added to `src/engine/cob-rules.ts`:

- **Birthday rule** — timezone-safe: parses ISO date strings directly, never uses `Date` constructor; eliminates timezone conversion bugs that could swap primacy across system locales
- **Carve-out policy** — fully implemented (was a defined type with no execution path; now correctly zeros secondary liability)
- **MOB policy** — fixed: `adjustment = totalPriorPaid >= safeAllowed ? remainingAllowed : 0` (was always returning 0)
- **Multi-payer rounding** — largest-remainder distribution; sum of allocations is guaranteed to equal `totalAdjustment` with no lost cents
- **Primacy output validation** — rule results validated against known OHI payer IDs before use
- **Unknown policy error handling** — throws explicit error instead of silently applying a wrong zero adjustment
- **Test coverage** — 50+ test cases in `src/test/cob-rules.test.ts`; 23 state-machine / idempotency tests in `src/test/state-machine.test.ts`

> ⚠️ **Breaking change:** `calculateCOBAllocation()` now throws `Error` for unknown COB policy types (was previously a silent no-op).

### CARC/RARC Denial Intelligence

- Denial classification, recoverability scoring, and severity scoring
- Evidence requirements per denial reason code
- Next-best-action recommendations
- Playbook recommendation engine
- Decision transparency / "Why this score" explainability (`src/engine/explainability.ts`)

### Operational Workflows — Phase 3A

Backend persistence layer for the full billing-manager workflow (`src/data/operational-workflows.ts`):

- **Assignment workflow** — `updateAssignment()` with priority (`low / medium / high / urgent`), due_date, assigned_to/by user IDs
- **Notes & events** — `addNote()`, `logAppealEvent()` (submitted / responded / resolved), `logRecoveryEvent()` (payer / patient / writeoff / adjustment), `logWriteOff()`
- **Worklist queries** — `getMyWorklist()`, `getOverdueClaims()`, `getDueTodayClaims()`, `getHighDollarClaims()`
- **Timeline** — `getClaimTimeline()` unified chronological history; `getClaimTimelineByKind()`, `getAppealTimeline()`, `getRecoveryTimeline()`, `getNoteTimeline()`
- All functions are org-scoped and append to `ops_events` for immutable audit trail
- `claim_assignments` extended with 5 new columns and 5 new indexes (no breaking changes)
- 40+ test cases in `src/data/__tests__/operational-workflows.test.ts`

### Recovery Operations

- SLA management, escalation tracking, workload management
- Payer operations and payer requirements
- Work queues with assignment and prioritization
- Outcome logging and recovery intelligence dashboard
- Recovery ops dashboard aggregating open claims, SLA risk, and escalations

### Recovery Factory (Bulk Import)

- CSV bulk import with configurable field mappings
- Row-level validation with error annotation
- Import exception management — preserve, correct, and retry failed rows
- Import history and batch status tracking
- 835 remittance intake and normalization

### Executive Intelligence — Phase 11

Deterministic value realization; every metric traces to persisted rows. Slices with fewer than 5 outcomes return `insufficient: true` and the UI surfaces "Insufficient Outcome History" rather than fabricated numbers.

- `src/engine/recovery-attribution.ts` — attribute recovered $ to category, payer, playbook, owner, resolution action
- `src/engine/payer-performance.ts` — payer scorecards (denial rate, underpayment rate, recovery rate, appeal success, top failure categories)
- `src/engine/playbook-effectiveness.ts` — rank playbooks by recovery rate, $, resolution time, appeal success
- `src/engine/value-realization.ts` — at-risk vs recovered, expected future recovery, monthly/category/payer breakdown, deterministic narrative

### Identity & RBAC — Phase 12

- Supabase Auth with email/password
- Organizations table with org-scoped row-level security on every operational table
- Real actor identity recorded in every `ops_events` row
- `handle_new_user_org` trigger — new users automatically get a personal organization
- `is_org_member` / `has_org_role` / `current_org_id` SECURITY DEFINER helpers (EXECUTE restricted to `authenticated`)

### Evidence Vault — Phase 13

Real document management for denials, appeals, and recovery actions.

**Storage buckets**
- `evidence-documents` (private) — uploaded evidence files
- `appeal-packets` (private) — generated appeal packet snapshots
- Path convention: `<org_id>/<claim_id>/<uuid>_v<n>_<filename>`
- Supported formats: PDF, PNG, JPG, DOCX, XLSX

**Versioning** — re-uploading the same filename + type to the same claim auto-bumps the version; parent links are preserved; no file is ever overwritten in storage.

**Appeal Packet Generator** (`src/engine/appeal-packet-generator.ts`) — deterministic Markdown packet with claim, denial, evidence checklist, attached documents, timeline, and recovery opportunity. If readiness is not READY the packet header reads "Appeal Packet Incomplete" and enumerates blocking gaps.

**`evidence_documents` table** — `org_id`, `claim_id`, `denial_id`, `storage_path`, `filename`, `mime_type`, `file_size`, `document_type`, `version`, `parent_document_id`, `uploader`. RLS via `is_org_member` / `has_org_role`.

**Ops events emitted:** `document_uploaded`, `document_linked`, `document_removed`, `appeal_packet_generated`.

### Production Hardening — Phase 14

- `org_id NOT NULL` enforced on every operational table (claims, cases, ops_events, assignments, outcomes, remittance_batches, evidence_documents, etc.)
- RLS tightened — no anonymous access, no globally permissive policy, no NULL-bypass branch
- SECURITY DEFINER functions restricted: `set_default_org_id`, `handle_new_user_org`, `touch_updated_at` — EXECUTE revoked from `PUBLIC`/`anon`
- Audit export (`src/lib/audit-export.ts`) — CSV or JSON, Full or Redacted mode; every export emits `audit_export_requested` + `audit_export_completed` ops events
- Admin console at `/admin`, `/admin/security`, `/admin/audit`
- Role-aware UI (`src/lib/role-permissions.ts`) — controls hidden (not just disabled) for unauthorized roles; `RequireRole` guards admin routes

### Contract Intelligence — Phase 15

- `payer_contracts` + `fee_schedules` tables
- `src/engine/contract-import.ts` — bulk contract import with validation
- `src/engine/contract-match.ts` — match claims to applicable contract version by payer, date, and service type
- `src/engine/contract-underpayment.ts` — compute expected reimbursement (fixed / case / per-diem / percent-of-billed / percent-of-Medicare) and detect variance
- `src/engine/dispute-generator.ts` — generate underpayment disputes with supporting evidence
- Contract analytics dashboard, dispute lifecycle management

### Autonomous Recovery Pipeline — Phase 16

Orchestrated automation layer chaining existing engines into a deterministic, audited recovery pipeline.

**Job types** (registered in `src/engine/job-runner.ts`):
- `remittance_analysis` — normalize and classify remittance batches
- `contract_matching` — match claims to active contracts
- `underpayment_detection` — identify underpaid claims
- `dispute_generation` — create underpayment disputes
- `recovery_case_generation` — open recovery cases via `auto-case-generator.ts`
- `queue_assignment` — assign open cases to appropriate queues
- `executive_recalculation` — refresh executive metrics

**`automation_rules`** — configurable triggers (`underpayment_threshold`, `sla_risk`, `evidence_stale`, `denial_severity`, `repeat_payer_issue`) evaluated against `RuleSignal` with actions: `auto_case`, `assign_manager`, `escalate`. Manager+ manages rules.

**`automation_jobs`** table — every execution recorded with type, status, records processed/succeeded/failed, recovery value, pipeline_id, result JSON.

**Ops events:** `job_started`, `job_completed`, `job_failed`, `rule_triggered`, `case_auto_created`, `dispute_auto_created`, `pipeline_started`, `pipeline_completed`.

### Server-Side Contract Recovery — Phase 19

Moves contract matching and underpayment detection into the durable edge worker pipeline; the browser session is no longer needed to detect or persist contract-based recoveries.

**New durable job type** — `contract_recovery_analysis` runs inside `worker-dispatcher`:
- Loads org-scoped contracts + fee schedules
- Discovers candidates from `claims.payload.intel.payer_responses` (latest non-zero response per claim; per-line proration when `payload.lines` is present)
- Matches applicable contract version and computes expected reimbursement
- Detects variance and creates `underpayment_disputes` rows

**Idempotency** — `dedupe_key` + `service_date` on `underpayment_disputes`; unique index `(org_id, dedupe_key)` prevents duplicate disputes; key formula: `claim_id|contract_id|variance_amount_cents|service_date`.

**Ops events:** `contract_recovery_started`, `contract_match_found`, `contract_match_missing`, `underpayment_detected`, `dispute_duplicate_skipped`, `contract_recovery_completed`.

### Remittance Lineage — Phase 20

End-to-end lineage from every imported remittance row through claims, underpayments, disputes, cases, and outcomes.

- New tables: `remittance_lines`, `claim_source_links`, `recovery_lineage_events`
- `underpayment_disputes` extended with `remittance_line_id` + `source_metadata`
- `commitBatch` persists a remittance line, claim source link, and lineage events (`row_imported`, `claim_created`) for every imported row
- Worker-side `contract_recovery_analysis` prefers `remittance_lines` for candidate discovery; disputes stamped with originating `remittance_line_id`
- **Ops events:** `lineage_created`, `lineage_linked`, `lineage_missing`, `lineage_repaired`

### X12 Gateway & Native EDI Processing — Phase 21

Native ingestion of healthcare X12 transactions without intermediate CSV.

**Tables:** `edi_transactions` (envelope metadata, type, validation status, segment/error counts), `edi_segments` (parsed segments with raw + JSON), `edi_errors` (validation errors keyed to transaction and segment).

**Engines:**
- `src/engine/x12-parser.ts` — delimiter detection, segment/element splitting, ISA/GS/ST envelope extraction, transaction-type classification (835 vs 837P vs 837I via GS08)
- `src/engine/edi-validator.ts` — envelope integrity, control-number matching (ISA13↔IEA02, GS06↔GE02, ST02↔SE02), SE01 segment-count balancing, supported-type gate
- `src/engine/edi-normalizer.ts` — `normalize835 → CanonicalRemittance[]` (CLP/CAS/SVC/DTM/LQ walk); `normalize837 → CanonicalClaim837[]` (NM1/CLM/SV1·SV2·SV3/DTP walk)

**Transactions supported:** 835, 837P, 837I. Parser and schema accommodate 270/271/277/278/999/TA1; normalizers are pending.

**Ops events:** `edi_received`, `edi_parsed`, `edi_validated`, `edi_rejected`, `edi_normalized`, `edi_imported`.

---

## Route Index

| Route | Description |
|-------|-------------|
| `/` | Command Center (dashboard landing) |
| `/command` | Executive Command |
| `/today` | Today's Opportunities |
| `/pipeline` | Recovery Pipeline |
| `/forecast` | Recovery Forecast |
| `/team` | Team Operations |
| `/playbooks` | Playbooks |
| `/denials` | Denial Intelligence |
| `/denials/:claimId` | Denial Detail |
| `/queues` | Work Queues |
| `/claims` | Claims Workbench |
| `/appeals` | Appeals Workbench |
| `/packet` / `/packet/:claimId` | Appeal Packet Generator |
| `/vault` | Evidence Vault |
| `/vault/claim/:claimId` | Claim Evidence + Readiness |
| `/vault/denial/:denialId` | Denial Evidence Upload |
| `/vault/:documentId` | Document Detail + Versions |
| `/leak` | Revenue Leak |
| `/payers` | Payer Intel |
| `/payer-requirements` | Payer Requirements |
| `/reports` | Executive Reporting |
| `/transparency` / `/transparency/:claimId` | Transparency Center |
| `/recovery-intel` | Recovery Intelligence |
| `/outcomes` | Outcome Log |
| `/ops` | Recovery Ops Dashboard |
| `/sla` | SLA Management |
| `/escalations` | Escalations |
| `/workload` | Workload Management |
| `/payer-ops` | Payer Operations |
| `/factory` | Recovery Factory |
| `/factory/import` | Import Center |
| `/factory/history` | Import History |
| `/factory/exceptions` | Exception Queue |
| `/factory/remittance` | Remittance Intake |
| `/ingest` | Ingestion |
| `/audit` | Audit Trace |
| `/executive` | Executive Home |
| `/executive/value` | Value Realization |
| `/executive/recovery` | Recovery Attribution |
| `/executive/payers` | Payer Scorecards |
| `/executive/playbooks` | Playbook Effectiveness |
| `/admin` | Admin Console (KPIs) |
| `/admin/security` | RLS Policy Inventory |
| `/admin/audit` | Audit Export |
| `/contracts` | Contracts Home |
| `/contracts/upload` | Contract Upload |
| `/contracts/disputes` | Contract Disputes |
| `/contracts/analytics` | Contract Analytics |
| `/contracts/:contractId` | Contract Detail |
| `/automation` | Automation Center |
| `/automation/jobs` | Job Queue |
| `/automation/rules` | Automation Rules (manager+) |
| `/automation/history` | Pipeline History |
| `/platform` | Platform Home (edge workers) |
| `/platform/jobs` | Platform Jobs |
| `/platform/workers` | Platform Workers |
| `/platform/failures` | Dead-Letter Queue |
| `/lineage` | Lineage Overview |
| `/lineage/claim/:claimId` | Claim Lineage Chain |
| `/edi` | EDI Gateway Overview |
| `/edi/import` | X12 Upload / Parse |
| `/edi/transactions` | EDI Transaction List |
| `/edi/errors` | EDI Validation Errors |
| `/worklist` | My Worklist |
| `/recover` | Guided Recovery |

---

## Engine Index

| Engine | Responsibility |
|--------|---------------|
| `calculation-engine.ts` | Core adjudication math (allowed, deductible, coinsurance, COB) |
| `cob-rules.ts` | COB primacy rules (birthday, length-of-coverage) + allocation policies |
| `state-machine.ts` | Claim lifecycle transitions + idempotency-keyed payment transitions |
| `replay-engine.ts` | Deterministic replay with canonical JSON + hash fingerprinting |
| `replay-store.ts` / `replay-ledger.ts` | Persistent replay records and ledger events |
| `denial-intelligence.ts` | CARC/RARC classification, recoverability, severity scoring |
| `next-action.ts` | Next-best-action recommendations |
| `playbooks.ts` | Playbook recommendation engine |
| `explainability.ts` | "Why this score" decision transparency |
| `sla.ts` | SLA calculations and breach detection |
| `escalations.ts` | Escalation rules and routing |
| `outcome-analytics.ts` | Recovery outcome aggregation |
| `import-validation.ts` | Import row validation |
| `import-to-claim.ts` | Import row → claim conversion |
| `remittance-normalizer.ts` | 835 remittance normalization |
| `remittance-denial-extractor.ts` | Extract denials from remittance |
| `recovery-attribution.ts` | Attribute recovered $ to category/payer/playbook/owner |
| `payer-performance.ts` | Payer scorecards |
| `playbook-effectiveness.ts` | Playbook performance ranking |
| `value-realization.ts` | At-risk vs recovered, narrative generation |
| `evidence-readiness.ts` | Evidence completeness scoring |
| `appeal-readiness.ts` | Appeal readiness gate |
| `sufficiency.ts` | Evidence sufficiency check |
| `appeal-packet-generator.ts` | Deterministic Markdown appeal packet |
| `contract-import.ts` | Bulk contract import |
| `contract-match.ts` | Contract version matching |
| `contract-underpayment.ts` | Expected reimbursement + variance |
| `dispute-generator.ts` | Underpayment dispute creation |
| `job-runner.ts` | Automation job handler registry |
| `pipeline-orchestrator.ts` | Multi-step job pipeline with shared pipeline_id |
| `auto-case-generator.ts` | Auto-create recovery cases |
| `automation-rules.ts` | Rule signal evaluation and action dispatch |
| `x12-parser.ts` | X12 EDI delimiter detection + segment parsing |
| `edi-validator.ts` | EDI envelope and control-number validation |
| `edi-normalizer.ts` | 835/837 normalization to canonical types |
| `worker-executor.ts` | Edge worker execution harness |
| `dead-letter-queue.ts` | Failed job capture and retry tracking |
| `leak-detection.ts` | Revenue leak pattern detection |
| `forecasting.ts` | Recovery forecast modeling |
| `trust-metrics.ts` | Payer trust scoring |
| `queue-manager.ts` | Work queue management |
| `team-ops.ts` | Team operations and workload |
| `payer-profile.ts` | Payer profile aggregation |
| `payer-requirements.ts` | Payer-specific requirements |
| `recoverability.ts` | Claim recoverability scoring |
| `case-management.ts` | Case lifecycle helpers |
| `canonical-json.ts` | Deterministic JSON serialization |
| `hash.ts` | SHA-256 fingerprinting |
| `trace-builder.ts` | Adjudication trace construction |
| `trace-verifier.ts` | Trace integrity verification |

---

## Core Data (Persisted)

| Table | Description |
|-------|-------------|
| `claims` | Imported and adjudicated claims |
| `member_accumulators` | Deductible/OOP accumulation per member/plan year |
| `adjudication_runs` | Each adjudication execution |
| `cases` / `case_claim_links` / `case_events` | Recovery case lifecycle |
| `traces` | Per-run adjudication traces |
| `ops_events` | Immutable append-only audit trail (all workflow events) |
| `claim_assignments` | Claim assignments with priority, due_date, assigned users |
| `recovery_outcomes` | Final recovery record |
| `import_batches` / `import_exceptions` / `field_mappings` | Recovery factory |
| `remittance_batches` | 835 remittance batches |
| `evidence_documents` | Uploaded evidence files with versioning |
| `payer_contracts` / `fee_schedules` | Contract intelligence |
| `underpayment_disputes` | Detected underpayments with dedupe key |
| `automation_jobs` / `automation_rules` | Job orchestration |
| `edi_transactions` / `edi_segments` / `edi_errors` | X12 EDI source of record |
| `remittance_lines` / `claim_source_links` / `recovery_lineage_events` | Lineage chain |
| `organizations` / `organization_members` | Multi-tenancy and RBAC |

---

## What's Still Incomplete / Remaining Work

### Critical Blockers

| Item | Notes |
|------|-------|
| **EDI auto-promote** | Phase 21 parses and normalizes X12 but does not yet auto-insert rows into `remittance_batches` / `claims`. A follow-up phase must wire the promote step. |
| **Idempotency key persistence** | In-memory idempotency keys evaporate on page reload or server restart, allowing duplicate payment transitions. Requires Supabase persistence layer integration. |
| **Background workers / cron** | All pipelines run synchronously in the browser session of the triggering user. No server-side scheduled workers exist yet. |
| **EDI promote to claims** | Raw EDI is stored as source-of-record; downstream pipeline wiring (EDI → remittance_batch / claim rows) is pending. |

### High Priority

| Item | Notes |
|------|-------|
| **No native EDI 835/837 parser prior to Phase 21** | Remittance data ingested before Phase 21 was CSV-derived only. |
| **No observability stack** | No metrics, distributed tracing, or alerting. No error budget visibility. |
| **SSO, MFA, password rotation** | Email/password is the only auth method. SSO providers, TOTP MFA, and password-rotation policies are not configured. |
| **`evidence_documents` storage cascade** | Deleting an `evidence_documents` row does not delete the corresponding Supabase Storage object. Manual cleanup is required. |
| **Lineage events for case/outcome/executive** | `case_created`, `outcome_recorded`, and `executive_value_attributed` lineage events are reserved but not yet emitted. |
| **Rule config editor** | Automation rule editing beyond enable/disable and create requires JSON-via-console. No in-app threshold/action editor exists. |
| **Dispute candidate discovery** | `dispute_generation` job requires explicit `candidates` in job config. No automatic scanner that discovers candidates from raw remittance lines. |

### Medium Priority

| Item | Notes |
|------|-------|
| **TypeScript strict mode** | `noImplicitAny`, `strictNullChecks` deferred; scheduled for a hardening pass. |
| **Payer-business EDI validation** | SNIP-2/3 payer-level validation not implemented; only structural X12 envelope validation exists. |
| **270/271/277/278/999/TA1 normalizers** | X12 parser and schema accommodate these types but normalizers are TBD. |
| **`remittance_batch_id` → claim join** | Current filter scopes auditing only; a batch↔claim join table does not exist yet. |
| **Executive metrics on-demand refresh** | Dashboards re-aggregate `underpayment_disputes` on every read instead of incremental materialized views. |
| **MOB + deductible interaction test** | No explicit test for MOB with a partially applied deductible (identified as a gap in PATCH_REPORT_PHASE1). |
| **Integration test: orchestrator + state machine** | State machine tests verify transitions in isolation; end-to-end integration with `executeAdjudicationWithReplay()` is untested. |
| **Per-line allowed/paid proration** | Contract recovery prorates by billed share when only claim-level remittance is available, not true line-level data. |

### Future / Roadmap

| Item | Notes |
|------|-------|
| Real-time SLA alerting | Push notifications for breach risk; today requires manual dashboard check. |
| Payer API integrations | Direct claim status and eligibility query via 270/271/276/277. |
| Bulk dispute submission | Automated dispute packet transmission to payers. |
| ML-assisted denial classification | Currently deterministic rule-based only. |
| Native PDF generation for appeal packets | Currently Markdown + jsPDF; richer formatting planned. |
| Multi-org / parent-org hierarchy | Current model is flat; holding company / health system hierarchy not modeled. |

---

## Auditability Guarantee

Every executive metric, recovery value, and decision traces back to persisted rows in `claims`, `ops_events`, `recovery_outcomes`, `underpayment_disputes`, and related tables.

- Slices with fewer than 5 outcomes return `insufficient: true`; the UI surfaces "Insufficient Outcome History" rather than fabricated numbers.
- All workflow state changes append to `ops_events` (immutable; no UPDATE/DELETE RLS policy).
- All automation job executions are recorded in `automation_jobs` with full result JSON.
- All audit exports emit `audit_export_requested` + `audit_export_completed` ops events.
