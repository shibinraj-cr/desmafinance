# CRM Audit And Dashboard Integration Plan

## Scope

This audit covers the CRM module under `src/app/(app)/crm`, `src/app/api/crm`, and the shared CRM helpers in `src/lib/crm*.ts`, with supporting data model checks in `prisma/schema.prisma`.

No implementation changes are proposed here outside this plan file.

## Current CRM Shape

The CRM module is already more than a basic lead table. It has a complete lead lifecycle, task workflow, admin settings, imports, bulk email, activity history, and downstream handoffs.

Key areas:

- Lead list: `src/app/(app)/crm/leads/page.tsx` uses server-side filtering, sorting, pagination, master lookups, and BDE-aware defaults.
- Lead detail: `src/app/(app)/crm/leads/[id]/client.tsx` includes status movement, field edits, timeline, notes, assignment, deal setup, enrollment, comms logging, duplicate awareness, tasks, and admin history.
- Task board: `src/app/(app)/crm/tasks/page.tsx` provides open-task defaults plus overdue, due-today, re-inquiry, unassigned, assignee, priority, and search filters.
- Settings: `src/app/(app)/crm/settings/page.tsx` manages CRM lead statuses and qualifications.
- API layer: `src/app/api/crm/**` covers CRUD, import/export, ids for bulk email, assignment, notes, activities, comms, tasks, deal, enroll, statuses, qualifications, integrations, and email settings.
- Shared logic: `src/lib/crm-leads.ts`, `src/lib/crm-rbac.ts`, `src/lib/crm-activity.ts`, `src/lib/crm-enroll.ts`, `src/lib/crm-reinquiry.ts`, and `src/lib/crm-sheet-ingest.ts` centralize important rules.

## Data Model Assessment

The Prisma model is dashboard-ready in most important ways.

Strengths:

- `Lead` tracks identity, source, service, qualification, status, assignment, deal value, expected close date, pipeline linkage, campaign, country, re-inquiry count, last inquiry, extras, timestamps, and last activity.
- `LeadActivity` is a single source for timeline/history events.
- `CrmTask` gives a durable follow-up queue.
- `LeadImportBatch` preserves import provenance.
- Useful indexes already exist for assignment, status, source, service, qualification, import batch, created date, last activity, email/phone dedupe fields, campaign, country, expected close date, and last inquiry.

Relevant anchors:

- Lead columns and indexes: `prisma/schema.prisma:1817`
- Activity model: `prisma/schema.prisma:1986`
- Task model and task indexes: `prisma/schema.prisma:2012`
- Import batch model: `prisma/schema.prisma:2041`

Dashboard implication:

- No schema change is required for a first CRM dashboard.
- The first version can compute live metrics from existing `Lead`, `CrmLeadStatus`, `CrmTask`, `LeadActivity`, and `LeadPulsePipeline` data.
- Add schema only later if the dashboard needs persisted snapshots, SLA timers, campaign cost attribution, or historical stage-duration facts.

## Workflow Assessment

Strengths:

- Lead filtering is centralized in `buildLeadWhere`, shared by the list, API, export, and ids endpoint. This reduces dashboard/list drift.
- BDE default behavior is explicit: BDEs land on their own queue unless they choose all leads.
- Action-only statuses protect lifecycle integrity. `pipeline`, `enrolled`, and `duplicate` are not directly set from the normal status picker.
- Assignment stamps `assignedAt`, which is critical for fair lead allocation and conversion metrics.
- Re-inquiry handling folds repeat submissions onto the canonical lead instead of creating buried duplicate rows.
- Enrollment is a strong cross-module handoff: it updates CRM, Lead Pulse pipeline, Finance draft flow, Candidate/Party data, and Operations project creation.

Relevant anchors:

- Shared lead include and serializer: `src/lib/crm-leads.ts:6`
- Shared lead filters: `src/lib/crm-leads.ts:121`
- BDE default assignee logic: `src/lib/crm-leads.ts:170`
- Action-only status codes: `src/lib/crm-leads.ts:204`
- Lead list page query pattern: `src/app/(app)/crm/leads/page.tsx:61`
- Task board count pattern: `src/app/(app)/crm/tasks/page.tsx:70`
- Deal and enrollment handoff: `src/lib/crm-enroll.ts:168`
- Finance and Operations handoff on enrollment: `src/lib/crm-enroll.ts:281`

## RBAC Assessment

The CRM RBAC model is simple and mostly consistent.

Current rule summary:

