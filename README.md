DualPay Core Ledger

A healthcare reimbursement system for structured adjudication, denial intelligence, contract recovery, durable background execution, and auditable financial workflows.

DualPay Core Ledger is a reimbursement operations system designed to unify claims, remittance information, reimbursement calculations, denial classification, contract analysis, recovery workflows, evidence, appeals, and outcomes into one auditable workflow.

It is a portfolio engineering project and research implementation. It is not represented as HIPAA certified, SOC 2 certified, or commercially production deployed.

**DualPay is the flagship product of the Valtaris portfolio.** Its adjudication compute now runs on `valtaris-nucleus`'s shared claims engine (see Data Architecture below and valtaris-nucleus's README §3.10), and its data lives in a Postgres schema shared with the rest of the ecosystem for a common identity layer. valtaris-nucleus and valtaris-glue are the supporting platform work behind it — nucleus is the backend DualPay's real adjudication path calls into; Glue is a separate, independently-real workflow-orchestration engine in the same portfolio, not (yet) wired into DualPay's own automation.

Table of Contents
Overview

The Problem

Design Objective

Core Capabilities

Architecture

Decision Model

Execution Model

Risk Controls

Trader Intelligence

Data Architecture

Security

Realtime Operations

Engineering Decisions

Engineering Incidents

Validation

Current Capability Status

Known Limitations

Roadmap

Technology Stack

Project Structure

Local Development

Configuration

Project Status

Documentation and Evidence

Author

Overview
DualPay addresses a recurring problem in healthcare reimbursement operations.

Claims, remittance files, denial codes, payer contracts, evidence, appeals, assignments, and recovery outcomes are often scattered across multiple systems. DualPay brings these workflows together in one place.

The objective is not to predict reimbursement with an opaque model.
The objective is to make reimbursement logic structured, deterministic, inspectable, and operationally actionable.

The Problem
Healthcare reimbursement involves multiple interacting systems and rules.

text
Claim
   ↓
Remittance
   ↓
Contract
   ↓
Denial
   ↓
Evidence
   ↓
Appeal
   ↓
Outcome
A reimbursement discrepancy becomes more than a calculation problem.
It becomes a workflow and auditability problem.

DualPay treats reimbursement as an operations problem, not just a billing problem.

Design Objective
DualPay is designed around five principles.

1. Deterministic Financial Logic
Given the same claim, remittance, and contract inputs, the system should produce the same reimbursement result.

2. Inspectability
A user should be able to inspect reimbursement logic rather than trust an unexplained output.

3. Risk-Aware Recovery
Detection of an underpayment does not automatically authorize recovery.
Recovery workflows include checks, evidence, and structured decision paths.

4. Separation of Domain State and Presentation
Database state represents the actual system state.
The UI translates that state into human-readable terminology.

5. Durable Background Execution
Important reimbursement workflows should not depend on a browser session remaining open.

Core Capabilities
Claim and Remittance Processing
DualPay processes:

X12 835 remittance

X12 837P professional claims

X12 837I institutional claims

The pipeline includes parsing, validation, normalization, and canonical representation.

Deterministic Adjudication
The reimbursement engine applies explicit rules for:

fee schedules

deductibles

coinsurance

accumulators

multiple payers

COB logic

rounding

traces

replay

Denial Intelligence
DualPay evaluates:

CARC and RARC codes

recoverability

severity

evidence requirements

recommended actions

Contract Recovery
DualPay compares actual reimbursement against expected reimbursement.

Supported reimbursement types include:

fixed

case

per diem

percent of billed

percent of Medicare

Underpayment disputes use deterministic deduplication keys.

The full recovery workflow runs automatically on every 835 remittance import: match each line to the real, currently-effective fee schedule → readjudicate expected vs. paid → open a deduplicated dispute → assess a contingency fee only on an actual recovery (org-configurable, off by default) → generate a client-facing recovery report → track the client's response (pursue, decline, or handle internally).

