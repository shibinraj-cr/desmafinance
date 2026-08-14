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
| Send template by name | ✗ addresses by workflow URL | ✓ |
| Send free text | ✗ no API | ✓ inside the 24h window |
| Returns a message id | ✗ | ✓ `wamid`, so status matches by key |
| Fetch media | ✗ | ✓ |
| List approved templates | ✗ catalogue lives at Meta | ✓ |

`wa_provider` selects between them. That one setting is the whole cutover.

**While on Wabis the CRM can read conversations but not send from them.** That
is reported honestly rather than stubbed: the composer says so, and
`/crm/broadcasts` refuses to create a campaign. Nothing needs rewriting when the
transport changes — only the setting.

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

## Running it on Wabis today

1. Set `wa_mirror_secret` to a long random string and `wa_mirror_enabled` to `1`.
2. In Wabis, point an inbound-message webhook at
   `https://<host>/api/crm/wa/webhook?key=<wa_mirror_secret>`.
3. Conversations appear on the lead's WhatsApp tab and in `/crm/inbox`.

Whether step 2 is possible is the open question — see *Blocking unknown* below.

## Cutover to the Cloud API — what only you can do

These are Meta account operations. They cannot be scripted from here, and the
adapter has **not been exercised against a live WABA**, because that needs
credentials this repo does not have.

1. **Meta Business verification.** Business Manager → Security Centre. Takes
   days; everything else waits on it.
2. **Create (or take ownership of) the WhatsApp Business Account** and add a
   System User with `whatsapp_business_messaging` and
   `whatsapp_business_management`. Generate a **permanent** token — the default
   is short-lived and will expire silently mid-campaign.
3. **Migrate the number off Wabis.** A number lives on one platform at a time.
   Deregister it there, then register it on your WABA. There is an outage
   between the two; do it out of hours.
4. **Re-create and submit the templates.** Templates belong to the WABA. Meta
   can migrate them with the number, but plan for re-approval — a campaign
   template rejected on the morning of a send is the failure mode to avoid.
5. **Set the webhook** to `https://<host>/api/crm/wa/webhook`, subscribed to the
   `messages` field, with `hub.verify_token` = `wa_mirror_secret`. The endpoint
   answers Meta's verification handshake already.
6. **Fill the `wa_cloud_*` settings**, then set `wa_provider = cloud`.

Then check, in this order: an inbound message appears in `/crm/inbox`; a
free-text reply arrives on the phone; a template send works outside the 24h
window; delivery ticks turn to read.

If `wa_provider` is `cloud` but credentials are missing, the registry falls back
to Wabis and logs `wa_cloud_not_configured` — so a half-finished cutover degrades
instead of breaking every send.

### Before you migrate the number

Turn the mirror on and leave it running for a while first. Wabis almost
certainly cannot export conversation history, so mirroring early means the inbox
already holds months of context on the day you switch, instead of starting empty.

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

## Blocking unknown

Whether the mirror can run on Wabis at all depends on two things nobody has
confirmed:

1. Does Wabis expose a **send-message REST API**?
2. Does it forward **every inbound message** to a webhook, not just ones a
   Flow-Builder keyword bot matched?

Yes to both → phases 1–3 run on Wabis and the cutover is calm and optional.
No → the mirror cannot be fed on Wabis, and the sequence collapses into
"migrate the number first, then build".

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

Only one thing, and it gates everything: whether Wabis can POST **every** inbound
message to a URL we give it. See *Blocking unknown* above.