- Admins can manage everything.
- Lead Pulse supervisors can edit any lead.
- Active L1/L2 BDEs can create leads and edit only leads assigned to them.
- Roles with `/crm/settings` become CRM admins for assign/import/bulk-email/history/settings.
- Everyone with CRM view access can see all leads; BDEs are only default-filtered to their own queue in the UI and query helpers.

Relevant anchors:

- Capability comments and shape: `src/lib/crm-rbac.ts:5`
- Capability resolution: `src/lib/crm-rbac.ts:47`
- Mutation rule: `src/lib/crm-rbac.ts:82`
- CRM module pages today: `src/lib/modules.ts:142`
- CRM grant script today: `prisma/grant-crm-pages.ts:1`

Dashboard implication:

- Add `/crm/dashboard` to the CRM module and grants.
- Use `access.canViewLeads` for dashboard visibility.
- Scope data by role in the dashboard UI, not by hiding the route:
  - Admin/CRM manager/supervisor: team-wide dashboard with BDE/source/service filters.
  - BDE: default to their own operational dashboard, with the same visibility policy as the lead list if the business wants "all leads" available.

## Existing Metrics Reuse

There is already CRM-derived metrics logic under Marketing Lead Pulse.

Useful helpers:

- `getCrmFunnelByBde`
- `getCrmServiceMatrix`
- `getCrmFunnel`
- `getCrmFunnelBySource`
- `getCrmMonthlyMatrix`

Relevant anchors:

- CRM Lead Pulse metrics overview: `src/lib/lead-pulse-crm-metrics.ts:1`
- Per-BDE CRM funnel: `src/lib/lead-pulse-crm-metrics.ts:38`
- Service matrix from CRM enrollments: `src/lib/lead-pulse-crm-metrics.ts:102`
- Generic date-range funnel: `src/lib/lead-pulse-crm-metrics.ts:202`
- Per-source funnel: `src/lib/lead-pulse-crm-metrics.ts:264`

Important distinction:

- The existing `/marketing/lead-pulse/crm-metrics` page is a reconciliation surface for validating CRM numbers against manual daily-entry metrics.
- The proposed `/crm/dashboard` should be an operational CRM surface: workload, speed-to-action, stale leads, task pressure, pipeline health, conversion, and handoff visibility.

## Gaps And Risks

### 1. No CRM dashboard route yet

CRM currently has Leads, Tasks, and Settings, but no module-level summary page. Users must infer health by switching between list filters and task chips.

Impact:

- Managers cannot quickly answer "what needs attention today?"
- BDEs cannot see their own workload and conversion status in one place.
- Imported lead volumes, unassigned leads, stale leads, overdue tasks, re-inquiries, and enrollments are not summarized together.

### 2. Dashboard metrics need one canonical CRM metrics helper

Some reusable CRM metrics exist in `lead-pulse-crm-metrics.ts`, but those are shaped around Lead Pulse validation and conversion reporting. A CRM dashboard will need additional operational metrics:

- Open leads by status and owner.
- Unassigned leads.
- New assigned leads not yet started.
- Stale active leads by last activity.
- Overdue and due-today tasks.
- Re-inquiries needing follow-up.
- Open deal value and expected close dates.
- Enrollment handoff results.
- Recent activity volume by type.

Risk:

- If metrics are coded directly in a page component, they will be hard to test and likely drift from Leads/Tasks filters.

Recommendation:

- Add a dedicated `src/lib/crm-dashboard.ts` helper when implementing. It should reuse shared filters and existing CRM/Lead Pulse helpers where possible.

### 3. Date semantics should be explicit

Lead list filters use created dates and assigned dates. CRM conversion metrics use assigned dates for lead denominator and closed dates from `LeadPulsePipeline` for enrollments. Task metrics use local server-day boundaries.

Risk:

- A dashboard can look inconsistent if one tile uses created leads while another uses assigned leads without clear labeling.

Recommendation:

- Dashboard should show separate labels:
  - "New leads created"
  - "Leads assigned"
  - "Enrollments"
  - "Open pipeline value"
  - "Overdue tasks"
- Use one selected date range, but document which timestamp each metric reads.

### 4. Search queries may become expensive at larger scale

Lead search uses several `contains` predicates across name, email, phone, normalized phone, alternate phone, and alternate normalized phone.

Impact:

- Fine at modest CRM size.
- At larger scale, dashboard widgets that reuse text search heavily could slow down.

Recommendation:

- Avoid free-text search in dashboard aggregation queries.
- Keep dashboard filters structured: date range, assignee, source, service, status, country, campaign.
- If lead count grows significantly, consider Postgres trigram indexes or a materialized search column later.

### 5. Re-inquiry tasks are identified by subject text

