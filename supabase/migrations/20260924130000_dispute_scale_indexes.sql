-- Load-test finding: at 100k rows, underpayment_disputes' default
-- (org_id, created_at DESC) query had no supporting index and spilled to
-- disk for the sort (533ms, 24MB temp file). Confirmed fix: 68ms, no disk
-- spill. A second index covers the now-common (org_id, direction,
-- created_at) shape used by Contract Recovery (underpayment) and Payer
-- Findings (overpayment), which previously fetched the whole org's
-- disputes table and filtered by direction client-side (195ms, still
-- disk-spilling) -- with the index, 42ms and only the needed rows cross
-- the wire.
--
-- Both indexes are kept: ContractsHome, ContractAnalytics, and
-- job-runner.ts still query all directions for an org, which the plain
-- (org_id, created_at) index serves; Contract Recovery and Payer Findings
-- now query a single direction, served by the composite index.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_underpayment_disputes_org_created
  ON dualpay.underpayment_disputes (org_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_underpayment_disputes_org_direction_created
  ON dualpay.underpayment_disputes (org_id, direction, created_at DESC);

-- Same finding, same fix, on claims.loadClaims()'s (org_id, service_date_from)
-- sort: 126ms with a disk-spilling sort -> 79ms with this index. This does
-- NOT fix the larger issue that loadClaims() has no pagination and fetches
-- every claim's full payload for the org on every load -- that's a real,
-- separate, larger gap documented alongside this migration, not silently
-- fixed here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claims_org_service_date
  ON dualpay.claims (org_id, service_date_from ASC);
