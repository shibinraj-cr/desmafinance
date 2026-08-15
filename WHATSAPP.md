# WhatsApp in the CRM

The CRM stores WhatsApp conversations, replies to them, and sends marketing
broadcasts. This document is the operator's half: what to configure, what only a
human with access to the Meta Business account can do, and what the module
deliberately will not do until that happens.

## How it fits together

Every WhatsApp automation ends at one call — `WhatsAppProvider` in
`src/lib/wa/provider.ts`. Two adapters implement it:

| | Wabis (`wabis-provider.ts`) | Cloud API (`cloud-provider.ts`) |
|---|---|---|
| Send template by name | ✗ needs a numeric `template_id` | ✓ |
| Send free text | not implemented (an API does exist) | ✓ inside the 24h window |
| Returns a message id | ✓ from the send API, ✗ from a workflow | ✓ `wamid` |
| Fetch media | no endpoint; public storage URLs instead | ✓ |
| List approved templates | ✓ but Wabis's own ids, not Meta names | ✓ |

`wa_provider` selects between them. That one setting is the whole cutover.

**The Wabis adapter implements none of the send capabilities**, even though the
underlying API supports them. That is a deliberate scope decision, not a
limitation: Wabis addresses templates by its own numeric `template_id` with
per-template named variables (`templateVariable-agent-1`) rather than by Meta
name and positional `{{1}}`, so wiring it would mean a name→id mapping layer
cached from `/api/v1/whatsapp/template/list`. Since we own the WABA and can go
straight to the Cloud API, that layer would be built to be thrown away.

So while `wa_provider` is `wabis`, the CRM reads conversations but does not send
from them. That is reported honestly rather than stubbed: the composer says so
and `/crm/broadcasts` refuses to create a campaign. If the priority ever changes,
the adapter is the only file that needs filling in.

## Settings

All live in `AppSetting` (CRM → Settings), each with an env fallback, matching
how SMTP credentials work.

| Key | Meaning |
|---|---|
| `wa_provider` | `wabis` (default) or `cloud` |
| `wa_mirror_enabled` | `1` to store inbound conversations. Off by default — deploying the tables changes nothing until you turn this on |
| `wa_mirror_secret` | Shared secret the inbound hook requires, as `x-wa-secret` or `?key=` |
| `wa_mirror_autocreate_leads` | `0` to stop creating a lead for an unknown number. On by default |
| `wa_cloud_phone_number_id` | The sending number's id (not the number) |
| `wa_cloud_waba_id` | WhatsApp Business Account id — needed only to list templates |
| `wa_cloud_access_token` | Permanent System User token |
| `wa_cloud_app_secret` | Verifies Meta's `X-Hub-Signature-256` |
| `wa_cloud_api_version` | Pinned Graph version, default `v21.0` |
| `wa_broadcast_enabled` | `1` to let broadcasts actually send |
| `wa_broadcast_batch_size` | Messages per drain run, default 100 |

`CRON_SECRET` (env) guards `/api/cron/crm-broadcasts`, like the other crons.

## There is no number migration

Confirmed in Meta Business Manager: **we own the WhatsApp Business Account.** It
sits under our own verified business portfolio, with Wabis listed as a partner
holding full control. The number, the approved templates, the quality rating and
the messaging tier all belong to the WABA — which is ours.

That removes most of what a cutover normally costs:

- No deregistering and re-registering the number, so **no outage**.
- No template re-approval — templates live on the WABA and are not moving.
- No Meta Business verification to wait on; it is already done.
- No dependency on Wabis cooperating with a migration.

Leaving Wabis is reduced to two things: **subscribe our own Meta app to the
WABA**, and later **remove Wabis's partner access**. (A genuine WABA-to-WABA move
would need `POST /<DEST_WABA_ID>/migrate_message_templates`, which Meta only
permits within one business. It does not apply to us.)

## Going live on the Cloud API

Because both an app of ours and Wabis's app can be subscribed to the same WABA,
this can be done **in parallel, with Wabis untouched** — no switchover moment.

1. **Create a Meta app** in our own business and add a **System User** with
   `whatsapp_business_messaging` and `whatsapp_business_management`. Generate a
   **permanent** token; the default expires in hours and would fail silently
   mid-campaign.
1b. **Publish the app — it will not receive live webhooks otherwise.** A Meta app
   in *Development* mode only receives test webhooks fired from the dashboard;
   no production traffic is delivered. Everything below can be configured and
   report success while the CRM still sees nothing. Verified on our own app,
   which sits in Development today.

   Note this gates RECEIVING only. Sending works from Development mode — our
   first real outbound message was sent that way.

2. **Subscribe the app to the WABA** (`POST /<WABA_ID>/subscribed_apps`), with
   the webhook pointed at `https://<host>/api/crm/wa/webhook`, the `messages`
   field selected, and `hub.verify_token` set to `wa_mirror_secret`. Our endpoint
   already answers Meta's verification handshake.
   *Verify this step first — it is the one assumption in this plan: that Meta
   delivers to every subscribed app, so we receive alongside Wabis rather than
   displacing them.*
3. **Fill the `wa_cloud_*` settings**, set `wa_mirror_enabled` to `1`, and set
   `wa_provider` to `cloud`.
4. **Test on a Meta test number first** if you want zero exposure — the developer
   app provides one free, able to message a few verified recipients. It exercises
   the entire path without involving the production number at all.

Then check, in this order: an inbound message appears in `/crm/inbox`; a
free-text reply arrives on the phone; a template send works outside the 24h
window; delivery ticks turn to read.

If `wa_provider` is `cloud` but credentials are missing, the registry falls back
to Wabis and logs `wa_cloud_not_configured` — so a half-finished setup degrades
instead of breaking every send.

