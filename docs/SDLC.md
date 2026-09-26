# DualPay — Software Development Lifecycle Policy

**Document owner:** Engineering
**Audience:** Internal engineering, auditors, prospective customers
**Status:** Internal working draft — reflects current implementation as of this revision
**Companions:** [`RISK_REGISTER.md`](./RISK_REGISTER.md) (risks #81, #82), [`SECURITY.md`](./SECURITY.md), [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md)

Each control below is marked **Implemented** (present in the repo/CI today, traceable to a specific file) or **Unverified** (depends on a GitHub repository setting this document can't confirm from inside the codebase — a repo admin should check it against §2 and mark it Implemented once confirmed). No control is claimed that cannot be traced to a file, workflow, or migration.

---

## 1. Change flow

**Implemented**

Every change to this repository goes through:

1. A pull request against `main`, describing the change and, per §3 below, linking the change record that motivated it.
2. Automated CI (`.github/workflows/ci.yml`) on every push and PR: `npm run lint`, `npm test`, `npm run build`. All three must pass.
3. The **Change Record Check** (`.github/workflows/change-record-check.yml`, added alongside this policy) fails the PR if its description has no filled-in `## Change Record` section — see §3.
4. Merge. Supabase schema changes go out as versioned migration files (`supabase/migrations/*.sql`), applied and verified against the live project as part of the same change (see §4) — the migration file itself, plus the PR that added it, is the deploy record.

## 2. Branch protection

**Unverified from inside this repository** — GitHub branch protection rules (requiring the CI check and the Change Record Check to pass before a PR can merge to `main`, disallowing force-push to `main`) live in repository settings, not in a file this document can inspect or that a workflow run can prove from the outside. A repository admin should confirm, at github.com/&lt;org&gt;/dualpay/settings/branches, that `main` requires:
- `Lint · Test · Build` to pass
- `change-record-check` to pass
- at least one approving review (once the team is larger than one)

and mark this section **Implemented** once confirmed. Until then, the checks in §1 are real and running, but nothing stops a direct push to `main` that skips them.

## 3. Change record linkage (risk #82)

**Implemented**

Every PR description must include a filled-in `## Change Record` section (see `.github/pull_request_template.md`). It's satisfied by any one of:
- a linked GitHub issue (`Fixes #123`, `Closes #123`, `Relates to #123`), or
- a reference to a `docs/RISK_REGISTER.md` row (`Risk #NN`), or
- a reference to a `src/nucleus/ops/gapMap.md` item, for cross-repo ecosystem work, or
- for anything else, one sentence naming what prompted the change and why.

`change-record-check.yml` fails the PR if that section is missing or still contains only the template's placeholder text. This is deliberately loose about *what* the record is — this project doesn't run a formal ticketing system today — but it makes every merged PR carry a human-readable answer to "why did this change happen," which is what risk #82 actually asked for.

## 4. Migration & deployment review (risk #81)

**Implemented**

Every Supabase schema change ships as a new file under `supabase/migrations/`, reviewed in the same PR as any application code that depends on it. Before a migration is applied to the live project:
- destructive statements (`DROP`, `DELETE`, `ALTER ... DROP COLUMN`) are called out explicitly in the migration's own comment header, with the reasoning;
- a migration that changes RLS policies or grants is dry-run tested in a rolled-back transaction against the live project first, then applied, then verified with a real query as both an authorized and an unauthorized caller — not just checked for SQL syntax.

`supabase migration list` (or the equivalent `list_migrations` call against the live project) is the authoritative deploy log for schema changes — every applied migration is timestamped and named, in order, with no separate deploy-tracking system needed.

Frontend deploys are tracked by the hosting platform's own deployment history (visible on each PR via its preview-deployment check) — no separate change record is needed there beyond the PR itself.

## 5. Rollback

**Implemented (process), Unverified (rehearsed)**

A bad migration is rolled back by a new forward migration that reverses it — this repo does not rewrite or delete already-applied migration files, matching the project's own established convention. A bad frontend deploy is rolled back via the hosting platform's redeploy-previous-version control. Neither has been rehearsed as a formal drill; see `docs/RISK_REGISTER.md` risk #26 for the open item covering that.

---

## Cross-references

- `docs/RISK_REGISTER.md` — risks #81 (this policy) and #82 (change-record linkage), and #26 (restore/rollback drill, still open)
- `.github/workflows/ci.yml` — lint/test/build gate
- `.github/workflows/change-record-check.yml` — change-record linkage gate
- `.github/pull_request_template.md` — the template that carries the Change Record section
