# nucleus-guardian-status

Server-side proxy to valtaris-nucleus's real, external `guardian-status`
API. Holds the nucleus API key so it never reaches the browser — same
pattern as `nucleus-adjudicate` and `nucleus-weaver-score`.

## Setup (required before this does anything)

This function returns HTTP 501 until both secrets are set:

```
supabase secrets set NUCLEUS_GUARDIAN_STATUS_URL=https://qrqekucwdfyqqzomuble.supabase.co/functions/v1/guardian-status
supabase secrets set NUCLEUS_API_KEY=<the key nucleus issued for client_id "dualpay">
```

Nucleus lives in the same Supabase project as DualPay now (post-consolidation --
`qrqekucwdfyqqzomuble`, not the old standalone `bpqukcsaoporhvdtfyza`
project), so this is a same-project HTTPS call, not a call to a
separate deployment.

`NUCLEUS_GUARDIAN_STATUS_URL` is named per-function deliberately:
Supabase Edge Function secrets are project-wide, not scoped to a
single function, so a plain `NUCLEUS_API_URL` would collide with the
other two proxies' own (different) URL secrets.

`NUCLEUS_API_KEY` is the **same** value `nucleus-adjudicate` and
`nucleus-weaver-score` use — one credential authorizes all three
nucleus endpoints. If either of those is already configured, this
function's `NUCLEUS_API_KEY` is already correct; you only need to add
`NUCLEUS_GUARDIAN_STATUS_URL`.

## What this does and doesn't do

Does: proxy a read-only status check to nucleus's Guardian kill
switch, returning `safe_to_process: true/false`. Logs to `ops_events`
only for non-routine outcomes (not configured, request failure, or an
active kill switch) — a routine "yes it's safe" check isn't logged,
since this endpoint is meant to be polled cheaply and often.

Doesn't: gate anything in this repo. No claim-submission or automation
path checks this today. Wiring a real gate to it — refusing to run
when `safe_to_process` is false — is a separate, deliberate decision:
smaller and lower-risk than swapping calculation logic, but still a
live-behavior change that deserves its own review.

## Request / response

```
GET (proxied as a POST invoke with no body, per supabase.functions.invoke's convention)
```

Response mirrors nucleus's own `guardian-status` — see that function's
README in the valtaris-nucleus repo:

```
{
  "safe_to_process": boolean,
  "kill_switch_active": boolean | null,
  "reason": string | null,
  "activated_by": string | null,
  "kill_switch_updated_at": string | null,
  "timestamp": string
}
```
