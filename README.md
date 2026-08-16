# Claim Clarity — DualPay Core Ledger

> A production-oriented healthcare reimbursement intelligence platform for deterministic adjudication, denial recovery, contract underpayment detection, and auditable recovery workflows.

DualPay Core Ledger is a healthcare reimbursement platform designed to connect claims, remittance data, reimbursement calculations, denial intelligence, contract analysis, recovery operations, evidence, appeals, and outcomes in one auditable workflow.

The system is built around deterministic financial logic, organization-scoped authorization, durable background processing, persisted workflow state, and explicit auditability.

It is a portfolio engineering project and research implementation. It is **not represented as HIPAA-certified, SOC 2-certified, or commercially production-deployed**.

---

## Table of Contents

- [Overview](#overview)
- [Why This Exists](#why-this-exists)
- [What DualPay Does](#what-dualpay-does)
- [Capability Status](#capability-status)
- [Core Features](#core-features)
- [Architecture](#architecture)
- [Core Workflows](#core-workflows)
- [Security Architecture](#security-architecture)
- [Database Design](#database-design)
- [Reliability and Background Processing](#reliability-and-background-processing)
- [X12 EDI](#x12-edi)
- [Lineage and Auditability](#lineage-and-auditability)
- [Replay and Idempotency](#replay-and-idempotency)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Testing and Verification](#testing-and-verification)
- [Deployment](#deployment)
- [Performance and Scalability](#performance-and-scalability)
- [Security and Compliance Positioning](#security-and-compliance-positioning)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Screenshots](#screenshots)
- [Contributing](#contributing)
- [License](#license)
- [Author](#author)

---

# Overview

DualPay Core Ledger addresses a recurring problem in healthcare revenue-cycle operations: reimbursement information is distributed across claims, remittance files, payer contracts, denial codes, evidence, appeals, assignments, and financial outcomes.

The platform connects those workflows into a single system.

At a high level:

    Claims / X12 EDI
           │
           ▼
    Normalization & Validation
           │
           ▼
    Deterministic Adjudication
           │
           ├───────────────┐
           ▼               ▼
    Denial Intelligence   Contract Analysis
           │               │
           └───────┬───────┘
                   ▼
            Recovery Workflow
                   │
            ┌──────┴──────┐
            ▼             ▼
          Case         Dispute
            │             │
            └──────┬──────┘
                   ▼
            Evidence / Appeal
                   │
                   ▼
                Outcome
                   │
                   ▼
           Recovery Reporting

The core design principle is **deterministic, explainable processing**.

Financial calculations and reimbursement decisions are implemented as explicit TypeScript engines rather than opaque machine-learning outputs. This allows calculations and workflow decisions to be tested, replayed, inspected, and traced.

---

# Why This Exists

Healthcare reimbursement involves multiple interacting systems and rules:

- claims;
- remittance advice;
- CARC/RARC denial codes;
- payer contracts;
- fee schedules;
- coordination of benefits;
- evidence requirements;
- appeals;
- assignments;
- recovery outcomes.

A reimbursement discrepancy therefore becomes more than a calculation problem.

It becomes a workflow and auditability problem.

DualPay was designed to explore how those processes can be represented as a deterministic, multi-tenant application with durable background execution and database-enforced authorization.

---

# What DualPay Does

## Reimbursement and Adjudication

- Fee schedule application
- Deductible and coinsurance calculations
- Cross-line accumulator tracking
- Multi-payer COB allocation
- Primacy validation
- Deterministic rounding
- Adjudication traces
- Replay records

## Denial Intelligence

- CARC/RARC classification
- Recoverability scoring
- Severity scoring
- Evidence requirements
- Recommended next actions
- Playbook assignment

## Contract Recovery

- Payer contract matching
- Effective-date selection
- Fee schedule matching
- Fixed reimbursement
- Case reimbursement
- Per-diem reimbursement
- Percent-of-billed reimbursement
- Percent-of-Medicare reimbursement
- Expected reimbursement calculation
- Variance detection
- Idempotent dispute generation

## X12 EDI

Native processing and verification for:

- 835 remittance transactions
- 837P professional claims
- 837I institutional claims

The EDI pipeline includes parsing, structural validation, envelope/control-number checks, and canonical normalization.

## Recovery Operations

- Recovery cases
- Disputes
- Claim assignments
- Worklists
- Evidence documents
- Appeal packet generation
- Appeal lifecycle
- Recovery outcomes
- Payer scorecards
- Recovery reporting

## Automation

- Durable jobs
- Server-side workers
- Scheduler dispatch
- Retry handling
- Exponential backoff
- Dead-letter queue
- Pipeline orchestration
- Automation rules
- Job telemetry

---

# Capability Status

DualPay intentionally distinguishes between **implemented**, **verified**, and **roadmap** capabilities.

| Capability / Control | Implementation | Automated Evidence | Live Verification | Status |
|---|---|---|---|---|
| Multi-tenant organization model | Yes | Yes | Pending final DB execution | 🟡 |
| PostgreSQL RLS | Yes | Yes | Pending final live verification | 🟡 |
| RBAC | Yes | Yes | Pending final live verification | 🟡 |
| SECURITY DEFINER boundaries | Yes | Yes | Reviewed | 🟢 |
| `ops_events` immutability | Yes | Yes | Pending final live DB verification | 🟡 |
| Storage tenant isolation | Yes | Policy/test coverage | Pending live verification | 🟡 |
| Durable jobs | Yes | Yes | — | 🟢 |
| Scheduler | Yes | Yes | — | 🟢 |
| Retry / DLQ | Yes | Yes | — | 🟢 |
| Contract recovery | Yes | Yes | — | 🟢 |
| Denial detection | Yes | Yes | — | 🟢 |
| X12 835 | Yes | Yes | Additional integration verification pending | 🟡 |
| X12 837P | Yes | Yes | Additional integration verification pending | 🟡 |
| X12 837I | Yes | Yes | Additional integration verification pending | 🟡 |
| Replay verification | Yes | Yes | Live DB verification pending | 🟡 |
| Persisted idempotency | Partial by operation | Yes | Additional live verification pending | 🟡 |
| Recovery lineage | Partial/implemented by lifecycle | Yes | — | 🟡 |
| Evidence lineage event | Not currently authoritative | — | — | 🔵 Roadmap |
| Appeal lineage event | Not currently authoritative | — | — | 🔵 Roadmap |
| Executive value attribution event | No authoritative persisted boundary | — | — | 🔵 Roadmap |
| MFA enforcement | Not enabled | — | — | 🔵 Roadmap |
| Performance benchmarking | Not formally benchmarked | — | — | 🔵 Roadmap |
| Commercial production deployment | Not deployed | — | — | 🔵 Roadmap |

### Status Legend

- 🟢 **Implemented and supported by current verification**
- 🟡 **Implemented or substantially implemented; additional verification remains**
- 🔵 **Planned / roadmap**
- 🔴 **Not implemented**

---

# Core Features

## Deterministic Adjudication

The reimbursement calculation engine applies explicit reimbursement rules for:

- fee schedules;
- deductibles;
- coinsurance;
- accumulators;
- multiple payers;
- COB policy behavior.

The objective is reproducibility: the same inputs and rules should produce the same result.

---

## COB Rules Engine

The COB implementation includes:

- birthday rule handling;
- length-of-coverage logic;
- primacy validation;
- multiple-payer allocation;
- largest-remainder rounding.

Calculations are performed using deterministic rules rather than probabilistic inference.

---

## CARC/RARC Denial Intelligence

Denial processing maps remittance information into operational recovery signals.

The system evaluates:

- denial classification;
- recoverability;
- severity;
- evidence requirements;
- recommended actions.

Denial classification is connected to recovery lineage rather than remaining isolated in the import layer.

---

## Contract Underpayment Detection

Contract recovery compares actual reimbursement against expected reimbursement.

The pipeline:

    Remittance
        ↓
    Candidate Discovery
        ↓
    Contract Matching
        ↓
    Expected Reimbursement
        ↓
    Actual vs. Expected Variance
        ↓
    Underpayment Dispute
        ↓
    Recovery Workflow

Supported reimbursement methods include:

- fixed;
- case;
- per-diem;
- percentage of billed;
- percentage of Medicare.

Underpayment disputes use deterministic deduplication keys to prevent duplicate dispute creation.

---

# Architecture

    ┌─────────────────────────────────────────────────────────────┐
    │                         React SPA                           │
    │                                                             │
    │  Command Center · Claims · Recovery · Evidence · Appeals    │
    │  Automation · Executive Reporting · Administration           │
    └──────────────────────────┬──────────────────────────────────┘
                               │
                               │ Supabase JS / JWT
                               ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                     Supabase Platform                       │
    │                                                             │
    │  ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
    │  │ PostgreSQL     │  │ Edge Functions   │  │ Storage      │ │
    │  │                │  │                  │  │              │ │
    │  │ RLS            │  │ worker-dispatcher│  │ Evidence     │ │
    │  │ Triggers       │  │ scheduler        │  │ Appeal       │ │
    │  │ RPCs           │  │ invite-member    │  │ Packets      │ │
    │  └────────────────┘  └──────────────────┘  └──────────────┘ │
    │                                                             │
    │                     Supabase Auth                           │
    └──────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                Deterministic Engine Layer                   │
    │                                                             │
    │ calculation-engine   cob-rules       denial-intel           │
    │ contract-match       contract-underpayment                  │
    │ x12-parser            edi-validator                         │
    │ edi-normalizer        dispute generation                     │
    │ pipeline orchestration   replay / fingerprinting             │
    └─────────────────────────────────────────────────────────────┘

## Frontend

React + TypeScript single-page application using:

- Vite
- Tailwind CSS
- shadcn/ui
- React Router
- TanStack Query
- React Hook Form
- Zod
- Recharts

## Backend

Supabase provides:

- PostgreSQL
- PostgREST
- Authentication
- Storage
- Edge Functions

## Background Execution

Three Edge Functions support the platform:

- `worker-dispatcher`
- `scheduler-dispatcher`
- `invite-member`

The worker executes durable jobs and persists their results.

---

# Core Workflows

## 1. Claim / Remittance Import

    CSV or X12
       ↓
    Validation
       ↓
    Field Mapping
       ↓
    Batch Commit
       ↓
    Claims + Remittance Lines
       ↓
    Lineage

Imported data is validated before being persisted.

---

## 2. Denial Detection

    835 Remittance
          ↓
    Remittance Classification
          ↓
    Denial
          ↓
    denial_detected
          ↓
    Recovery Analysis

The `denial_detected` lineage event is emitted at the existing 835 denial-classification boundary.

Non-denial remittance classifications do not generate the denial event.

---

## 3. Contract Recovery

    contract_recovery_analysis
              ↓
    Candidate Discovery
              ↓
    Contract Matching
              ↓
    Expected Reimbursement
              ↓
    Variance
              ↓
    underpayment_disputes
              ↓
    underpayment_detected
              ↓
    dispute_created

The server-side worker performs the recovery operation without requiring an active browser session.

---

## 4. Recovery Case Generation

    Recovery Opportunity
            ↓
    Case Generation
            ↓
    cases
            ↓
    case_claim_links
            ↓
    case_created

`case_created` and `dispute_created` represent distinct lifecycle concepts.

A case aggregates recovery work around a claim; a dispute represents a specific reimbursement variance.

---

## 5. Denial Recovery Workflow

    Denial
      ↓
    Recoverability / Severity
      ↓
    Assignment
      ↓
    Evidence
      ↓
    Appeal Packet
      ↓
    Appeal
      ↓
    Outcome

The system supports evidence collection, readiness checks, deterministic appeal packet generation, assignment, and outcome recording.

---

# Security Architecture

## Authentication

Supabase Auth provides authenticated sessions and JWT-based identity.

Database authorization uses `auth.uid()` and organization membership rather than trusting browser-supplied organization identifiers.

---

## Authorization

DualPay implements a five-level role hierarchy:

    viewer
       ↓
    analyst
       ↓
    manager
       ↓
    admin
       ↓
    owner

Role information is stored in `organization_members`.

Authorization is implemented across:

- PostgreSQL RLS;
- SECURITY DEFINER helper functions;
- application-level role guards.

UI controls are hidden for unauthorized roles rather than relying exclusively on disabled buttons.

---

## Multi-Tenant Isolation

Operational records are organization-scoped.

The security model uses:

- `org_id`;
- organization membership;
- PostgreSQL RLS policies;
- role-aware policies;
- authenticated JWT context.

The repository includes application-level and database-oriented tests for cross-organization access.

### Verification status

The repository contains a dedicated pgTAP security verification suite for live PostgreSQL execution.

Final live execution against the deployed/local Supabase database remains a separate verification step.

Therefore this project does **not** claim that live database isolation has been exhaustively verified in every deployment environment.

---

## SECURITY DEFINER Functions

Privileged database functions are explicitly reviewed for:

- `SECURITY DEFINER`;
- safe `search_path`;
- organization membership checks;
- role checks;
- execution grants.

`PUBLIC` and anonymous execution are restricted where appropriate.

---

## Audit Logging

`ops_events` is designed as an append-only operational event stream.

Events capture information such as:

- actor;
- organization;
- event kind;
- entity references;
- payload;
- timestamp.

The repository contains tests for immutability behavior.

Final live database verification of trigger/RLS enforcement remains pending.

---

## Input Validation

Validation occurs at multiple boundaries:

- import validation;
- X12 envelope validation;
- EDI structure validation;
- Zod form schemas;
- database constraints;
- explicit error handling for unsupported rule types.

The goal is fail-fast behavior rather than silently applying invalid reimbursement rules.

---

# Database Design

PostgreSQL contains functional domains including:

| Domain | Representative Tables |
|---|---|
| Claims | `claims`, `claim_source_links` |
| Adjudication | `adjudication_runs`, `traces` |
| Replay | `replay_records`, `replay_ledger_events` |
| Idempotency | `idempotency_keys` |
| Operations | `ops_events`, `claim_assignments` |
| Cases | `cases`, `case_claim_links`, `case_events` |
| Recovery | `recovery_outcomes`, `underpayment_disputes` |
| Import | `import_batches`, `import_exceptions` |
| Evidence | `evidence_documents` |
| Contracts | `payer_contracts`, `fee_schedules` |
| Automation | `automation_jobs`, `automation_rules` |
| EDI | `edi_transactions`, `edi_segments`, `edi_errors` |
| Lineage | `remittance_lines`, `recovery_lineage_events` |
| Identity | `organizations`, `organization_members` |

Important relationships include:

    claims
      └── adjudication_runs
            └── traces

    claims
      └── remittance_lines
            └── underpayment_disputes

    cases
      └── case_claim_links
            └── claims

    recovery_outcomes
      └── reporting / recovery metrics

    recovery_lineage_events
      └── entity_type + entity_id

Indexes are used for organization-scoped filtering, high-frequency joins, worklists, and deterministic dispute deduplication.

---

# Reliability and Background Processing

DualPay uses durable job execution for operations that should not depend on a browser session remaining open.

## Job Lifecycle

    queued
      ↓
    claimed
      ↓
    running
      ↓
    completed

Failures can move through retry handling:

    failed
      ↓
    retry
      ↓
    failed
      ↓
    retry
      ↓
    dead_letter

The worker infrastructure includes:

- retry tracking;
- exponential backoff;
- dead-letter handling;
- persisted job state;
- failure telemetry.

---

## Scheduler

The scheduler dispatches background work and records execution results.

A scheduler failure is now represented as a failed scheduler run rather than being silently treated as success.

Failure telemetry includes persisted status and diagnostic information appropriate for operational review.

---

# X12 EDI

DualPay includes native processing support for:

- X12 835;
- X12 837P;
- X12 837I.

The EDI pipeline includes:

    Raw X12
      ↓
    Parser
      ↓
    Envelope Validation
      ↓
    Structural Validation
      ↓
    Normalization
      ↓
    Canonical Internal Representation
      ↓
    Application Processing

The repository includes positive and malformed fixture coverage for parsing, validation, and normalization.

Additional live integration testing remains a verification concern rather than a claim of complete payer interoperability.

---

# Lineage and Auditability

DualPay maintains recovery lineage across major lifecycle transitions.

Current implemented lineage includes:

    claim_created
          ↓
    denial_detected
          ↓
    underpayment_detected
          ↓
    case_created / dispute_created
          ↓
    outcome_recorded

Additional operational events are recorded through `ops_events`.

## Current Lineage Status

| Lifecycle | Event | Status |
|---|---|---|
| Claim | `claim_created` | 🟢 |
| Denial | `denial_detected` | 🟢 |
| Recovery detection | `underpayment_detected` | 🟢 |
| Case | `case_created` | 🟢 |
| Dispute | `dispute_created` | 🟢 |
| Outcome | `outcome_recorded` | 🟢 |
| Evidence | Dedicated lineage event | 🔵 Roadmap |
| Appeal | Dedicated lineage event | 🔵 Roadmap |
| Recovered value | Derived from outcomes | 🟡 |
| Executive attribution | Dedicated persisted event | 🔵 Roadmap |

The project deliberately does not create a transactional event for a concept that currently exists only as a derived report.

For example, `executive_value_attributed` remains a roadmap concept because the current executive metrics are derived from persisted recovery data rather than created by a dedicated authoritative attribution transaction.

---

# Replay and Idempotency

Financial workflows require protection against duplicate execution.

DualPay includes:

- persisted idempotency infrastructure;
- unique deduplication keys for contract recovery;
- replay records;
- canonical fingerprints;
- deterministic adjudication;
- duplicate-operation tests.

Important state-changing operations use persisted protections where implemented.

The project does **not** claim universal persisted idempotency across every possible operation.

That distinction is intentional.

---

# Technology Stack

## Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- React Router
- TanStack Query
- React Hook Form
- Zod
- Recharts
- jsPDF
- xlsx

## Backend

- Supabase
- PostgreSQL
- PostgREST
- Supabase Auth
- Supabase Storage
- Supabase Edge Functions
- Deno / TypeScript

## Testing

- Vitest
- pgTAP
- ESLint

## Development

- Git
- GitHub
- npm / Bun
- Supabase CLI

## AI

The current release does **not** use third-party AI services in the reimbursement decision path.

The core intelligence engines are deterministic TypeScript.

AI-assisted denial analysis and appeal recommendations remain future roadmap capabilities.

---

# Project Structure

    dualpay-core-ledger/
    │
    ├── src/
    │   ├── engine/                    # Deterministic intelligence engines
    │   ├── pages/                     # Route-level page components
    │   ├── components/                # Shared UI components
    │   ├── hooks/                     # React Query hooks
    │   ├── data/                      # Database/repository functions
    │   ├── lib/                       # Shared application utilities
    │   ├── types/                     # Shared TypeScript types
    │   ├── integrations/              # Supabase integration
    │   └── test/                      # Vitest tests
    │
    ├── supabase/
    │   ├── migrations/                # Ordered SQL migrations
    │   ├── functions/
    │   │   ├── worker-dispatcher/
    │   │   ├── scheduler-dispatcher/
    │   │   └── invite-member/
    │   └── tests/                     # Database / pgTAP verification
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
    ├── package.json
    ├── vite.config.ts
    ├── vitest.config.ts
    ├── tailwind.config.ts
    └── tsconfig.json

---

# Installation

## Prerequisites

- Node.js 18+ or Bun
- Supabase project, local or hosted
- Supabase CLI

## Clone

    git clone https://github.com/gmr9387/Dualpay.git
    cd Dualpay

## Install

    npm install

## Environment

Create `.env` from `.env.example`.

    VITE_SUPABASE_URL=https://<your-project>.supabase.co
    VITE_SUPABASE_ANON_KEY=<your-anon-key>
    VITE_DEMO_MODE=false

Do not commit `.env`.

The repository uses `.env.example` for configuration guidance.

## Database

For a linked Supabase project:

    supabase db push

For local development:

    supabase start
    supabase db reset

## Development Server

    npm run dev

The Vite development server runs on:

    http://localhost:5173

---

# Configuration

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Browser-safe Supabase public key |
| `VITE_DEMO_MODE` | Optional | Enables demo-mode initialization |

Server-side Edge Function secrets must be configured through the Supabase environment.

The service-role key must **never** be exposed through a `VITE_` variable or committed to source control.

---

# Testing and Verification

## Application Tests

Run:

    npm run test

The repository includes coverage for:

- adjudication;
- COB;
- state transitions;
- operational workflows;
- scheduler behavior;
- retry/DLQ;
- recovery lineage;
- RLS-related application behavior;
- security helper behavior;
- Storage policy logic;
- X12 processing.

The latest audit pass added 100 tests without introducing new failures.

The environment still contains tests that require a live Supabase connection; those are tracked separately from application-level failures.

---

## Database Security Verification

A dedicated pgTAP suite exists at:

    supabase/tests/rls_security_verification.sql

The suite contains 30 database-level security assertions covering representative tenant-isolation and authorization behavior.

The intended verification includes:

- cross-organization SELECT isolation;
- cross-organization INSERT protection;
- cross-organization UPDATE protection;
- cross-organization DELETE protection;
- privileged function boundaries;
- audit immutability.

### Important

The pgTAP suite is **verification infrastructure**, not proof that every test has already been executed against the final deployed environment.

Final live execution against the target Supabase/PostgreSQL environment remains an explicit verification step.

---

## Manual Verification

After migrations and authentication are configured, verify representative workflows:

1. Authenticate as an organization member.
2. Confirm organization-scoped claims are visible.
3. Run adjudication.
4. Confirm an `adjudication_runs` record is created.
5. Verify duplicate replay fingerprints do not create duplicate replay records.
6. Verify idempotency keys prevent duplicate protected state transitions.
7. Upload evidence and verify the database record and Storage object.
8. Execute an automation job.
9. Confirm job state and telemetry.
10. Inspect `ops_events` for the corresponding lifecycle events.

---

# Deployment

## Development

    npm run dev
    supabase start

## Build

    npm run build

## Preview

    npm run preview

## Supabase

Apply migrations:

    supabase db push

Deploy Edge Functions:

    supabase functions deploy worker-dispatcher
    supabase functions deploy scheduler-dispatcher
    supabase functions deploy invite-member

Configure server-side secrets through the Supabase dashboard.

For a non-demo deployment:

    VITE_DEMO_MODE=false

---

# Performance and Scalability

DualPay is structured for scalable execution, but formal production-scale benchmarking has not been completed.

The architecture includes several scalability-oriented characteristics:

- indexed organization-scoped queries;
- deterministic pure calculation engines;
- persisted job state;
- server-side background execution;
- deduplication keys;
- private object storage;
- TanStack Query caching;
- Edge Function execution.

However, the project does **not** claim a specific throughput, latency target, or production load capacity without benchmark evidence.

Formal load testing and high-cardinality dashboard optimization remain future work.

---

# Security and Compliance Positioning

DualPay includes security controls intended for healthcare-oriented application design, including:

- authenticated access;
- organization-scoped authorization;
- PostgreSQL RLS;
- RBAC;
- SECURITY DEFINER function hardening;
- append-only operational events;
- private Storage buckets;
- PHI-aware audit export modes;
- data classification documentation;
- incident response documentation;
- risk tracking.

These controls are **engineering safeguards and design objectives**.

DualPay is not represented as:

- HIPAA certified;
- SOC 2 certified;
- independently audited;
- legally compliant for a particular healthcare deployment;
- production-authorized for handling live PHI.

Organizations deploying software in regulated environments must perform their own legal, compliance, security, privacy, and operational assessments.

---

# Known Limitations

The following limitations are intentionally documented rather than hidden.

## Live Database Verification

The repository contains pgTAP verification for PostgreSQL/RLS behavior, but final execution against the target live/local Supabase environment remains pending.

## Storage Verification

Storage policies and tenant-isolation logic exist, but final cross-organization live Storage verification remains outstanding.

## Idempotency Scope

Persisted idempotency exists for important operations, including contract recovery and protected state transitions.

Universal persisted idempotency across every state-changing operation is not claimed.

## Lineage

Core recovery lineage is implemented for:

- claim creation;
- denial detection;
- recovery/underpayment detection;
- case creation;
- dispute creation;
- outcome recording.

Dedicated evidence, appeal, and executive-attribution lineage events remain roadmap items where no authoritative transactional boundary currently exists.

## Executive Attribution

Executive recovery metrics are currently derived from persisted recovery data.

A dedicated `executive_value_attributed` transactional event is not implemented because there is currently no authoritative persisted attribution operation.

## MFA

MFA-related schema support exists, but enforced TOTP/MFA authorization is roadmap work.

## Performance

Formal production load testing has not been completed.

## Production Deployment

The repository contains deployment procedures, but DualPay is not represented as a commercially deployed healthcare production system.

---

# Roadmap

## Near Term

- Execute final live pgTAP/RLS verification.
- Complete live Storage tenant-isolation verification.
- Complete live audit-immutability verification.
- Expand integration coverage around authenticated Supabase behavior.
- Formalize benchmark methodology.

## Product

- EDI auto-promotion into normalized claim/remittance records.
- Automation rule configuration UI.
- Additional appeal/evidence lineage where authoritative lifecycle boundaries are introduced.
- Broader payer integration workflows.

## Enterprise

- SSO.
- TOTP MFA enforcement.
- Multi-organization hierarchy.
- Expanded observability.
- Distributed tracing.
- Alerting and error budgets.
- Materialized views for high-cardinality reporting.

## EDI

Future transaction support may include:

- 270/271 eligibility;
- 276/277 claim status;
- 278 authorization;
- 999;
- TA1;
- additional payer validation levels.

## Intelligence

Future work may explore AI-assisted:

- denial pattern analysis;
- appeal recommendations;
- workflow assistance.

The current financial decision path remains deterministic.

---

# Documentation

| Document | Purpose |
|---|---|
| `DEV_SETUP.md` | Development setup and troubleshooting |
| `docs/SECURITY.md` | Security architecture and threat model |
| `docs/HIPAA_OVERVIEW.md` | Healthcare data and safeguard considerations |
| `docs/ACCESS_CONTROL_POLICY.md` | RBAC and access-control framework |
| `docs/DATA_CLASSIFICATION.md` | Data sensitivity and handling |
| `docs/INCIDENT_RESPONSE_PLAN.md` | Incident response procedures |
| `docs/RISK_REGISTER.md` | Known risks and mitigations |
| `HARDENING_PR_SUMMARY.md` | Hardening history |
| `PATCH_REPORT_PHASE1.md` | Phase 1 remediation history |
| `PHASE_3A_SUMMARY.md` | Operational workflow foundation |

---

# Screenshots

Screenshots and architecture diagrams will be added as the visual demonstration package is finalized.

The repository's primary evidence remains the source code, migrations, tests, and documented verification procedures.

---

# Engineering Approach

DualPay was developed using an iterative engineering and audit process:

    Build
      ↓
    Test
      ↓
    Audit
      ↓
    Identify Gaps
      ↓
    Remediate
      ↓
    Retest
      ↓
    Document

Several hardening passes focused specifically on:

- tenant isolation;
- database authorization;
- privileged function boundaries;
- scheduler correctness;
- durable job execution;
- retry/DLQ behavior;
- idempotency;
- replay;
- audit immutability;
- recovery lineage;
- X12 verification.

The project intentionally distinguishes between what is implemented and what has been independently or live-environment verified.

---

# Contributing

For development changes:

1. Create a feature branch from `main`.
2. Use descriptive branch prefixes such as:
   - `feat/`
   - `fix/`
   - `docs/`
   - `chore/`
3. Extend existing engines rather than duplicating business logic.
4. Add tests for engine and workflow changes.
5. Preserve organization-scoped authorization.
6. Do not expose service-role credentials to the browser.
7. New workflow actions should emit appropriate typed operational events where an authoritative lifecycle boundary exists.
8. Do not weaken RLS or authorization controls to make tests pass.

---

# License

See the repository license configuration.

---

# Author

**George Rios**

DualPay Core Ledger is an independent engineering project exploring deterministic healthcare reimbursement systems, secure multi-tenant application architecture, durable workflow execution, and auditable revenue-recovery operations.
