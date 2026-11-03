# Instagram DMs → CRM leads

When someone DMs the business Instagram account, DesGro stores the message,
reads the candidate's phone, email, qualification and name out of it, and — the
moment a phone or email arrives — creates a lead with source **Insta**. If that
phone or email already belongs to a lead, it is recorded as a **re-inquiry** on
that lead instead (follow-up task for the owner, supervisor digest), never a
duplicate.

Optionally, DesGro also **replies** to a new DM asking for the details it still
needs ("auto-ask").

The team keeps reading and replying in Meta Business Suite (or the Instagram
app) exactly as before. DesGro gets a copy of each message; it does not take the
inbox over.

Code: `src/lib/ig/` (`webhook.ts` parse → `ingest.ts` store/lead/auto-ask,
`extract.ts` detail rules, `auto-ask.ts` reply rules, `graph.ts` Meta calls),
webhook at `/api/crm/ig/webhook`, settings at CRM → Settings → **Instagram**.

## One-time Meta setup

Everything below uses the existing Meta app (the one the WhatsApp module runs
on) and the Facebook Page the Instagram account is linked to.

1. **Instagram account is Professional and linked to the Page.** Business Suite
   → Settings → Instagram accounts. If DesGro's "Check connection" says the Page
   has no Instagram account, this is the step that is missing.
2. **Allow message access.** In the Instagram app: Settings → Messages and calls
   → Connected tools → turn on **Allow access to messages**. Without it Meta
   delivers nothing.
3. **Add Instagram messaging to the app.** App Dashboard → Use cases → add
   "Manage messaging and content on Instagram" (Facebook Login route). Permissions
   needed: `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`,
   `pages_show_list`.
4. **Token.** Business Settings → System users → the existing system user → Add
   assets → give it the Page (and the Instagram account) with full control →
   Generate token for the app with the four permissions above. System User tokens
   do not expire. Paste it into DesGro (step 1 on the settings page) together
   with the **Page ID**, then **Check connection**: DesGro derives the Page token
   and finds the Instagram account from it.
5. **Webhook.** App Dashboard → Webhooks → choose the **Instagram** object →
   Subscribe to this object → paste the **Callback URL** and **Verify token**
   shown on the DesGro settings page → Verify and save → subscribe the
   **messages** field (and `messaging_postbacks` if ice-breakers are used).
6. **Subscribe the Page** — the button in step 2 on the settings page. Meta
   verifying the URL is NOT enough; until the app is subscribed to the Page, no
   message is ever delivered. "Check subscription" shows what Meta has on file.
7. **App secret.** Deliveries are verified by Meta's signature, using the same
   App secret the WhatsApp module already stores (CRM → Settings → WhatsApp Inbox).
   The settings page warns if it is missing; until then every delivery is refused.

**App Review.** Meta's docs say Standard Access covers accounts the business owns,
so App Review should not be needed for our own Instagram account. That is
unproven for us — WhatsApp Coexistence turned out to need Advanced Access. Phase 0
below settles it: if a DM from an account with no role on the app never shows
"Last delivery from Meta" moving, add `instagram_manage_messages` to the App
Review submission.

## Rollout

- **Phase 0 — proof.** Leave both switches off. Send a DM to the business account
  from a personal Instagram account that has no role on the Meta app. "Last
  delivery from Meta" should update and the DM should appear under "Recent
  Instagram contacts" with whatever details it carried. Messages are stored with
  the switches off, so nothing is lost while testing.
- **Phase 1 — leads.** Turn on **Create leads from Instagram DMs**. Send a test DM
  with a phone number; a lead with source Insta appears, unassigned, in the
  normal flow.
- **Phase 2 — auto-ask.** Turn on **Auto-ask** and adjust the wording if wanted
  (blank = the default shown). Check that any Business Suite "Instant reply" for
  Instagram is turned off, or candidates get two replies. Test from a personal
  account: "hi" → intro → reply with a number → follow-up → the rest → thank-you.

## What auto-ask does and does not do

- It only starts on a candidate's **first** message to us. A chat that already
  existed when DesGro was connected (checked against Meta's conversation history)
  or when auto-ask was switched on is never interrupted. If the history cannot be
  checked, it stays silent ("couldn't check chat history" in the list).
- At most **two asks** (intro + one follow-up), then one **thank-you** when phone,
  email and qualification are all in.
- A follow-up goes only when the candidate's reply **added** a detail but left
  some missing. A question with no details ("fees?") gets no robotic re-ask.
- It stops **for good** the moment anyone on the team replies by hand.
- Someone whose number/email is **already a lead** gets the thank-you, never the
  questions.
- When qualification is missing, the message carries tap-to-answer buttons for
  the CRM's qualification list (first 13, as Instagram allows).
- Only ever inside Instagram's 24-hour window — it answers a message that arrived
  seconds earlier.

## Details extraction

Rules, not a model (`src/lib/ig/extract.ts`, pinned by `tests/ig-extract.test.ts`):
email by pattern; phone as any 10–15 digit run (normalised like every other
source — bare 10 digits = India); qualification by whole-word match against the
CRM's qualification list, or a tapped button; name from "Name: …" / "my name is
…" or the first item of a details message ("Anjali, 98765…"). A detail is only
ever filled in, never overwritten — on the contact or on the lead. The lead's
name is replaced by a typed name only while it is still the placeholder DesGro
gave it. What the rules miss stays readable in the lead's **Instagram** tab.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Last delivery from Meta: never" after a test DM | Page not subscribed (step 6), message access off (step 2), app not Live, or Advanced Access needed (see App Review) |
| Deliveries arrive but nothing in the list | App secret missing/wrong → every delivery 401s (check the warning) |
| Contacts show no name/username | Profile lookup refused — token lacks `instagram_manage_messages` |
| Auto-ask says "couldn't check chat history" | The conversations lookup failed — same permission, or the Page token was not derived (re-run Check connection) |
| Auto-ask says "another app owns this chat" | A Business Suite automation or chatbot tool is the primary receiver; DesGro only gets standby copies and stays silent |
| No lead though a number was sent | Lead capture is off, or the number is not 10–15 digits |
