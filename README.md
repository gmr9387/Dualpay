DualPay Core Ledger
A healthcare reimbursement system built to connect claims, remittance information, reimbursement calculations, denial intelligence, contract analysis, recovery operations, evidence, appeals, and outcomes in one auditable workflow. DualPay is built around deterministic financial logic, organization scoped authorization, durable background processing, persisted workflow state, and clear auditability.

DualPay is a portfolio engineering project and research implementation. It is not represented as HIPAA certified, SOC 2 certified, or commercially production deployed.

Overview
DualPay brings together reimbursement information that is usually scattered across claims, remittance files, denial codes, payer contracts, evidence, appeals, assignments, and recovery outcomes.

The design is simple.
Claims and remittance lines enter the system.
They are validated and normalized.
Deterministic engines apply reimbursement rules.
Denials and underpayments are detected.
Recovery workflows move forward.
Every step is recorded.

Why This Exists
Reimbursement problems are not just calculation problems.
They are workflow problems.
They are audit problems.
They involve multiple systems, multiple rules, and multiple decisions that must be traceable.

DualPay explores how these processes can be represented as a deterministic, multi tenant application with durable background execution and database enforced authorization.

What DualPay Does
Reimbursement and Adjudication
Fee schedules
Deductibles
Coinsurance
Accumulators
Multiple payer allocation
Primacy validation
Deterministic rounding
Adjudication traces
Replay records

Denial Intelligence
CARC and RARC classification
Recoverability scoring
Severity scoring
Evidence requirements
Recommended actions
Playbook assignment

Contract Recovery
Contract matching
Effective date selection
Fee schedule matching
Fixed reimbursement
Case reimbursement
Per diem reimbursement
Percent of billed reimbursement
Percent of Medicare reimbursement
Expected reimbursement calculation
Variance detection
Idempotent dispute creation

X12 EDI
Native processing for
835 remittance
837P professional claims
837I institutional claims

Includes parsing, validation, envelope checks, and normalization.

Recovery Operations
Cases
Disputes
Assignments
Worklists
Evidence
Appeal packets
Appeal lifecycle
Recovery outcomes
Payer scorecards
Recovery reporting

Automation
Durable jobs
Server side workers
Scheduler dispatch
Retry handling
Exponential backoff
Dead letter queue
Pipeline orchestration
Job telemetry

Capability Status
Implemented and Evidence Verified
Security definer boundaries
Durable jobs
Scheduler
Retry and dead letter behavior
Contract recovery
Denial detection

Implemented and Validation Pending
Multi tenant organization model
PostgreSQL RLS
RBAC
Ops event immutability
Storage isolation
X12 835
X12 837P
X12 837I
Replay verification
Persisted idempotency
Recovery lineage
Recovered value attribution

Roadmap
Evidence lineage
Appeal lineage
Executive attribution
MFA enforcement
Performance benchmarking
Commercial deployment

Not Implemented or Not Authorized
External certification
Regulated production authorization

Architecture
Frontend
React application
TypeScript
Vite
Tailwind
shadcn
TanStack Query

Backend
Supabase
PostgreSQL
PostgREST
Supabase Auth
Supabase Storage
Edge Functions

Engine Layer
Deterministic reimbursement logic
COB rules
Denial intelligence
Contract matching
Underpayment detection
Replay and fingerprinting

Everything is stored in PostgreSQL.
Everything is organization scoped.
Everything is auditable.

Core Workflows
Claim and Remittance Import
CSV or X12
Validation
Mapping
Batch commit
Claims and remittance lines
Lineage

Denial Detection
Remittance
Classification
Denial
Denial detected
Recovery analysis

Contract Recovery
Candidate discovery
Contract matching
Expected reimbursement
Variance
Underpayment dispute
Underpayment detected
Dispute created

Case Generation
Recovery opportunity
Case creation
Case claim links
Case created

Denial Recovery Workflow
Denial
Recoverability
Assignment
Evidence
Appeal packet
Appeal
Outcome

Security Architecture
Authentication
Supabase Auth provides identity.
Authorization uses organization membership and role checks.

Authorization
Five roles
viewer
analyst
manager
admin
owner

Authorization is enforced through RLS, security definer functions, and application guards.

Multi Tenant Isolation
Records are organization scoped.
Policies enforce isolation.
Tests verify isolation boundaries.

Security Definer Functions
Reviewed for safe search path, membership checks, and role checks.

Audit Logging
Ops events are append only.
Events record actor, organization, event kind, references, payload, and timestamp.

Input Validation
Validation occurs at import, X12 parsing, Zod schemas, and database constraints.

Database Design
DualPay uses PostgreSQL domains for claims, adjudication, replay, idempotency, operations, cases, recovery, import, evidence, contracts, automation, EDI, lineage, and identity.

Relationships connect claims to adjudication runs, remittance lines to disputes, cases to claims, and outcomes to reporting.

Indexes support organization scoped queries and recovery workflows.

Background Processing
Job Lifecycle
queued
claimed
running
completed
failed
retry
dead letter

Scheduler
Dispatches work
Records results
Persists failure telemetry

X12 EDI
Processes X12 835, 837P, and 837I transactions.

Pipeline includes parsing, envelope validation, structural validation, normalization, and canonical representation.

Lineage and Auditability
DualPay records lineage for claim creation, denial detection, underpayment detection, case creation, dispute creation, and outcomes.

Evidence and appeal lineage are planned.

Replay and Idempotency
Replay records
Fingerprints
Deterministic adjudication
Deduplication keys
Persisted idempotency for important operations
Universal idempotency not claimed

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

Installation
Clone the repository
Install dependencies
Create environment file
Push migrations
Run development server

Configuration
Supabase URL
Supabase anon key
Demo mode flag
Server side secrets configured in Supabase

Testing and Verification
Application Tests
Adjudication
COB
Workflows
Scheduler behavior
Retry behavior
Lineage
RLS behavior
Storage logic
X12 processing

Database Tests
pgTAP suite for RLS and security boundaries
Live database verification pending

Deployment
Build the application
Deploy edge functions
Configure secrets
Run migrations

Performance and Scalability
DualPay is structured for scalable execution.
Formal benchmarking has not been completed.
No throughput or latency claims are made.

Security and Compliance Positioning
DualPay includes security controls for healthcare oriented design.
DualPay is not represented as HIPAA certified, SOC 2 certified, audited, or production authorized.

Known Limitations
Live database verification pending
Storage verification pending
Idempotency scope limited
Lineage incomplete for evidence and appeals

Roadmap
Evidence lineage
Appeal lineage
Executive attribution
Performance testing
Compliance posture
Production deployment

Current Status
DualPay has a substantial implementation and a clear architecture. Many parts are supported by evidence. Some parts need more verification. DualPay is ready for deeper validation and real world testing.
