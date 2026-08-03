# Claim Clarity / DualPay Core Ledger

Enterprise healthcare reimbursement intelligence platform for denial recovery, claim transparency, COB/payment logic, recovery operations, recovery factory ingestion, remittance intelligence, and executive value realization.

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
