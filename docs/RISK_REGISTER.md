# DualPay — Risk Register (SOC 2 Lens)

**Framework:** AICPA TSC 2017 — Security, Availability, Confidentiality, Processing Integrity, Privacy.
**Scope:** Full DualPay codebase (React 18 + Vite frontend, Supabase Postgres + Auth + Storage + Edge Functions backend, deterministic adjudication engine, denial recovery, contract underpayment, EDI ingestion).
**Owner conventions:** Security = Security Officer, Eng = Engineering Lead, SRE = Platform/Reliability, Data = Data Eng, Product = Product Lead, Compliance = Compliance Officer, Legal = Legal Counsel.

**Likelihood / Impact scale:** Low / Medium / High.
**Status:** Open, Mitigating, Accepted, Closed.

---

| # | Risk | Likelihood | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| 1 | Cross-tenant data leakage via missing/incorrect RLS policy on a new table | Medium | High | Migration template mandates `ENABLE RLS` + `org_id` policies; `AdminSecurity` mirrors live inventory; PR checklist item; nightly Supabase linter | Eng | Mitigating |
| 2 | RLS bypass through `SECURITY DEFINER` function granted to `authenticated` | Medium | High | Restrict `EXECUTE` on `claim_next_queue_job` / `recover_stalled_queue_jobs` to `service_role`; audit all definer functions quarterly | Security | Open |
| 3 | Storage object accessed cross-org via forged path | Low | High | Storage RLS gates `org_id/` prefix via `is_org_member`; root uploads blocked | Eng | Closed |
| 4 | Signed URL for `evidence-documents` leaked and reused | Medium | High | Short-lived signed URLs; audit `document_uploaded` / `document_linked` ops events; rotate signing keys quarterly | SRE | Mitigating |
| 5 | Session token theft from browser `localStorage` (XSS) | Medium | High | Strict CSP; no `dangerouslySetInnerHTML`; input sanitization; token TTL + refresh rotation | Eng | Mitigating |
| 6 | MFA not enforced for `admin`/`owner` roles | High | High | Enable Supabase MFA; policy requires TOTP for elevated roles | Security | Open |
| 7 | Weak/reused passwords accepted at signup | Medium | Medium | Enable HIBP leaked-password protection via `configure_auth` | Security | Open |
| 8 | Privilege escalation via role stored on a client-editable table | Low | High | Roles live in `organization_members`; only `has_org_role` reads them; RLS forbids self-elevation | Eng | Closed |
| 9 | First-member org self-join abused to join arbitrary org | Low | High | Bootstrap-only policy applied in migration `20260710182913…` | Eng | Closed |
| 10 | JWT signing key rotation causes forced logout wave | Low | Medium | Documented rotation procedure; overlap window during rotation | SRE | Mitigating |
| 11 | Publishable anon key mistaken for a secret and exposed | Low | Low | Naming + docs distinguish publishable vs service-role; service-role key never in repo | Eng | Closed |
| 12 | Service-role key leaked via edge function log | Low | High | No secret echo in logs; edge function code reviewed; log scanning | SRE | Mitigating |
| 13 | PHI written to `ops_events.summary` in free text | Medium | High | Code-review invariant; add CI regex scan on `summary`; structured payload only | Eng | Open |
| 14 | PHI in browser console logs | Medium | Medium | Lint rule to ban `console.log(claim)` on PHI-bearing objects | Eng | Open |
| 15 | PHI cached in React Query beyond session | Low | Medium | In-memory only; cleared on logout; TTL on sensitive queries | Eng | Mitigating |
| 16 | Deterministic adjudication regressions from silent config drift | Medium | High | Config-as-Code with version pins; SHA-256 trace fingerprints; replay verifier | Eng | Closed |
| 17 | Duplicate payout via non-idempotent write | Medium | High | `idempotency_keys` table; canonical hashing; state machine guards | Eng | Closed |
| 18 | Stale test fixtures using non-UUID strings mask real integration bugs | High | Low | Regenerate fixtures to valid UUIDs; block CI on `invalid input syntax for type uuid` | Eng | Open |
| 19 | Supabase generated `types.ts` out-of-date causes `as any` casts | High | Medium | Auto-regenerate on migration merge; forbid new `as any` in CI | Eng | Mitigating |
| 20 | Dependency vulnerability (transitive npm) unpatched | High | Medium | Weekly `npm audit` + Dependabot; monthly review; SLA 30 days for high | Eng | Mitigating |
| 21 | Supply-chain attack via compromised npm package | Low | High | Lockfile pin; audit new deps; disable postinstall scripts where possible | Eng | Open |
| 22 | Vite build injects secret into client bundle via `VITE_` prefix mistake | Low | High | Only publishable keys are `VITE_`-prefixed; code review checklist | Eng | Closed |
| 23 | Edge function cold-start timeout drops job | Medium | Medium | Retry engine + dead-letter queue; `worker_registry` heartbeat; stalled-job recovery | SRE | Closed |
| 24 | Job queue starvation on high-priority backlog | Medium | Medium | `claim_next_queue_job` priority ordering; scheduler dispatcher fairness | SRE | Mitigating |
| 25 | Dead-letter queue grows unbounded | Medium | Low | DLQ retention + alert threshold; manual replay workflow | SRE | Open |
| 26 | Backup restore never rehearsed | High | High | Quarterly PITR restore drill; document RPO/RTO | SRE | Open |
| 27 | Data loss window between snapshots (no PITR configured) | Low | High | Verify PITR enabled on hosting tier | SRE | Mitigating |
| 28 | Storage bucket accidentally set public | Low | High | Buckets `evidence-documents` + `appeal-packets` private; workspace policy blocks public; alert on config change | Security | Closed |
| 29 | Denial-of-service via unbounded query on operational tables | Medium | Medium | Server-side pagination; row limits (`limit(1000)` on ops_events); index review | Eng | Mitigating |
| 29b | `claim_assignments_update_demo` policy granted UPDATE on any row `TO public` unconditionally (`qual=true`), bypassing org scoping entirely | High | High | Dropped in `20260924224814_dualpay_rls_perf_and_demo_policy_fix.sql` | Eng | Closed |
| 30 | Slow queries block adjudication pipeline | Medium | Medium | Query monitoring; indexes on `org_id`, `claim_id`, `status`, `occurred_at` | Data | Mitigating |
| 31 | Missing index on frequently filtered columns | Medium | Medium | Quarterly index review via Supabase `slow_queries` tool | Data | Open |
| 32 | Schema migration deployed without corresponding types/UI changes | Medium | Medium | Migration + type-regeneration + code deploy tied in release runbook | Eng | Mitigating |
| 33 | Ad-hoc `psql` change bypasses migration history | Low | High | Policy: all schema changes via migrations; audit `pg_stat_activity` | Data | Mitigating |
| 34 | Failed migration leaves DB in inconsistent state | Low | High | Transactional migrations; pre-prod verification; rollback plan | Eng | Mitigating |
| 35 | Auth email delivery fails (password reset, invites) | Medium | Medium | Configure custom email domain + SPF/DKIM/DMARC; monitor bounce | SRE | Open |
| 36 | Invite token reused / not expired | Low | Medium | `invite-member` edge function issues single-use tokens with expiry | Eng | Mitigating |
| 37 | Google OAuth misconfigured redirect leaks tokens | Low | High | Redirect URIs pinned to app origin; reviewed on deploy | Eng | Closed |
| 38 | SAML SSO not available for enterprise buyers | Medium | Low | Roadmap: enable Supabase SAML SSO; blocker for enterprise deals | Product | Open |
| 39 | Audit log gap for `SELECT` on PHI tables | High | Medium | Postgres does not log SELECT by default; add sampled query logging or app-layer view tracking | Security | Open |
| 40 | Audit log retention < 6 years (HIPAA §164.316) | Medium | High | Formalize 6-year retention; archival job | Compliance | Open |
| 41 | Actor spoofing in `ops_events` (client-supplied actor) | Low | Medium | Server resolves actor from Supabase session in `appendOpsEvent`; client `actor` field ignored on trust boundary | Eng | Closed |
| 42 | Trace tampering post-write | Low | High | SHA-256 fingerprint + trace-verifier; append-only table via RLS (no UPDATE/DELETE policy for non-admins) | Eng | Mitigating |
| 43 | Replay ledger corrupted, defeating dispute defense | Low | High | Immutable RLS on `replay_ledger_events`; content-hashed | Eng | Mitigating |
| 44 | Contract terms mis-imported → systematic underpayment miscalc | Medium | High | Contract-import validation; `contract_matched` event; explainability traces | Data | Mitigating |
| 45 | Fee schedule stale → wrong "expected paid" baselines | Medium | High | `fee_schedules` versioned; effective-date logic; monitoring for coverage gaps | Data | Open |
| 46 | Payer performance scoring biased by low sample size | Medium | Low | Minimum-sample thresholds; confidence intervals on payer profiles | Data | Mitigating |
| 47 | Automation rule fires on wrong org due to config bleed | Low | High | Rules scoped to `org_id`; automation-job payload validated | Eng | Mitigating |
| 48 | Runaway automation rule floods `automation_jobs` | Medium | Medium | Rate limits; kill-switch in `AutomationRules` UI; DLQ escalation | SRE | Mitigating |
| 49 | Rule change deployed without dry-run | Medium | Medium | Simulation mode in engine; require sim-approval before enabling | Product | Open |
| 50 | Edge function invoked without JWT verification | Low | High | `verify_jwt = true` in `supabase/config.toml` for all authenticated functions | Eng | Mitigating |
| 51 | CORS misconfiguration allows unauthorized origin | Low | Medium | Explicit `corsHeaders`; review on every edge function | Eng | Mitigating |
| 52 | Rate limiting absent → credential-stuffing on `/login` | Medium | Medium | Supabase Auth rate limits enabled; monitor auth logs | Security | Mitigating |
| 53 | Password reset link intercepted | Low | Medium | Time-limited tokens; single-use; TLS-only email links | Security | Mitigating |
| 54 | Insufficient logging of failed auth attempts | Medium | Medium | Enable auth-log export; alert on threshold | Security | Open |
| 55 | Departing employee retains org access | Medium | High | Offboarding runbook: remove `organization_members` row + revoke sessions | Compliance | Open |
| 56 | Contractor access not time-bound | Medium | Medium | Add `expires_at` on `organization_members`; nightly cleanup job | Compliance | Open |
| 57 | No documented data classification / handling policy | High | Medium | Published `docs/DATA_CLASSIFICATION.md` | Compliance | Closed |
| 58 | No BAA on file with a third-party subprocessor | Medium | High | Inventory subprocessors; execute BAAs (hosting, email, error monitoring) | Legal | Open |
| 59 | Error-monitoring tool captures PHI in stack traces | Medium | High | Redact request bodies; PII/PHI scrubbing before send | Eng | Open |
| 60 | Analytics tool receives PHI via URL params | Low | High | No PHI in URLs; verified via route audit | Eng | Closed |
| 61 | Dev/staging DB refreshed from prod without de-identification | Medium | High | Prohibit prod → lower-env restore of PHI; synthetic fixtures only | Data | Open |
| 62 | Local `.env` with secrets committed | Low | High | `.gitignore` covers env files; secret scanning in CI | Eng | Mitigating |
| 63 | AI/LLM feature sends PHI to third-party model | Medium | High | Route via Lovable AI Gateway with BAA; redact before prompt; policy review before enabling | Eng | Open |
| 64 | Prompt-injection in appeal-draft LLM leaks other tenants' data | Low | High | Isolate context per request; no cross-tenant retrieval; server-side prompt template | Eng | Open |
| 65 | CSV export unfiltered exposes bulk PHI | Medium | Medium | Export gated by role; audit log entry; row-count cap | Product | Open |
| 66 | Print/PDF generation renders more fields than intended | Low | Medium | Whitelist fields in `pdf-appeal`; review templates | Eng | Mitigating |
| 67 | Uploaded file with malicious content (malware, macro) | Medium | Medium | MIME allow-list enforced in `EvidenceUploader`; add server-side AV scan | Security | Open |
| 68 | Zip-bomb / oversized upload DoS | Low | Medium | File-size cap; timeout on upload; storage quota per org | Eng | Open |
| 69 | Trace hash function change breaks replay integrity | Low | High | Hash algorithm versioned in trace payload; migration path required for change | Eng | Mitigating |
| 70 | Timezone/UTC drift causes DOS misalignment on claims | Low | Medium | All timestamps stored as `timestamptz`; UTC in payloads | Data | Closed |
| 71 | ISO-4217 rounding regression causes penny drift | Low | High | Deterministic rounding in `calculation-engine`; unit tests | Eng | Closed |
| 72 | State machine allows illegal transition | Low | High | Guards enforced; state-machine tests; ops event on every transition | Eng | Closed |
| 73 | Case re-open loses prior evidence links | Low | Medium | `case_claim_links` append-only; `case_events` timeline | Eng | Closed |
| 74 | Recovery outcome overwritten silently | Low | Medium | Append-only `recovery_outcomes`; corrections via new row + reason | Eng | Mitigating |
| 75 | Duplicate dispute created for same claim | Medium | Low | `dispute_duplicate_skipped` event; unique constraint on `(claim_id, active)` | Eng | Mitigating |
| 76 | EDI 837 payload retained longer than payer contract allows | Medium | Medium | Retention policy per data class; purge job on `edi_transactions` | Compliance | Open |
| 77 | EDI ingestion fails silently, backlog builds | Medium | High | `edi_errors` + `edi_rejected` alerting; SLA on unprocessed batches | SRE | Mitigating |
| 78 | Direct clearinghouse link uses expired cert | Low | High | Cert inventory + auto-renew (Let's Encrypt / vendor); pre-expiry alert | SRE | Open |
| 79 | No formal vendor risk assessment | High | Medium | Annual vendor review; SOC 2 reports collected from each subprocessor | Compliance | Open |
| 80 | No penetration test in past 12 months | High | Medium | Annual third-party pen test | Security | Open |
| 81 | No formal SDLC / change-management policy documented | High | Medium | Publish SDLC policy; PR review + approval evidence retained | Eng | Open |
| 82 | Deploys not tied to ticket/change record | Medium | Low | Enforce PR → change-record linkage; deploy log | Eng | Open |
| 83 | Production access shared across engineers | Medium | Medium | Named accounts only; JIT elevation; audit trail | SRE | Open |
| 84 | No documented capacity plan | Medium | Medium | Baseline load model; quarterly review; auto-scale where available | SRE | Open |
| 85 | Single-region hosting → regional outage impacts all customers | Medium | High | Document RTO for regional failover; consider multi-region for enterprise tier | SRE | Open |
| 86 | No status page / customer communication channel | Medium | Low | Publish status page; incident-comms template | Product | Open |
| 87 | Missing DPA / privacy notice for end-user data | Medium | Medium | Publish privacy policy + DPA template | Legal | Open |
| 88 | No formal Security Officer / Privacy Officer named | High | High | Assign roles; document in policy | Compliance | Open |
| 89 | No workforce security-awareness training | High | Medium | Annual training + attestation | Compliance | Open |
| 90 | No sanction policy for HIPAA violations | Medium | Medium | Publish sanction policy per §164.308(a)(1)(ii)(C) | Compliance | Open |
| 91 | No documented risk analysis (§164.308(a)(1)(ii)(A)) | High | High | Complete formal Security Risk Analysis; refresh annually | Compliance | Open |
| 92 | Session fixation on OAuth callback | Low | Medium | Supabase rotates session on OAuth; state param validated | Eng | Closed |
| 93 | Open redirect on `?from=` query param at login | Low | Medium | Validate redirect target is same-origin path; reject external URLs | Eng | Mitigating |
| 94 | Clickjacking on admin routes | Low | Low | `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'` | Eng | Open |
| 95 | Missing security headers (HSTS, CSP, Referrer-Policy) | Medium | Medium | Add via hosting config; verify with securityheaders.com | Eng | Open |
| 96 | Verbose error messages leak schema / stack | Medium | Low | Generic client errors; detailed logs server-side only | Eng | Mitigating |
| 97 | Test/dev seed data contains real names | Medium | Medium | Replace with faker-generated synthetic data | Data | Open |
| 98 | Backup export not encrypted before off-cloud transfer | Low | High | Any ad-hoc export encrypted with age/GPG; documented custodian | SRE | Open |
| 99 | No breach-notification runbook / template letters | Medium | High | Draft §164.404/§164.408 notification templates + escalation tree | Compliance | Open |
| 100 | No independent SOC 2 audit / HIPAA attestation | High | High | Engage SOC 2 Type I in next 6 months; Type II thereafter | Compliance | Open |

---

## Summary

- **Total risks:** 101
- **Open:** 45 · **Mitigating:** 33 · **Closed:** 23
- **Top themes (by count of Open + Mitigating):** governance & policy gaps (retention, IR runbook, officer designations, workforce training), audit-log completeness, MFA/HIBP, vendor/BAA management, and DR rehearsal.

## Cross-references

- `/docs/HIPAA_OVERVIEW.md` — HIPAA control narrative
- `src/pages/AdminSecurity.tsx` — live RLS inventory
- `supabase/migrations/` — versioned policy history
