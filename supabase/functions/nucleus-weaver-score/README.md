# nucleus-weaver-score

Server-side proxy to valtaris-nucleus's real, external `weaver-score`
API. Holds the nucleus API key so it never reaches the browser — same
pattern as `nucleus-adjudicate`.

## Setup (required before this does anything)

This function returns HTTP 501 until both secrets are set:

```
supabase secrets set NUCLEUS_WEAVER_SCORE_URL=https://qrqekucwdfyqqzomuble.supabase.co/functions/v1/weaver-score
supabase secrets set NUCLEUS_API_KEY=<the key nucleus issued for client_id "dualpay">
```

Nucleus lives in the same Supabase project as DualPay now (post-consolidation --
`qrqekucwdfyqqzomuble`, not the old standalone `bpqukcsaoporhvdtfyza`
project), so this is a same-project HTTPS call, not a call to a
separate deployment.

`NUCLEUS_WEAVER_SCORE_URL` is named per-function deliberately: Supabase
Edge Function secrets are project-wide, not scoped to a single
function, so a plain `NUCLEUS_API_URL` would collide with
`nucleus-adjudicate`'s own (different) URL secret.

`NUCLEUS_API_KEY` is the **same** value `nucleus-adjudicate` uses — one
credential authorizes both nucleus endpoints. If `nucleus-adjudicate`'s
secrets are already set, this function's `NUCLEUS_API_KEY` is already
correct; you only need to add `NUCLEUS_WEAVER_SCORE_URL`.

## What this does and doesn't do

Does: proxy a scoring request to nucleus's Weaver engine, log the
outcome to `ops_events` (`nucleus_weaver_score_completed` /
`nucleus_weaver_score_failed` / `nucleus_weaver_score_not_configured`),
return nucleus's response unchanged.

Doesn't: change what this repo's own scoring/heuristic code
(`automation-rules.ts`, `next-action.ts`, etc.) does today. The client
helper for this proxy (`src/engine/nucleus-weaver-client.ts`) is ready
to use, but wiring a real call site to it is a separate, deliberate
decision.

## Request shape

Same as nucleus's own `weaver-score` — see that function's README in
the valtaris-nucleus repo. This proxy forwards the body unchanged:

```
{
  "stage": "opportunity" | "recommendation",
  "claim_id": "string (optional)",
  "facts": { "...": "arbitrary object; see nucleus's weaver-score README" }
}
```