### Retiring Wabis

Only once the above is proven. Remove Wabis's partner access in Business
Manager — but check what their panel still does for you first: "full control"
means they can manage templates and settings on our WABA today, and something
operational may depend on that.

Conversation history **is** retrievable before you go — `GET/POST
/api/v1/whatsapp/get/conversation` returns a subscriber's messages, 50 at a
time, paginated. So the inbox does not have to start empty: a one-off backfill
over the subscriber list could import existing threads into `WaConversation` /
`WaMessage` before Wabis is retired. Not built — it is a separable job and worth
doing only if the history matters to you.

Media is the part with a deadline. Incoming files live on unauthenticated Wabis
storage URLs and are purged on a schedule (Settings → Security → Media Delete
Activity), so anything you want to keep has to be copied out as bytes, not
linked.

## Broadcasts

Queuing **freezes** the audience into recipient rows. A segment is a live query;
recomputing it mid-send would let the audience shift under a partly-delivered
campaign and the report could never be reconciled.

Opted-out and undeliverable numbers are recorded as `skipped` rows rather than
quietly dropped, so the report answers *why* someone did not receive it.

### The scheduling constraint

On Vercel's Hobby plan a cron fires once a day and a request is killed at 60
seconds, so **one pass cannot finish a campaign of a few thousand**. The drain is
chunked and resumable, and three daily ticks are configured, but in practice an
admin drives a campaign with **Send now** on `/crm/broadcasts`.

Three honest fixes, in order of preference:

1. **Vercel Pro** — then a minutely schedule in `vercel.json` is the only change.
2. **An external scheduler** hitting
   `/api/cron/crm-broadcasts?key=$CRON_SECRET` every few minutes.
3. **More daily entries** in `vercel.json`, the way `etime-sync` stacks three.

## What Wabis can do, if we ever need it

Investigated and answered — recorded because it was hard-won, though going
straight to the Cloud API means we should not need any of it.

- **Send API exists**, and returns a real `wa_message_id` (a Meta `wamid`).
  `POST /api/v1/whatsapp/send` (free text, inside the 24h window) and
  `/api/v1/whatsapp/send/template`. Auth is an `apiToken` request *parameter*,
  not a header, and nothing is signed — so prefer POST, or the key lands in
  access logs. Success is `{"status":"1", …}`, failure `{"status":"0", …}`,
  which the existing outbox already reads correctly (`isDeliveredResponse`).
- **Templates are addressed differently.** Wabis takes its own numeric
  `template_id`, not Meta's template name, and variables are named per template
  (`templateVariable-agent-1`) rather than positional `{{1}}`. Using it would
  mean a mapping layer fed from `/api/v1/whatsapp/template/list` — which is
  exactly the impedance mismatch the provider seam exists to keep out of the
  rest of the CRM.
- **Conversation history is readable**: `/api/v1/whatsapp/get/conversation`,
  50 messages at a time, paginated. This is the one Wabis capability with real
  standalone value — it would let existing threads be backfilled into the mirror
  so the inbox does not start empty. Not built.
- Also available: delivery status by message id, interactive buttons, media
  upload, subscriber/label/note CRUD, and Flow-Builder triggers.
- **Inbound webhook exists** but is off by default: Bot Manager → Bot Settings →
  Webhook → "Trigger Webhook for Incoming Message". The URL field only appears
  once the toggle is on. **Its payload shape is undocumented** — it would have to
  be discovered empirically against a request-bin before anything could parse it.
- **Media is downloadable without an API**: incoming media is mirrored to public,
  unauthenticated URLs. Copy the bytes at ingest rather than storing the link —
  the URLs are guessable-by-holder and Wabis has a media-deletion process.

The undocumented payload is the reason to prefer the Cloud API even for a
transitional period: Meta's envelope is specified, versioned, and already parsed
by `src/lib/wa/inbound.ts`.

## Decided: a thread binds to the oldest lead

One number can map to several leads (re-enrollment creates a new lead per
service) but has exactly one WhatsApp thread, so the thread has to pick one.
**It binds to the oldest** — the same rule a re-inquiry follows when folding onto
a canonical record — and the link never moves for the life of the conversation.

The accepted cost: for a re-enrolled candidate, the inbox's context rail shows
the original lead, usually already closed, rather than the service the
consultant is currently working. Binding to the most recently active lead would
fix the rail but let the link move as leads change, losing stable attribution.
Stability was chosen over convenience.

This affects **display only**. Consent and de-duplication are independent of it:
an opt-out is stamped across every lead sharing the number, and a broadcast
claims numbers rather than leads, so neither can be defeated by which lead the
thread happens to point at.

## Still open

1. **Does Meta deliver to every subscribed app?** Largely settled by inspection,
   not yet by evidence. A callback URL is stored **per Meta app**, not per WABA,
   so Wabis's URL lives inside Wabis's own app and is unreachable from ours —
   nothing we configure can overwrite it. And `subscribed_apps` is a list, so
   adding ours appends rather than replaces. The plan is additive by
   construction.

   What is still missing is proof. No Meta UI lists a WABA's subscribed apps
   (Business Settings shows partner *businesses*, not apps), so the only way to
   see it is:

   ```
   curl -s "https://graph.facebook.com/v23.0/<WABA_ID>/subscribed_apps" \
     -H "Authorization: Bearer <TOKEN>"
   ```

   Run it before and after subscribing; the diff is the evidence.
2. **Wabis's partner access.** They hold full control of our WABA today. Decide
   what to downgrade it to, and confirm nothing operational depends on it before
   changing anything.