`buildCrmTaskWhere` treats re-inquiry tasks as subject text containing `re-inquiry`.

Impact:

- This works today, and it is tested.
- It is brittle if future task subjects change language or format.

Recommendation:

- For dashboard v1, reuse the current subject rule to avoid schema churn.
- For dashboard v2, consider `CrmTask.kind` or metadata if re-inquiry reporting becomes business-critical.

### 6. Activity analytics are possible but not yet formalized

`LeadActivity` contains event type and metadata, but the dashboard has no helper for "last contacted", "time to first touch", "touches per BDE", or "stage duration".

Recommendation:

- V1 should use simple counts and recent activities.
- V2 can introduce SLA metrics:
  - First touch after assignment.
  - Leads with no activity after assignment.
  - Average time from assignment to enrollment.
  - Stage aging.

### 7. Current grant script does not include a dashboard page

`prisma/grant-crm-pages.ts` grants `/crm/leads`, `/crm/tasks`, and `/crm/settings`.

Recommendation:

- When implementing, add `/crm/dashboard` to viewer/admin CRM page grants.
- Put dashboard first in `MODULES` so CRM opens with an overview.

## Recommended Dashboard Experience

Route:

- `/crm/dashboard`

Placement:

- CRM module, group `PIPELINE`, before Leads.

Audience:

- BDE: "my day" and "my pipeline" view by default.
- CRM manager/supervisor/admin: team operating view by default.

Primary layout:

1. KPI strip
   - New leads created in selected period.
   - Leads assigned in selected period.
   - Open active leads.
   - Enrollments in selected period.
   - Conversion rate.
   - Open deal value.

2. Attention strip
   - Unassigned leads.
   - Not Yet Started assigned leads.
   - Stale active leads.
   - Overdue tasks.
   - Re-inquiry follow-ups.

3. Funnel by status
   - Status counts from `CrmLeadStatus.kind`.
   - Active vs won vs lost split.
   - Click each segment into `/crm/leads?status=...`.

4. BDE performance table
   - BDE.
   - Assigned leads.
   - Enrolled.
   - Lost.
   - Conversion.
   - Open tasks.
   - Overdue tasks.
   - Stale leads.

5. Source/service performance
   - Leads assigned and enrollments by source.
   - Optional service or service-group breakdown using existing Lead Pulse CRM metrics.

6. Task pressure
   - Overdue, due today, due this week, unassigned, and re-inquiry tasks.
   - Each count links to `/crm/tasks` with matching query params.

7. Recent movement
   - Recent enrollments.
   - Recent re-inquiries.
   - Recent assignments.
   - Recent bulk imports.

## Data Query Plan

Create a dedicated helper during implementation:

- `src/lib/crm-dashboard.ts`

Suggested public functions:

- `getCrmDashboard(opts)`
  - Returns the whole dashboard payload for one date range and optional assignee/source/service filters.
- `getCrmDashboardKpis(opts)`
  - Counts created leads, assigned leads, active open leads, lost leads, enrollments, open deal value, and conversion.
- `getCrmAttentionCounts(opts)`
  - Counts unassigned, not-yet-started, stale, overdue task, due-today task, and re-inquiry task buckets.
- `getCrmStatusBreakdown(opts)`
  - Counts leads grouped by status.
- `getCrmBdeDashboardRows(opts)`
  - Aggregates assigned, enrolled, lost, active, tasks, overdue tasks, and stale leads by BDE.
- `getCrmRecentActivity(opts)`
  - Loads recent selected activity types.

Reuse:

- Use `buildLeadWhere` where the dashboard links need exact parity with the lead list.
- Use `buildCrmTaskWhere` for task links/count parity.
- Reuse `getCrmFunnel`, `getCrmFunnelByBde`, and `getCrmFunnelBySource` where their denominator rules match dashboard copy.

Avoid:

- Do not put raw dashboard SQL directly in the page component.
- Do not duplicate status-kind rules in multiple places.
- Do not make the dashboard depend on client-side fetching for first render unless live refresh is explicitly needed.

## UI Integration Plan

Page files to add during implementation:

- `src/app/(app)/crm/dashboard/page.tsx`
- Optional: `src/app/(app)/crm/dashboard/client.tsx` only if chart interactivity needs client state.

Navigation changes:

- Add `{ href: "/crm/dashboard", label: "Dashboard", icon: "dashboard", group: "PIPELINE" }` before Leads in `src/lib/modules.ts`.
- Update `prisma/grant-crm-pages.ts` so CRM viewers and admins receive `/crm/dashboard`.
- If seed roles define CRM pages elsewhere, update those too.

