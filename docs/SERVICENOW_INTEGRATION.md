# ServiceNow Integration

Bidirectional sync between a DualPay recovery case (`appeal_recovery_cases`)
and a ServiceNow Case (Customer Service Management, falling back to Incident
if CSM isn't active on your instance). See
`supabase/migrations/20260929120000_servicenow_sync.sql` and
`supabase/functions/servicenow-sync` / `servicenow-webhook` for the DualPay
side. This document is the ServiceNow side: everything below runs inside
ServiceNow Studio, not this repo.

## Architecture

```
DualPay (Postgres)                          ServiceNow
───────────────────                         ──────────
appeal_recovery_cases INSERT/UPDATE
  │ trigger → net.http_post
  ▼
servicenow-sync (Edge Function)  ──OAuth──▶  Scripted REST API
  writes servicenow_sys_id/number             (creates/updates a Case,
  back onto the row                            keyed by correlation_id)

                                              Case state → Resolved/Closed
                                                │ Business Rule
                                                ▼
servicenow-webhook (Edge Function) ◀──POST── Outbound REST call
  calls rpc_apply_servicenow_update()          (shared-secret auth)
  advances the DualPay case
```

## 1. Prerequisites

1. A ServiceNow Personal Developer Instance (or any dev/sandbox instance you
   can install applications and register OAuth clients on).
2. Confirm whether CSM is active: **System Applications → All Available
   Applications → All**, search "Customer Service Management." If it's not
   there or not activated, use `incident` as the target table everywhere
   below instead of `sn_customerservice_case` — set
   `SERVICENOW_TARGET_TABLE=incident` on the DualPay side (see §7) and point
   the Business Rule in §5 at the `incident` table.

## 2. Create a scoped application

**Studio → Create Application.** Name it `DualPay Sync`. Note the scope
prefix ServiceNow assigns you (commonly `x_<vendor>_dualpay` — the exact
prefix depends on your instance). Every artifact below (the Scripted REST
API's API namespace, the system property) lives in this scope. Substitute
your actual scope prefix wherever this doc says `x_snc_dualpay`.

## 3. Register an OAuth application (inbound, DualPay → ServiceNow)

**System OAuth → Application Registry → New → "Create an OAuth API endpoint
for external clients."**

- Name: `DualPay Sync`
- Client ID: generated for you — copy it
- Client Secret: generated for you — copy it
- Check which grant types your release offers on this form. You want
  **Client Credentials** (server-to-server, no end user). If your release's
  application registry doesn't expose client-credentials directly, use the
  "Resource Owner Password Credentials" grant with a dedicated low-privilege
  integration user instead, and note that in the config below.

Save the client ID and secret — they become `SERVICENOW_CLIENT_ID` /
`SERVICENOW_CLIENT_SECRET` on the DualPay side (§7).

## 4. Scripted REST API (inbound endpoint DualPay calls)

**System Web Services → Scripted REST APIs → New.**

- Name: `DualPay Sync`, API ID: `dualpay_sync` (this is what makes the path
  `/api/<scope>/dualpay_sync/...`)
- Under it, **New Resource**: Name `case`, HTTP method `POST`, relative path
  `/case`.
- This resource is automatically protected by whatever OAuth profile you
  assign it — leave "Requires authentication" checked. ServiceNow validates
  the Bearer token from §3 before your script below ever runs.

Resource script:

```javascript
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
    var body = request.body.data || {};
    var correlationId = body.correlation_id;
    var targetTable = body.target_table || 'sn_customerservice_case';

    if (!correlationId) {
        response.setStatus(400);
        response.setBody({ error: 'correlation_id is required' });
        return;
    }

    var gr = new GlideRecord(targetTable);
    var found = gr.get('correlation_id', correlationId);
    if (!found) {
        gr.initialize();
        gr.correlation_id = correlationId;
    }

    gr.short_description = body.short_description || ('DualPay recovery case - claim ' + body.claim_id);
    gr.description = 'DualPay claim: ' + body.claim_id +
        '\nState: ' + body.state +
        '\nPayer response: ' + (body.payer_response_status || '(none yet)') +
        '\nRecovered so far: $' + (((body.recovered_amount_cents || 0) / 100).toFixed(2));
    gr.work_notes = 'DualPay sync: state=' + body.state;

    var sysId = found ? (gr.update() && gr.getUniqueValue()) : gr.insert();
    if (!sysId) {
        response.setStatus(500);
        response.setBody({ error: 'Failed to write record: ' + gr.getLastErrorMessage() });
        return;
    }

    gr.get(sysId);
    response.setStatus(found ? 200 : 201);
    response.setBody({
        sys_id: sysId,
        number: gr.getValue('number'),
        table: targetTable
    });
})(request, response);
```

`correlation_id` / `correlation_display` are out-of-box fields on `task`
(and therefore on both `sn_customerservice_case` and `incident`) meant
exactly for this — carrying an external system's own record id so a re-sync
updates the same record instead of duplicating it.

## 5. System property for the webhook shared secret

**System Properties → New** (or find your scope's properties list):

- Name: `x_snc_dualpay.webhook_secret`
- Type: Password (2-way encrypted) if your instance offers that type,
  otherwise a plain string property
- Value: generate a long random string — this same value becomes
  `SERVICENOW_WEBHOOK_SECRET` on the DualPay side (§7)

## 6. Business Rule (outbound, ServiceNow → DualPay on resolution)

**System Definition → Business Rules → New**, on table
`sn_customerservice_case` (or `incident` if using the fallback):

- When: **after**, Update: checked, Insert: unchecked
- Advanced: checked (to enable the script field)

```javascript
(function executeRule(current, previous /*null when async*/) {
    if (!current.state.changes()) return;

    var stateLabel = current.getDisplayValue('state');
    var resolutionMap = {
        'Resolved': 'recovered',
        'Closed Complete': 'recovered',
        'Closed': 'closed_no_recovery',
        'Closed Incomplete': 'closed_no_recovery'
    };
    var resolutionCode = resolutionMap[stateLabel];
    if (!resolutionCode) return; // not a terminal state we care about

    var correlationId = current.getValue('correlation_id');
    if (!correlationId) return; // not a DualPay-synced case

    var payload = {
        correlation_id: correlationId,
        sys_id: current.getUniqueValue(),
        number: current.getValue('number'),
        resolution_code: resolutionCode,
        resolution_notes: current.close_notes ? current.close_notes.toString() : '',
        event_id: gs.generateGUID()
    };

    try {
        var request = new sn_ws.RESTMessageV2();
        request.setEndpoint('https://qrqekucwdfyqqzomuble.supabase.co/functions/v1/servicenow-webhook');
        request.setHttpMethod('POST');
        request.setRequestHeader('Content-Type', 'application/json');
        request.setRequestHeader('Authorization', 'Bearer ' + gs.getProperty('x_snc_dualpay.webhook_secret'));
        request.setRequestBody(JSON.stringify(payload));
        var response = request.execute();
        if (response.getStatusCode() >= 300) {
            gs.error('DualPay webhook failed: ' + response.getStatusCode() + ' ' + response.getBody());
        }
    } catch (ex) {
        gs.error('DualPay webhook exception: ' + ex.getMessage());
    }
})(current, previous);
```

Adjust `resolutionMap`'s labels to match your instance's actual `state`
choice list values (Studio → the table's dictionary entry for `state`, or
just check what labels appear in the field's dropdown — they're
release/config-dependent, the ones above are the common CSM defaults).

## 7. ATF tests

**System Applications → Studio → your app → Automated Test Framework →
Tests → New.**

**Test 1 — "DualPay Sync: inbound case create"**
1. *REST API Call* step: POST to your Scripted REST API's URL
   (`/api/<scope>/dualpay_sync/case`) with a fixed test `correlation_id`
   (e.g. `atf-test-correlation-1`) and sample claim fields. Assert status
   `201`.
2. *Record exists* / *Query record* step on `sn_customerservice_case`
   filtered by `correlation_id = atf-test-correlation-1`. Assert one row.
3. Re-run the same REST call. Assert status `200` this time (update path,
   not a second insert) and that the record count from step 2 is still 1.

**Test 2 — "DualPay Sync: resolution fires the Business Rule"**
1. *Set field values* step: on the record created above, set `state` to
   `Resolved`.
2. *Server-side script* step: query `syslog` (or your instance's audit log)
   for an entry logged by the Business Rule in the last minute, or simply
   assert no `gs.error` was recorded for this transaction — proves the rule
   fired without throwing. (Asserting the actual outbound HTTP call
   succeeded needs either an ATF outbound-mock feature if your release has
   one, or a live check against `dualpay.ops_events` for a
   `servicenow_case_resolved` row — outside ATF's reach from inside
   ServiceNow, but worth checking manually the first time.)

## 8. Link Studio to source control

**Studio → your application → the gear/settings icon → Source Control.**
Follow the wizard: it asks for a GitHub repository URL and a personal
access token, then initializes the repo from your current application
files and gives you a working commit/push flow from inside Studio going
forward. Use a repository you control — this can be a new small repo just
for the ServiceNow-side artifacts; it does not need to be (and generally
shouldn't be) this DualPay repository.

## 9. DualPay-side configuration (once you have the values above)

Set these as Supabase Edge Function secrets (not committed anywhere):

| Secret | Value |
|---|---|
| `SERVICENOW_INSTANCE_URL` | `https://devXXXXX.service-now.com` |
| `SERVICENOW_CLIENT_ID` | from §3 |
| `SERVICENOW_CLIENT_SECRET` | from §3 |
| `SERVICENOW_SYNC_PATH` | `/api/<your scope>/dualpay_sync/case` |
| `SERVICENOW_TARGET_TABLE` | `sn_customerservice_case` or `incident` |
| `SERVICENOW_WEBHOOK_SECRET` | same value as §5's system property |

And in Supabase Vault (Project Settings → Vault), a secret named
`dualpay_servicenow_service_role_key` holding your project's actual
service-role key — this is what lets the Postgres triggers dispatch to
`servicenow-sync` (see the migration; it's a safe no-op until this is set).

Optionally, `VITE_SERVICENOW_INSTANCE_URL` in the frontend's env (Vercel
Preview, say) — public information, just used to render a "view in
ServiceNow" deep link on a synced case in the UI.

Once all of the above is set: create or advance any `appeal_recovery_cases`
row (deny a claim, or advance a recovery case's state) and a Case should
appear in ServiceNow within seconds. Resolving it there should flow the
outcome back into DualPay within seconds too.
