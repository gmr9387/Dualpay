-- Risk #31 (docs/RISK_REGISTER.md): missing index on frequently filtered
-- columns. Found live via pg_constraint/pg_index (foreign keys with no
-- covering index on the referencing column) and a direct check for
-- org_id columns -- the column every dualpay RLS policy filters on via
-- is_org_member/has_org_role -- with no index at all.
--
-- Every FK below forces a full table scan of the child table on any
-- UPDATE/DELETE of the parent row (Postgres has to verify no orphaned
-- rows exist), and every org_id below forces a full table scan on every
-- RLS-filtered SELECT once these tables have real data. All target
-- tables are currently empty, so this is free today and expensive to
-- add later once these tables hold production rows.

create index if not exists idx_case_events_claim_id on dualpay.case_events (claim_id);
create index if not exists idx_claim_assignments_assigned_by_user_id on dualpay.claim_assignments (assigned_by_user_id);
create index if not exists idx_evidence_documents_parent_document_id on dualpay.evidence_documents (parent_document_id);
create index if not exists idx_underpayment_disputes_contract_id on dualpay.underpayment_disputes (contract_id);
create index if not exists idx_edi_errors_segment_id on dualpay.edi_errors (segment_id);
create index if not exists idx_edi_errors_resolved_by on dualpay.edi_errors (resolved_by);

create index if not exists idx_edi_errors_org_id on dualpay.edi_errors (org_id);
create index if not exists idx_edi_segments_org_id on dualpay.edi_segments (org_id);
create index if not exists idx_fee_schedules_org_id on dualpay.fee_schedules (org_id);