Visual components:

- Reuse `TopBar`, `DateFilter`, `KpiCard`, `Section`, and existing chart components from `src/components`.
- Keep the dashboard dense and operational, matching the app's finance/HR dashboard style.
- Make every major count link back to the filtered Leads or Tasks page.

Suggested query params:

- `period`, `from`, `to`: same as existing `DateFilter`.
- `assignee`: BDE user id, `unassigned`, or omitted.
- `source`: source id.
- `service`: service id.

## Link Targets

Dashboard tiles should be actionable:

- Unassigned leads: `/crm/leads?assignee=unassigned`
- Not yet started: `/crm/leads?status=<not_yet_started_id>`
- Stale leads: `/crm/leads?sort=activity_desc` is not enough; consider adding a stale filter later. For v1, link to active leads sorted by last activity if a direct stale query param is not added.
- Overdue tasks: `/crm/tasks?due=overdue`
- Due today: `/crm/tasks?due=today`
- Re-inquiries: `/crm/tasks?kind=reinquiry`
- BDE row: `/crm/leads?assignee=<userId>`
- Source row: `/crm/leads?source=<sourceId>`
- Service row: `/crm/leads?service=<serviceId>`

## Phased Rollout

### Phase 1: Read-only operational dashboard

Deliver:

- `/crm/dashboard` route.
- Team/BDE scoped dashboard payload helper.
- KPI strip, attention strip, status funnel, BDE table, source/service summary, task pressure.
- Links into existing Leads and Tasks pages.
- Role/page grant updates.

Acceptance checks:

- Admin can see team-wide dashboard.
- BDE can see dashboard and lands on their own useful view by default.
- Counts link to matching list/task filters.
- No mutation actions are introduced.

### Phase 2: Better SLA and aging

Deliver:

- Stale-lead filter support in shared lead filters.
- First-touch and no-touch-since-assignment metrics from `LeadActivity`.
- Stage aging and average time-to-enroll.
- Dashboard cards for "needs first touch" and "aging in follow-up".

Possible schema change:

- None required initially.
- Consider persisted stage transition facts only if live activity queries become slow.

### Phase 3: Manager coaching view

Deliver:

- BDE drilldown page or dashboard drawer.
- Per-BDE lead quality, source mix, overdue workload, re-inquiries, and enrollments.
- Suggested next actions based on stale leads and overdue tasks.

### Phase 4: Forecast and revenue handoff visibility

Deliver:

- Open deal value by expected close week.
- Expected vs enrolled value.
- Finance draft status after enrollment.
- Operations project creation status after enrollment.

## Testing Plan

Add unit tests for the dashboard helper rather than the page first.

Recommended tests:

- Date-range boundaries for created, assigned, task due, and enrollment close dates.
- Role scoping for BDE vs supervisor/admin.
- Status-kind grouping.
- Task attention counts: overdue, today, re-inquiry, unassigned.
- Funnel denominator rules: assigned leads exclude import carryover where using Lead Pulse CRM metric helpers.
- Link query builders, if extracted.

Existing CRM tests to keep green:

- `tests/crm.test.ts`
- `tests/crm-leads.test.ts`
- `tests/crm-rbac.test.ts`
- `tests/crm-reinquiry.test.ts`
- `tests/crm-sheet-ingest.test.ts`
- `tests/crm-bulk-email.test.ts`

Suggested verification after implementation:

- `npm test -- crm`
- `npm run lint`
- Browser check for `/crm/dashboard`, `/crm/leads`, and `/crm/tasks`.

## Final Recommendation

Build the dashboard as a read-only operational overview first, using existing CRM tables and helper rules. The project already has the data model, RBAC, task system, activity stream, and cross-module handoffs needed for a useful dashboard. The main work is consolidation: one dashboard metrics helper, one route, one nav entry, matching page grants, and links back into the already mature Leads and Tasks workflows.

---

# Team Activity Monitor (`/crm/team`)

A distinct **team-accountability / supervision** surface, separate from the pipeline-operations `/crm/dashboard` above. It answers the manager's daily question: *"is each BDE actually working their leads, and where are leads rotting?"* Read-only; every count links into the existing Leads/Tasks pages.

All metrics below are computable from existing tables — **no schema change required**.

## Locked decisions