Plan Benefits
Deductibles, out-of-pocket maximums, coinsurance, copay, COB policy, and covered services are versioned, org-scoped, admin-entered records per payer — the plan-side counterpart to payer contracts. Existing entries can be corrected in place (typo'd deductible, wrong coinsurance rate) without disturbing plan_version, which is reserved for a real new plan-year revision.

Outside demo mode, the deterministic adjudication engine only runs for a claim once both a real contract and a real plan are on file for that claim's payer; a claim for a payer missing either is left un-adjudicated rather than priced against placeholder data.

The compute step of that engine now runs remotely: `adjudication-orchestrator.ts` calls valtaris-nucleus's real `adjudicate-claim` Edge Function (in its "resolved" request mode) instead of this repo's own `calculation-engine.ts`, sending the contract/plan/accumulators/claim lines this repo already resolved and getting back the full computed run and trace. Nucleus's kernel is a verified byte-for-byte port of `calculation-engine.ts`/`cob-rules.ts`, so the math is identical; what moves is where it runs. This repo's own fingerprint-based replay store remains the primary idempotency guard, unchanged; nucleus's own idempotency cache, keyed by that same fingerprint, is an additional defense-in-depth layer. `calculation-engine.ts`/`cob-rules.ts` are deliberately left in place, not deleted — they remain real, tested code that documents the exact math nucleus now runs, and tests reference them directly. This cutover carries no live production traffic yet: it depends on an `NUCLEUS_API_KEY` Edge Function secret that hasn't been issued and configured (see valtaris-nucleus's README §3.10) — until then, the `nucleus-adjudicate` proxy this calls through returns a clear "not configured" response rather than silently falling back to anything.

Recovery Operations
DualPay supports:

cases

disputes

assignments

evidence

appeal packets

appeal lifecycle

outcomes

reporting

Denial → Appeal → Outcome is a single closed loop: a denial is detected on import (deterministic CARC/RARC scoring, persisted to the claim) → an appeal packet is generated and, on submission, drives a real `appeal_recovery_cases` state machine (denied → appeal filed → submitted) → Guided Recovery tracks the payer's response and either a real recovery (written atomically to `recovery_outcomes`, the same table Executive/Outcome Log read) or a real write-off, both with a captured reason/amount rather than the case going stale. Denial and Appeal Packet pages link directly into the recovery case so the loop doesn't require separately discovering a different page.

Case Management is a closed loop: `autoCreateCase` opens a real `cases` row (with an initial `CASE_CREATED` event) when automation detects a high-severity denial, a major underpayment, or a repeat payer issue. From the Claims Workbench case tab, staff can now move a case through its real lifecycle (`OPEN → IN_REVIEW → PENDING_RETRO/RESOLVED → CLOSED`, with reopen) and add timestamped notes — both write real `case_events` rows (`STATUS_CHANGED`, `NOTE_ADDED`) alongside the retro-recalculation and accumulator-impact views that already existed, so a case that gets auto-created has a real path to resolution instead of sitting untouched.

EDI Errors is a closed loop: every X12 validation issue the gateway persists on ingest (`ingestEdiFile` → `edi_errors`) can be marked resolved or ignored with a note from the EDI Errors page, instead of accumulating in a read-only list with no way to signal it was reviewed. Resolution is attributed to the real signed-in user and timestamped, and the default view hides resolved/ignored issues so the open queue reflects real outstanding work.

Automation
DualPay includes:

durable jobs

server-side workers

scheduler

retry

dead letter

pipeline orchestration

telemetry

Architecture
text
┌──────────────────────────────────────────────────────────┐
│                     React Application                    │
│                                                          │
│ Claims · Remittance · Recovery · Evidence · Appeals      │
│ Automation · Reporting · Administration                  │
└─────────────────────────┬────────────────────────────────┘
                          │
                          │ Supabase Client
                          ▼
┌──────────────────────────────────────────────────────────┐
│                    Supabase Platform                     │
│                                                          │
│ PostgreSQL · Auth · Storage · Edge Functions             │
│                                                          │
│ Domain State · Identity · Background Execution           │
└─────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                    Deterministic Engines                 │
│                                                          │
│ Adjudication · COB · Denial · Contract Recovery          │
│ X12 Parsing · Replay · Fingerprinting                    │
└──────────────────────────────────────────────────────────┘
Decision Model
DualPay separates reimbursement decisions into distinct stages.

text
1. Claim
   ↓
2. Remittance
   ↓
3. Adjudication
   ↓
4. Denial Detection
   ↓
5. Contract Recovery
   ↓
6. Recovery Workflow
   ↓
7. Outcome
Execution Model
Recovery is modeled as an explicit workflow.

text
Underpayment
   ↓
Candidate
   ↓
Evidence
   ↓
Appeal Packet
   ↓
Appeal
   ↓
Outcome
Risk Controls
DualPay includes controls for:

recovery eligibility

evidence requirements

appeal readiness

assignment

authorization

persisted configuration

Trader Intelligence
DualPay does not include trader intelligence.
This section is intentionally omitted for DualPay.

Data Architecture
DualPay's tables live in a dedicated `dualpay` Postgres schema inside `valtaris-nucleus-2`, a Supabase project shared with valtaris-nucleus and valtaris-glue. Each app's data stays isolated in its own schema (`dualpay`, `glue`, and nucleus's own `public`), while all three share one `auth.users` table — a single Supabase Auth identity is the common identity layer across the whole ecosystem, replacing what used to be a standalone, DualPay-only Supabase project. RLS policies, RPC functions, and triggers were carried over unchanged during the move; the Supabase client is configured with `db.schema: 'dualpay'` so unqualified table references keep resolving inside DualPay's own schema.

DualPay uses PostgreSQL for:

claims

remittance lines

adjudication runs

traces

replay

idempotency

cases

disputes

outcomes

evidence

contracts

plan benefits

automation

lineage

identity

Security
DualPay includes:

authenticated access

organization boundaries

RLS

RBAC

security definer functions

append-only operational events

private storage buckets

DualPay is not represented as HIPAA certified or SOC 2 certified.

Realtime Operations
DualPay uses Supabase Realtime for responsive updates.

text
Database Event
      ↓
Realtime
      ↓
React Subscription
      ↓
UI Update
Engineering Decisions
Centralized Adjudication
Authoritative reimbursement logic is centralized in server-side engines.

RLS Enforcement
Authorization is enforced at the database boundary.

Durable Jobs
Important workflows run through durable background execution.

Replay and Idempotency
Replay records and deduplication keys prevent duplicate operations.

Type Safety
`tsc -p tsconfig.app.json` (the config that actually resolves this repo's files — the bare `tsconfig.json` is a solution-style file with no `include`/`files` and checks nothing under `--noEmit`) reports zero errors. Supabase calls use the real generated `Database` type directly; trigger-populated columns (`org_id` set by a `BEFORE INSERT` trigger, never client-supplied) are made explicit via `src/lib/supabase-helpers.ts`'s `withTriggerOrgId()` rather than a blanket type-erasing cast.

Engineering Incidents
DualPay produced several useful corrections:

lineage boundaries clarified

idempotency scope corrected

scheduler failure handling improved

storage isolation tested

X12 validation hardened

a repo-wide Supabase client type-erasure cast was found and removed (see Type Safety below); it had been hiding several real bugs, including a case-creation insert that was missing a required primary key

Validation
Validation includes:

adjudication tests

COB tests

denial tests

contract recovery tests

scheduler tests

retry tests

lineage tests

RLS tests

X12 tests

Current Capability Status
Capability	Status
Adjudication	Implemented
COB	Implemented
Denial detection	Implemented
Denial → Appeal → Outcome loop	Implemented (real appeal_recovery_cases state machine, linked from denial/packet, outcomes written atomically)
Case management loop	Implemented (auto-created on trigger, real status transitions + notes from Claims Workbench)
EDI error resolution loop	Implemented (resolve/ignore with note, attributed + timestamped)
Contract recovery	Implemented (automatic sweep on import, fee assessment, client report + response)
Plan benefits	Implemented
Shared Supabase project (`dualpay` schema in `valtaris-nucleus-2`, identity shared with nucleus + valtaris-glue)	Implemented
Durable jobs	Implemented
Scheduler	Implemented
Replay	Implemented
Idempotency	Partial
Type safety (tsc, full repo)	Implemented (0 errors)
X12 835	Implemented
X12 837P	Implemented
X12 837I	Implemented
Storage isolation	Validation pending
RLS	Validation pending
RBAC	Validation pending
Evidence lineage	Roadmap
Appeal lineage	Roadmap
Executive attribution	Roadmap
Production deployment	Not claimed


Known Limitations
live database verification pending

storage verification pending

idempotency not universal

lineage incomplete

no production load testing

no compliance certification

Roadmap
evidence lineage

appeal lineage

executive attribution

performance testing

compliance posture

production deployment

Technology Stack
React
TypeScript
Vite
Tailwind
shadcn
TanStack Query
Supabase
PostgreSQL
Edge Functions
Vitest
pgTAP

Project Structure
text
dualpay-core-ledger/
│
├── src/
│   ├── engine/
│   ├── pages/
│   ├── components/
│   ├── hooks/
│   ├── data/
│   ├── lib/
│   ├── types/
│   └── test/
│
├── supabase/
│   ├── migrations/
│   └── functions/
│
├── docs/
├── public/
└── README.md
Local Development
Clone the repository
Install dependencies
Create environment file
Push migrations
Run development server

Configuration
DualPay requires:

VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY

These now point at the shared `valtaris-nucleus-2` project; the Supabase client additionally pins `db.schema` to `dualpay` so all queries resolve against DualPay's own schema rather than the project's `public` schema (used by nucleus) or `glue` (used by valtaris-glue).

Server-side secrets must remain outside browser-exposed variables.

Project Status
Active development.
DualPay is a substantial implementation with clear architecture.
Many parts are supported by evidence.
Some parts need more verification.

Documentation and Evidence
source code

migrations

workflows

tests

lineage

replay

telemetry

database schema

Author
George Rios

Independent product engineer focused on complete software systems across product design, application architecture, database systems, workflow automation, security boundaries, and operational tooling.
