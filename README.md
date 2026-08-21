DualPay Core Ledger
A healthcare reimbursement system for structured adjudication, denial intelligence, contract recovery, durable background execution, and auditable financial workflows.

DualPay Core Ledger is a reimbursement operations system designed to unify claims, remittance information, reimbursement calculations, denial classification, contract analysis, recovery workflows, evidence, appeals, and outcomes into one auditable workflow.

It is a portfolio engineering project and research implementation. It is not represented as HIPAA certified, SOC 2 certified, or commercially production deployed.

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

Engineering Incidents
DualPay produced several useful corrections:

lineage boundaries clarified

idempotency scope corrected

scheduler failure handling improved

storage isolation tested

X12 validation hardened

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
Contract recovery	Implemented
Durable jobs	Implemented
Scheduler	Implemented
Replay	Implemented
Idempotency	Partial
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