- **Surface**: dedicated `/crm/team` route ("Team Activity"). Keeps `/crm/dashboard` purely pipeline-focused.
- **"Touched" definition**: a real `LeadActivity` of a meaningful type — `CALL_LOGGED`, `EMAIL_SENT`, `WHATSAPP_SENT`, `NOTE_ADDED`, `STATUS_CHANGED`, `TASK_*` — **excluding bulk-email-generated bumps**. Computed from `LeadActivity`, NOT raw `lastActivityAt` (which a bulk email would reset). Verify bulk-email's activity signature during build so the carve-out is precise (see `src/app/api/crm/leads/bulk-email/route.ts:148`).
- **Stale threshold**: per-status SLA (Aggressive profile, below).
- **RBAC**: admins / CRM managers / supervisors see the whole team; a BDE opening the page sees only their own numbers (self-view). Mirrors the existing BDE-default pattern in `buildLeadWhere`.
- **Attention scope**: per-consultant accountability metrics (SLA breach / no-task / stuck / abandoned / first-response / assigned counts) cover **owned leads only** — assigned, and excluding bulk-import carryover (a lead counts only when it has no import batch OR was assigned > 10 min after the batch's import time, mirroring `getCrmFunnelByBde`). Verified necessary against live data: without it the 13.5k unassigned/imported backlog swamped the metrics (18,561 phantom "SLA breaches" → 18 real ones). The unassigned backlog is surfaced separately as its own "Unassigned active" tile, not as a consultant's failure.

## Per-status SLA (untouched longer than → breach)

| Active stage | Threshold |
|---|---|
| Not Yet Started | 1 day |
| Qualify | 3 days |
| Follow-Up | 2 days |
| Re-marketing | 7 days |
| Pipeline | 3 days |
| **Abandoned** (any active stage) | **30 days** |

Won (`enrolled`) and lost statuses are excluded from SLA monitoring.

## Sections / metrics (v1)

**Daily pulse** (period — default today, range-selectable):

1. New leads created — by day & BDE (`Lead.createdAt`, `assignedToId`).
2. Leads assigned — by day & BDE (`Lead.assignedAt`).
3. Tasks completed — count + **on-time %** (completed before `dueAt`) per BDE (`CrmTask.status`/`completedAt`/`completedById`, or `TASK_COMPLETED` activity).
4. Activity leaderboard — calls/emails/whatsapp logged per BDE (`LeadActivity` touch set, `actorId` + `occurredAt`).

**Attention / risk** (point-in-time snapshots):

5. Untouched — per-status SLA breach (table above).
6. Abandoned leads — active & untouched > 30 days (severe escalation, any active stage).
7. No-task active leads — active leads with zero **open** `CrmTask` (no planned next step).
8. Status-stuck leads — active, same status > N days (no `STATUS_CHANGED` in window).
9. Re-inquiry follow-up — re-inquiry leads (`inquiryCount > 1`) not touched since `lastInquiryAt`, + open re-inquiry tasks.

**Outcomes:**

10. First-response time — median `assignedAt`→first touch per BDE, + count breaching.
11. Conversion per BDE — assigned→enrolled rate (reuse `getCrmFunnelByBde`).

## Implementation plan

- **Helper-first**: `src/lib/crm-team.ts` with unit tests before the page. Reuse `buildLeadWhere` / `buildCrmTaskWhere` for link parity; reuse `getCrmFunnelByBde` for conversion.
- Suggested functions: `getTeamDailyPulse(opts)`, `getTeamAttention(opts)` (SLA breach / abandoned / no-task / stuck / re-inquiry buckets), `getTeamFirstResponse(opts)`, `getTeamConversion(opts)`, plus a top-level `getTeamActivity(opts)` assembling the page payload for one date range + role scope.
- **Page**: `src/app/(app)/crm/team/page.tsx` (+ `client.tsx` only if a chart needs client state). Reuse `TopBar`, `DateFilter`, `KpiCard`, `Section`.
- **Nav + grants**: add `{ href: "/crm/team", label: "Team Activity", group: "PIPELINE" }` to `src/lib/modules.ts`; add `/crm/team` to `prisma/grant-crm-pages.ts` for managers/admins (and BDE self-view via in-page role scoping, not route hiding).
- **Date semantics**: point-in-time metrics (untouched/no-task/stuck/abandoned) ignore the date range; period metrics (daily count/task completion/activity/conversion) use it. Label each clearly.

## Tests

- Touch-set computation excludes bulk-email bumps; includes call/email/whatsapp/note/status/task.
- Per-status SLA boundary cases (exactly at threshold vs over).
- Abandoned 30-day boundary.
- No-task = zero **open** tasks (a done task still counts as no next step).
- Role scoping: BDE sees only own rows; manager sees all.
- On-time task completion (`completedAt < dueAt`) and first-response median.
- Date-range boundaries for daily counts and conversion.

