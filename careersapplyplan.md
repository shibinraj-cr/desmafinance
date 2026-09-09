# Careers page + apply form redesign

Sectioned job content, résumé-first applying, and AI autofill for
`/careers/desma/<slug>`.

Status: plan. Nothing here is built yet.

## The public link does not change

`https://www.desgro.in/careers/desma/academic-counsellor` stays valid through
all three phases. Verified rather than assumed:

```
src/app/api/hiring/jobs/[id]/route.ts:54
  const nextSlug = body.regenerateSlug ? … : before.slug
```

The slug moves only when a human ticks "rebuild the link from the new title".
Phases 1 and 2 change rendering inside the existing route; phase 3 adds a new
API path. None of them touch the slug.

**Consequence for editing a live job:** now that an ad points at that URL,
renaming the role must be done with that tick LEFT OFF, or every ad click,
the poster and Meta's pixel association break.

## What the live page actually contains

Checked against production, not assumed — and it overturned the first draft of
this plan, which proposed splitting the description on `##` headings.

```
h2 on the page:  2   → "What you need to have", "Apply"   (both page furniture)
h2 in the JD:    0
<ul> in the JD:  0    <li> in the JD: 0
```

The description has **no markdown structure at all**. It is ten paragraphs
pasted out of Word. Splitting on headings would have produced one tab and no
visible change.

But the sections the tabs are meant to expose are already there, as plain text
at the start of paragraphs:

> About the Company · About the Role · Key Responsibilities · Requirements ·
> Preferred Skills · What We Offer · Benefits · Experience

And the bullets are literal `•` + tab characters rather than `-`, which is why
they render as paragraphs and the page reads as a wall of text. **That is a
bigger readability problem than the missing tabs, and it is cheaper to fix.**

## Phase 1 — sections and tabs

Add a structured `sections` field (`[{ title, bodyMd }]`) rather than splitting
markdown at render time. Two reasons the render-time trick loses: there is
nothing to split on today, and a tab layout that depends on how somebody typed
a JD will break the first time somebody types it differently.

Nobody re-types anything. The job editor gets a **"Split into sections"**
action:

1. A free pass that cuts on the known section names above where they start a
   paragraph, and converts `•`-and-tab runs into real markdown lists.
2. An AI fallback for anything it cannot place, using the existing provider —
   one call, roughly 20 credits, run once per job by a human who then reviews
   the result before saving.

The recruiter sees the proposed split, edits it, saves. Existing pasted JDs are
handled; so are future ones.

Public rendering: tabs on desktop, accordion below ~640px — most applicants are
on a phone, and a tab strip over long text is painful there. Every panel stays
in the DOM even when hidden, so search engines and the `JobPosting` structured
data still see the whole description.

"About DESMA" comes from `HiringCompanyProfile.summaryMd`, which already exists
— written once, shown on every job, not re-pasted per role.

## Phase 2 — résumé first

Reorder to: **upload → review the prefilled fields → questions and consent →
submit.**

A visible "I'll type it in myself" path at every step is not optional. The
parser is PDF-only, `.docx` is common, and a slow or failed parse must never
stand between a candidate and applying.

No AI in this phase. It ships on its own.

## Phase 3 — autofill

`POST /api/careers/parse-resume`: takes the PDF, returns fields, **creates and
stores nothing**. The file stays in the browser until final submit, so nothing
of the candidate's is retained unless they actually apply and tick consent.

One code change needed: `parseResumeBytes` takes `userId: string`, but an
applicant has no account. `meter()` underneath it already accepts
`userId?: string | null`, so this widens to nullable — a null actor is
"the public form", which is also what the AI-usage log should record.

### The risk that shapes this phase

A paid AI call behind a public unauthenticated endpoint. 15 credits a parse, and
the credits are the same pool bulk résumé import draws on. A script drains it.

Controls, in order of how much they matter:

1. **A separate daily budget for public parses.** When spent, the form falls
   back to manual and the candidate sees an ordinary form, not an error. This
   is the control that actually bounds the loss.
2. Rate limit per IP, tighter than apply's `5 / 10 min` — suggest `3 / 30 min`.
3. Reuse the honeypot and dwell-time checks that already exist BEFORE spending
   a credit.
4. Careers must be public and the slug a live job.
5. 5 MB cap, PDF only — both already enforced on upload.

The consent text needs a line about automated reading of the CV, since that now
happens before submission.

## Order

| Phase | Ships | Cost surface |
|---|---|---|
| 1 | sections, tabs, real bullet lists | none |
| 2 | résumé-first reorder, manual path | none |
| 3 | parse endpoint, autofill, budget guard | the above |

Phase 1 is worth doing even if 2 and 3 never happen: the wall-of-text bullets
are hurting the page today, for every visitor arriving from the ad.

## Open decisions

- Daily cap for public parses. Suggest 200/day (3,000 credits) against a
  balance of roughly 19,800.
- Whether "Preferred Skills" and "What We Offer" are their own tabs or fold
  into "About the role" — eight tabs is too many on a phone.
