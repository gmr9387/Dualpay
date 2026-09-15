# nucleus-adjudicate

Server-side proxy to valtaris-nucleus's real, external `adjudicate-claim`
API. Holds the nucleus API key so it never reaches the browser — the
same server-boundary pattern `scheduler-dispatcher` already uses for
`worker-dispatcher`.

## Setup (required before this does anything)

This function returns HTTP 501 until both secrets are set:

```
supabase secrets set NUCLEUS_ADJUDICATE_URL=https://bpqukcsaoporhvdtfyza.supabase.co/functions/v1/adjudicate-claim
supabase secrets set NUCLEUS_API_KEY=<the key nucleus issued for client_id "dualpay">
```

`NUCLEUS_ADJUDICATE_URL` is named per-function deliberately: Supabase
Edge Function secrets are project-wide, not scoped to a single
function, so a plain `NUCLEUS_API_URL` would collide with
`nucleus-weaver-score`'s own (different) URL secret. `NUCLEUS_API_KEY`
is shared on purpose — it's the same credential for both.

Neither belongs in `.env` / `.env.example` (those are documented as
`VITE_`-prefixed only, since anything there ships to the browser).

## What this does and doesn't do

Does: proxy a claim to nucleus, log the outcome to `ops_events`
(`nucleus_adjudicate_completed` / `nucleus_adjudicate_failed` /
`nucleus_adjudicate_not_configured`), return nucleus's response
unchanged.

Doesn't: change what `ClaimsWorkbench.tsx`, `Index.tsx`, or
`case-management.ts` actually call today — they still run this repo's
own local `executeAdjudicationWithReplay()`. The client helper for this
proxy (`src/engine/nucleus-adjudication-client.ts`) is ready to use, but
wiring a real call site to it is a separate, deliberate decision: it
changes a live financial-calculation path and deserves review on its
own terms, not a change bundled in with this plumbing.

## Request shape

Same as nucleus's own `adjudicate-claim` — see that function's README
in the valtaris-nucleus repo. This proxy forwards the body unchanged.
