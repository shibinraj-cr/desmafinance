# CRM pages: keep the BDE guide in step

BDEs learn the CRM from the in-app **CRM Guide** (Training & Development → CRM Guide). Its content is `src/lib/crm-guide.ts`. If a change here adds or alters something a BDE sees or does, update that file in the same PR. That covers a page, a button, a rule, or a label the guide quotes.

- **Teach it** in the right section, or add a section. If BDEs never use the page, list it in `CRM_GUIDE_EXCLUDED` with the reason.
- **Announce it** with a `CRM_GUIDE_CHANGES` line, newest first. BDEs see these lines under "What's new", and they light the section's "Updated" pill.
- **Test it.** If BDEs must know it, add or adjust a `crmGuideQuiz` question. The "How to use the CRM" training module picks the change up on its own.

Numbers and names must come from the live constants and tables, through `GuideFacts`, `nav()` and imported constants. Never retype them, so the guide can't drift from the CRM.

Two checks enforce this:
- `tests/crm-guide.test.ts` fails when a CRM page, sidebar item or role permission is neither covered nor excluded.
- The "CRM guide" PR check (`.github/workflows/crm-guide.yml`) fails a `feat(crm…)` PR that doesn't touch the guide. To skip it, write `guide: n/a` in the PR description.
