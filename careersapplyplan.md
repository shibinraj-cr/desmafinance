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

**The free pass was prototyped against the live Academic Counsellor
description before committing to this design.** It placed 9 of 10 paragraphs;
the one miss (`₹1.44–4 LPA`) is not description text at all — it is the salary
band the page renders separately — so every real section was recovered:

```
  ✓ About the Company       479 chars
  ✓ About the Role          307 chars
  ✓ Key Responsibilities    575 chars,  8 bullets → <ul>
  ✓ Requirements            339 chars,  6 bullets → <ul>
  ✓ Preferred Skills        144 chars,  3 bullets → <ul>
  ✓ What We Offer           144 chars,  3 bullets → <ul>
  ✓ Benefits                 73 chars,  4 bullets → <ul>
  ✓ Experience               68 chars,  2 bullets → <ul>
```

That conclusion was too confident, and running the same prototype against the
SECOND live job caught it. Documentation Executive placed only 4 of 10
paragraphs, for two distinct reasons:

- **Section names differ per JD.** It says "Company Overview" and "Position
  Overview" where the other says "About the Company" and "About the Role".
- **Bullet runs get their own `<p>`.** Three paragraphs start with `•` — they
  are continuations of the section above, not new sections, and treating each
  paragraph independently orphaned them.

The second cause is the important one, and its fix needs no vocabulary at all:
**a paragraph that names no section continues the previous one.** With that rule
plus a vocabulary widened from both JDs, the two live jobs split as:

```
academic-counsellor      9 sections, 1 unplaced of 10 paragraphs
documentation-executive  6 sections, 1 unplaced of 10 paragraphs
```

Both remaining misses are the `₹… LPA` salary line, which is not description
text — the page renders the band separately.

**Read that honestly: the vocabulary was widened using the second job's own
headings, so this is fitted to a two-job sample, not validated against unseen
input.** A third JD written differently will miss again. Which is why the AI
fallback stays, and why the recruiter reviews the proposed split before it
saves — that review is what makes vocabulary fragility survivable rather than a
correctness problem.

Across both jobs the free pass also recovers **42 bullets** currently rendering
as run-on paragraph text, against zero `<ul>` on either page.

The recruiter sees the proposed split, edits it, saves. Existing pasted JDs are
handled; so are future ones.

### `descriptionMd` stays the source of truth

This is the constraint that decides the whole phase, and it only shows up if
you grep for who reads that column. There are eight consumers, and two of them
fail silently if content moves out of it:

```
src/lib/hiring/careers.ts:159   description: job.descriptionMd ?? job.title
                                → the JobPosting structured data Google reads
src/app/careers/desma/[slug]/page.tsx:30
                                → the page's meta description, via markdownToPlainText
src/lib/hiring/core.ts:170      "The job needs a description."
                                → the publish gate; a sections-only job cannot go live
```

Plus the internal job view, both create/update paths, and the AI JD drafter,
which *emits* `descriptionMd` and would need to emit sections too.

A job published with sections and an empty `descriptionMd` would hand Google a
JobPosting whose entire description is the job title. For a company paying for
recruitment ads, quietly falling out of Google Jobs is a worse outcome than not
having tabs.

So: **`sections` is a rendering structure derived from `descriptionMd`, not a
replacement for it.** The splitter writes sections; the full text stays whole
and canonical. Structured data, meta description, publish gate, AI drafter and
the internal view all keep working untouched, and the tabs are additive. If
sections are absent or stale, the page falls back to rendering the blob exactly
as it does today.

There is no reusable tab component to lean on. `GroupTabs` is app-navigation
bound to `usePathname`, module groups and RBAC; the tab-ish patterns in CRM
settings are each local to their page. Phase 1 therefore includes a small
`careers`-scoped tabs/accordion component — the careers shell is deliberately
separate from the app shell, so it should not import app chrome anyway.

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

**The existing careers defence does not transfer to this endpoint, and that
changes the design.** `src/lib/hiring/rate-limit.ts` is honest about being
in-process memory — per warm serverless instance, not global. It works on the
apply route because it is one of four layers, and the fourth does the real work:
the database's own uniqueness on (candidate, job) makes duplicate applications
pointless no matter how many get through.

**A parse endpoint has no fourth layer.** It creates nothing, so there is no
constraint to violate; every call simply costs 15 credits. Rate limiting is
therefore a speed bump here, not a control — an attacker spread across IPs or
cold instances walks past it.

So the ordering is not "budget first, then rate limit". It is:

1. **A separate daily budget for public parses — the only hard ceiling.** It
   must be DB-backed to be global, which `getCreditsState()` already is (it
   reads budget and spend from the database, not module memory). When spent,
   the form falls back to manual and the candidate sees an ordinary form rather
   than an error.
2. **A short-lived signed token issued when the job page renders**, required by
   the parse endpoint. This does not stop a determined attacker, but it stops
   the trivial case — a bare `curl` loop against a known URL — which is the one
   that actually happens.
3. Honeypot and dwell-time, checked BEFORE spending a credit. Free, and they
   matter more here than on apply precisely because nothing downstream catches
   what they miss.
4. Rate limit per IP — keep it, but bill it as a speed bump. Suggest
   `3 / 30 min`.
5. Careers must be public and the slug a live job.
6. 5 MB cap, PDF only — both already enforced on upload.

If the signed token proves awkward, the honest fallback is to not build phase 3
as a public endpoint at all: parse on submit instead, server-side, where the
application record itself is the rate limit. The candidate loses the
review-before-submit step, which is the point of the feature — so the token is
worth trying first.

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
  into "About the role" — the split above yields eight, which is too many on a
  phone. Suggest four: About DESMA · The role · Responsibilities · What you
  need, with Benefits and Experience folded into the last.
