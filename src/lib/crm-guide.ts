// "How to use the CRM" — the BDE guide under Training & Development
// (/me/sales-training/crm-guide, and /hr/sales-training/crm-guide for HR).
//
// Pure: no Prisma. Everything the guide states as a number, a name or a list —
// stage names, SLA days, the rating deadline, alarm timings, task types, call
// outcomes, scorecard weights, sidebar labels — is read from the constants and
// tables the CRM itself runs on (directly below, or as GuideFacts loaded by
// crm-guide-data.ts). Change a rule or rename a stage and the guide follows.
//
// What still needs an edit HERE is a new screen, button or workflow. Two checks
// make that hard to forget:
//  - tests/crm-guide.test.ts fails when a CRM page, sidebar item or role
//    permission is neither covered by a section nor listed in CRM_GUIDE_EXCLUDED;
//  - .github/workflows/crm-guide.yml flags a `feat(crm…)` PR that doesn't touch
//    this file (write "guide: n/a" in the PR description to skip).
// When you add or change what a section says, add a line to CRM_GUIDE_CHANGES —
// that is what BDEs see under "What's new" and what lights the "Updated" pill.
// If the change is something a BDE must know, add or adjust a crmGuideQuiz
// question too; the training module picks it up on its own.

import { MODULES, ROLE_PERMISSIONS } from "./modules";
import { LEAD_TEMPERATURES, QUALIFICATION_OTHER_MAX, STATUS_STALE_DAYS, TASK_TYPES } from "./crm";
import { LEAD_QUALITIES, QUALITY_DUE_AFTER_DAYS, QUALITY_REMIND_EVERY_MINUTES } from "./crm-lead-quality";
import { CALL_OUTCOME_LABEL } from "./crm-outcome";
import { UNCONTACTED_AFTER_MINUTES, UNCONTACTED_REMIND_EVERY_MINUTES } from "./crm-uncontacted-alarm";
import { CONVERSION_TARGET_PCT, FIRST_RESPONSE_FAST_HOURS, RESPONSE_SLA_HOURS, SCORE_BANDS, SCORE_WEIGHTS } from "./crm-score";
import { BACKDATE_DAYS } from "./lead-pulse-dates";

/**
 * Fixed id of the guide's knowledge-check SalesTrainingModule (created by HR).
 * Not "crm-guide": /me/sales-training/crm-guide is the guide itself, and a
 * static route would shadow the module's /me/sales-training/[moduleId] page.
 */
export const CRM_GUIDE_MODULE_ID = "how-to-use-crm";

/** A section counts as freshly "Updated" for this many days after its last change. */
export const GUIDE_FRESH_DAYS = 30;

export const GUIDE_GROUPS = ["Start here", "Your day", "Working a lead", "Rules and alerts", "Reports", "Extra permissions"] as const;
export type GuideGroup = (typeof GUIDE_GROUPS)[number];

export type GuideStage = {
  code: string;
  label: string;
  kind: "active" | "won" | "lost";
  parked: boolean;
  pacedByTask: boolean;
  isDefault: boolean;
  /** Days untouched before an SLA breach; null = stage isn't SLA-timed. */
  slaDays: number | null;
};

/** What the guide reads from the database and the server-only CRM modules. */
export type GuideFacts = {
  stages: GuideStage[];
  statusGroups: { group: string; labels: string[] }[];
  defaultStatus: string | null;
  qualityReasons: string[];
  /** Lost stages a re-inquiry revives (labels). */
  revivedFromLost: string[];
  abandonedDays: number;
  stuckDays: number;
  firstResponseHours: number;
  upcomingTaskDays: number;
  followUpCapDays: number;
  followUpReviewDays: number;
  remarketingCapDays: number;
  followUpCapOn: boolean;
  remarketingCapOn: boolean;
  remarketingOn: boolean;
  remarketingOffsets: number[];
};

/** `**Label**` marks an on-screen label; the renderer bolds it. */
export type GuideBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; title?: string; items: string[] }
  | { kind: "tips"; title?: string; items: string[] }
  | { kind: "warn"; title?: string; items: string[] }
  | { kind: "table"; title?: string; head: string[]; rows: string[][] };

export type GuideSection = {
  id: string;
  title: string;
  group: GuideGroup;
  /** CRM pages this section teaches. The first linkable one gets "Open in CRM". */
  pages: string[];
  /** Also documented here, but not a page to link to (a dynamic route, a role permission). */
  covers?: string[];
  /**
   * Who sees the section in the BDE view: anyone who can open one of these
   * hrefs. Defaults to `pages`; empty = everyone.
   */
  showIf?: string[];
  summary: string;
  blocks: GuideBlock[];
};

export type GuideChange = { date: string; section: string; title: string; detail: string };

/**
 * What's new, newest first. One line per change a BDE would notice; `section`
 * is the GuideSection id it updates (drives the "Updated" pill).
 */
export const CRM_GUIDE_CHANGES: GuideChange[] = [
  {
    date: "2026-11-07",
    section: "leads-list",
    title: "Find leads with no source",
    detail: "The source filter on **Leads** has a **(Blank) — no source** option. Tick it to list leads that have no source set.",
  },
  {
    date: "2026-11-07",
    section: "log-call",
    title: "Voxbay calls on the Timeline",
    detail: "Calls made or taken on Voxbay now appear on the lead's **Timeline** by themselves, with **Play recording**. They don't replace **Log call**.",
  },
  {
    date: "2026-11-04",
    section: "basics",
    title: "CRM Guide",
    detail: "This guide now lives in Training & Development and updates itself as the CRM changes.",
  },
  {
    date: "2026-11-03",
    section: "attention",
    title: "Waiting stages judged by the task date",
    detail: "Leads in a waiting stage (such as Long Followup) stay clear while their next task is in the future, and turn **Stuck** once that date passes.",
  },
  {
    date: "2026-11-03",
    section: "leads-list",
    title: "Date filters use India time",
    detail: "**Created** and **Assigned** now cut at midnight IST, so a day's leads match the day you saw them.",
  },
  {
    date: "2026-10-26",
    section: "my-day",
    title: "My Day",
    detail: "One page that lists who to contact next, in order: WhatsApp replies owed, uncontacted new leads, tasks due, ratings due.",
  },
  {
    date: "2026-10-26",
    section: "log-call",
    title: "One-step call logging",
    detail: "**Log call** records the outcome, updates the status and books the next follow-up in one save.",
  },
  {
    date: "2026-10-26",
    section: "lead-page",
    title: "Candidate story",
    detail: "When a candidate has other records, the lead page lists them with their latest notes.",
  },
  {
    date: "2026-10-26",
    section: "dashboard",
    title: "Best Performer",
    detail: "Dashboard numbers follow the date filter, and a monthly **Best Performer** box ranks the team.",
  },
  {
    date: "2026-10-26",
    section: "partner-enrollments",
    title: "Partner fee installments",
    detail: "Record partner-programme course fees and installments in **Partner Enrollments**.",
  },
  {
    date: "2026-10-24",
    section: "quality",
    title: "Lead quality rating",
    detail: "Rating every lead **Good**, **Average**, **Poor** or **Junk** is now mandatory.",
  },
  {
    date: "2026-10-19",
    section: "campaign-reports",
    title: "Broadcast Report",
    detail: "See who replied to a WhatsApp campaign on your leads, and whether anyone has answered them.",
  },
  {
    date: "2026-10-12",
    section: "alarms",
    title: "Uncontacted-lead alarm",
    detail: "A red pop-up reminds you of new leads you haven't contacted yet.",
  },
];

/**
 * CRM pages, sidebar items and role permissions that deliberately have no BDE
 * section, with the reason. tests/crm-guide.test.ts requires every CRM href to
 * be either covered by a section or listed here.
 */
export const CRM_GUIDE_EXCLUDED: Record<string, string> = {
  "/crm/broadcasts": "Sending broadcasts is a marketing job; BDEs work the replies (Inbox, Campaign reports).",
  "/crm/templates": "Template setup is for admins/marketing; BDEs pick templates inside the lead and the Inbox.",
  "/crm/meta-reconcile": "Admin / Marketing Admin tool.",
  "/crm/voxbay-reconcile": "Admin / Marketing Admin tool.",
  "/crm/settings": "Admin setup.",
  "/crm/settings/whatsapp-connect": "Admin setup.",
  "/crm/team/bde-enrollment": "Admin money view.",
  "/crm/team/lead-quality": "Admin / Marketing Admin report.",
};

const NAV = new Map(MODULES.flatMap((m) => m.pages).map((p) => [p.href, p]));
const PERMISSION = new Map(ROLE_PERMISSIONS.map((p) => [p.href, p]));

/** Today's sidebar label for a page, bolded — so a renamed page renames here too. */
function nav(href: string): string {
  return `**${NAV.get(href)?.label ?? href}**`;
}

/** "CRM → ACTIVITY → My Day" — where the page sits in the left bar and tabs. */
function where(href: string): string {
  const p = NAV.get(href);
  return p?.group ? `CRM → **${p.group}** → ${nav(href)}` : `CRM → ${nav(href)}`;
}

const b = (s: string) => `**${s}**`;

/** "a, b and c" (each bolded). */
function list(xs: string[], join = "and"): string {
  const parts = xs.map(b);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${join} ${parts[parts.length - 1]}`;
}

function minutes(n: number): string {
  if (n % 60 === 0) return n === 60 ? "1 hour" : `${n / 60} hours`;
  return `${n} minutes`;
}

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** What each role permission lets its holder do — shown in the extra-permissions section. */
const PERMISSION_HELP: Record<string, string> = {
  "/crm/assign": "Assign and reassign leads: the **Consultant** column on Leads, the lead's **Consultant** card and the Inbox **Owner** become dropdowns.",
  "/crm/history": "See a lead's **History** tab — the full audit log of every change.",
  "/crm/team-all": "Switch the Dashboard between **Whole team** and **Just me** (view only).",
  "/crm/referral-leads": "Create referral leads (**New referral**) without being a BDE. They come in unassigned, with source Candidate Referral.",
  "/crm/enrolled-tasks": "Add tasks on any Enrolled lead, and complete or edit your own tasks there.",
  "/crm/notes-all": "Add notes on any lead. These notes don't reset the lead's last-update clock.",
  "/crm/leads-only": "Leads only: the Inbox, reports and notifications are hidden for your role.",
};

/**
 * The guide's sections, in reading order. `canSee` trims per-viewer rows
 * (e.g. the sidebar table); which whole sections a viewer gets is
 * visibleSections()'s job.
 */
export function crmGuideSections(f: GuideFacts, canSee: (href: string) => boolean = () => true): GuideSection[] {
  const stage = (code: string, fallback: string) => b(f.stages.find((s) => s.code === code)?.label ?? fallback);
  const NEW = stage("not_yet_started", "New");
  const FU = stage("follow_up", "Follow-Up");
  const PIPE = stage("pipeline", "Pipeline");
  const ENR = stage("enrolled", "Enrolled");
  const RM = stage("re_marketing", "Re-marketing");
  const CENTRAL = b(
    f.stages.find((s) => s.code === "centralised_marketing" || /central.*market/i.test(s.label))?.label ?? "Centralised Marketing",
  );
  const parked = f.stages.filter((s) => s.parked).map((s) => s.label);
  const paced = f.stages.filter((s) => s.pacedByTask).map((s) => s.label);
  const lost = f.stages.filter((s) => s.kind === "lost" && s.code !== "duplicate").map((s) => s.label);
  const timed = f.stages.filter((s) => s.slaDays != null);
  const alarmAfter = minutes(UNCONTACTED_AFTER_MINUTES);
  const outcome = (k: keyof typeof CALL_OUTCOME_LABEL) => b(CALL_OUTCOME_LABEL[k]);

  // Rows are filled in once every section exists (see the end of this function).
  const sidebarPages = MODULES.find((m) => m.id === "crm")!.pages.filter(
    (p) => !(p.href in CRM_GUIDE_EXCLUDED) && !p.adminOnly && canSee(p.href),
  );
  const sidebarTable: GuideBlock = { kind: "table", title: "Where things are in the left bar", head: ["Page", "Left-bar group", "Covered in"], rows: [] };

  const sections: GuideSection[] = [
    // ── Start here ──────────────────────────────────────────────────────────
    {
      id: "basics",
      title: "How the CRM is organised",
      group: "Start here",
      pages: [],
      summary:
        "The CRM holds every enquiry from first contact to enrolment. You work the leads **assigned to you**: you can open anyone's lead, but only your own can be changed.",
      blocks: [
        sidebarTable,
        {
          kind: "tips",
          items: [
            `Start every day on ${nav("/crm/my-day")} and end it with your ${nav("/crm/report")}.`,
            "Log everything in the CRM — calls, WhatsApps, notes. Your Dashboard, Daily Report and scorecard are built only from what you log.",
            "A lock next to a consultant's name means the lead isn't yours. You can read it, not change it.",
          ],
        },
      ],
    },
    {
      id: "stages",
      title: "Stage, status, quality and temperature",
      group: "Start here",
      pages: [],
      summary: "Every lead carries four labels. They answer different questions, so keep all four current.",
      blocks: [
        {
          kind: "table",
          head: ["Label", "It answers", "Who sets it"],
          rows: [
            ["Stage", "Where is the lead in the pipeline?", "You, on the stage bar (a few stages only by an action)"],
            ["Status", "Where does the conversation stand? It cuts across every stage.", "You, after each contact"],
            [
              "Quality",
              `Was it a genuine enquiry? (${LEAD_QUALITIES.map((q) => q.label).join(" / ")})`,
              `You — mandatory ${days(QUALITY_DUE_AFTER_DAYS)} after the lead comes in`,
            ],
            ["Temperature", `How likely right now? (${LEAD_TEMPERATURES.map((t) => t.label).join(" / ")})`, "You, when you can judge it"],
          ],
        },
        {
          kind: "table",
          title: "Pipeline stages (as set up in the CRM today)",
          head: ["Stage", "Type", "Flagged if untouched for", "Notes"],
          rows: f.stages.map((s) => [
            s.label,
            s.kind === "won" ? "Won" : s.kind === "lost" ? "Closed (lost)" : "Working",
            s.slaDays != null ? `more than ${days(s.slaDays)}` : "—",
            [
              s.isDefault ? "New leads start here." : "",
              s.code === "pipeline" ? "Set only by **Set deal**." : "",
              s.code === "enrolled" ? "Set only by **Enroll**." : "",
              s.code === "duplicate" ? "Set only by the import's duplicate check." : "",
              s.parked ? "Parked: nurtured centrally, never flagged." : "",
              s.pacedByTask ? "Waiting stage: judged by your next task's date." : "",
            ]
              .filter(Boolean)
              .join(" "),
          ]),
        },
        ...(f.statusGroups.length
          ? [{ kind: "table" as const, title: "Statuses, by group", head: ["Group", "Statuses"], rows: f.statusGroups.map((g) => [g.group, g.labels.join(" · ")]) }]
          : []),
        {
          kind: "text",
          text:
            (f.defaultStatus ? `New leads start with status ${b(f.defaultStatus)}. ` : "") +
            `The leads list shows how many days a status has stayed the same, in amber after ${days(STATUS_STALE_DAYS)}.`,
        },
      ],
    },

    // ── Your day ────────────────────────────────────────────────────────────
    {
      id: "my-day",
      title: "Start every day on My Day",
      group: "Your day",
      pages: ["/crm/my-day"],
      summary: `${where("/crm/my-day")} is your to-do list, already in the right order. Work it top to bottom.`,
      blocks: [
        {
          kind: "steps",
          items: [
            "**1 · Waiting for your reply on WhatsApp** — candidates who wrote last, longest wait first. Each row shows how long they've waited and how much of the 24-hour reply window is left. Click **Reply** to answer in the Inbox.",
            `**2 · New leads not contacted yet** — your ${NEW} leads assigned more than ${alarmAfter} ago with no call, WhatsApp or email logged. Click **Call**, then log what happened on the lead.`,
            "**3 · Tasks** — your tasks that are overdue or due today, soonest first.",
            `**4 · Quality ratings due** — leads past the ${days(QUALITY_DUE_AFTER_DAYS)} rating deadline. Rate these first: their stage and tasks are locked until you do.`,
          ],
        },
        {
          kind: "tips",
          items: [
            "Click **Start with the first** to open the top item.",
            "My Day itself changes nothing — every action happens on the lead or chat it opens. Refresh it to watch the list shrink.",
          ],
        },
        {
          kind: "warn",
          items: [
            `My Day's WhatsApp list counts chats where you are the chat owner. The ${nav("/crm/inbox")} also shows chats on leads you own, so check **Needs reply** there too.`,
          ],
        },
      ],
    },
    {
      id: "inbox",
      title: "Answer WhatsApp in the Inbox",
      group: "Your day",
      pages: ["/crm/inbox"],
      summary: `${where("/crm/inbox")} holds the WhatsApp chats on the company number for leads assigned to you. The badge counts chats waiting on a reply.`,
      blocks: [
        {
          kind: "steps",
          items: [
            "The Inbox opens on **Needs reply**: chats where the candidate wrote last. **Mine**, **Unread** and **All** are the other views.",
            "Open a chat. The pill at the top is the reply window: green **…h …m left** means you can type freely; grey **Template only** means 24 hours have passed since the candidate's last message.",
            "Inside the window, type your reply and press Enter (Shift+Enter for a new line) — or switch to **Template**.",
            "Outside the window, pick an approved template under **Choose a template…**, fill each {{1}} box, check **This is what will be sent** and click **Send this message**.",
            "Use the right-hand panel to update the lead without leaving the chat: stage, status, service, quality, and **+ Add task**. Select text in a message to use it as the name, country or destination.",
          ],
        },
        {
          kind: "tips",
          items: [
            "Every reply you send is logged on the lead's timeline as a WhatsApp contact by you, so it counts for your response time and stops the uncontacted alarm.",
            "**Close conversation** clears a finished chat from your list. It doesn't change the lead's stage, and the chat reopens by itself if the candidate writes again.",
          ],
        },
        {
          kind: "warn",
          items: [
            "You can send text, templates and voice notes (the mic button, inside the window only). There is no button for sending files or images.",
            "**Read-only** means the chat belongs to another consultant's lead — only the assigned consultant or an admin can reply.",
            "No templates in the list means none are assigned to you yet. Ask an admin.",
          ],
        },
      ],
    },
    {
      id: "tasks",
      title: "Tasks and the next-step rule",
      group: "Your day",
      pages: ["/crm/tasks"],
      summary: "Every follow-up you owe is a task, and an active lead must always have a next one.",
      blocks: [
        {
          kind: "steps",
          title: "Add a task on a lead",
          items: [
            "Open the lead → **Tasks** tab.",
            `Pick the type: ${list([...TASK_TYPES], "or")}.`,
            "Set a **Due date** and **Priority**, add a note if it helps, and click **Add task**.",
          ],
        },
        {
          kind: "steps",
          title: "Work your task list",
          items: [
            `Open ${where("/crm/tasks")}. You land on your open tasks; the chips **Overdue**, **Due today** and **Re-inquiry** narrow it.`,
            "Click **Done** when a task is finished, or **Edit** to change its subject, due date, priority or assignee.",
            "A **Re-inquiry** task means the candidate enquired again — call them first.",
          ],
        },
        {
          kind: "warn",
          items: [
            `Completing the **last open task** on an active lead opens **Schedule the next step**: book the next task, then click **Complete & schedule**.${parked.length ? ` Leads in ${list(parked)} and` : ""} won or lost leads are exempt.`,
            "Pushing a task's due date later does **not** count as working the lead. Only real contact, notes, stage or status changes and completed tasks do.",
          ],
        },
        {
          kind: "text",
          text: "If automatic reminders are switched on for you, a task with a due date shows **If this isn’t done in time**: tick **WhatsApp** or **Email** and the candidate is messaged the morning after the due date if the task is still open. Completing the task cancels it.",
        },
      ],
    },
    {
      id: "daily-report",
      title: "Submit your Daily Report",
      group: "Your day",
      pages: ["/crm/report"],
      summary: `${where("/crm/report")} is your end-of-day report. The numbers fill themselves in from what you logged; you add the story.`,
      blocks: [
        {
          kind: "steps",
          items: [
            "The tiles show today's numbers: leads touched, contacts logged, notes, tasks, new leads, enrolments, open tasks due and active CRM time. **Live preview — not yet submitted** means they're still updating.",
            "Write **Summary of the day** (required). Add **Blockers / help needed** and **Plan for next day** if you have any.",
            "Click **Submit report**. You can **Update report** until your manager reviews it.",
          ],
        },
        {
          kind: "tips",
          items: [
            `Missed a day? Use the date arrows — you can still submit for today and the ${days(BACKDATE_DAYS)} before it.`,
            "Once your manager clicks **Mark reviewed** the report is locked, and their note shows on it.",
          ],
        },
        { kind: "warn", items: ["Only what you logged in the CRM is counted. A call you didn't log isn't in your report."] },
      ],
    },
    {
      id: "notifications",
      title: "Notifications",
      group: "Your day",
      pages: ["/crm/notifications"],
      summary: `${where("/crm/notifications")} is where the CRM tells you something changed. Its badge counts unread ones.`,
      blocks: [
        {
          kind: "table",
          head: ["Notification", "What to do"],
          rows: [
            ["New lead assigned to you / Lead reassigned to you", `The lead is yours now — contact it within ${alarmAfter}.`],
            ["Re-marketing lead replied", `The candidate answered a re-marketing message and is back in ${FU}. Call them.`],
            ["Automated reminder sent to your candidate", "A task reminder went out because the task was still open. Follow up and complete it."],
            [`N leads moved to ${CENTRAL}`, "Leads passed a time limit and were taken off you (only when the limits are switched on)."],
          ],
        },
        {
          kind: "tips",
          items: [
            "**Open ↗** takes you to the lead; **Mark read** clears it.",
            "Keep **Notify me when a lead is assigned to me** ticked under **Notification settings**.",
          ],
        },
      ],
    },

    // ── Working a lead ──────────────────────────────────────────────────────
    {
      id: "leads-list",
      title: "Find your leads",
      group: "Working a lead",
      pages: ["/crm/leads"],
      summary: `${where("/crm/leads")} lists every lead. As a BDE it opens on your own.`,
      blocks: [
        {
          kind: "steps",
          items: [
            `The chips **My leads**, **My new leads** and **All leads** switch the view. **My new leads** counts your leads still in ${NEW}.`,
            "Type a name, email or phone in **Search name, email, phone…** and press Enter. Phone search ignores spaces and dashes.",
            "Narrow it with the filters — each lets you tick several values: stage, source, service, consultant, **Any task**, **Any last update**, **Assigned**, **Created**, temperature, quality, status, country and age.",
            "In the source filter, **(Blank) — no source** finds leads that have no source set. Open one and set its source so it counts for the right channel.",
            "Click a candidate's name to open the lead. The icons at the end of a row email, WhatsApp, call or open it.",
          ],
        },
        {
          kind: "tips",
          title: "Build a chase list",
          items: [
            "**Any task → No open task** shows your leads with no next step booked.",
            "**Any last update → No update 11–20 days** (and the other ranges) shows leads going cold.",
            "**All statuses** finds every lead in, say, Details Sent and Not Responding, whatever its stage.",
            "**Export Excel** downloads exactly what you've filtered.",
          ],
        },
        {
          kind: "text",
          text: "Drag column headers to reorder them; **Reset columns** puts them back. **Assigned** and **Created** follow India time.",
        },
      ],
    },
    {
      id: "new-lead",
      title: "Add a new lead",
      group: "Working a lead",
      pages: ["/crm/leads"],
      summary: "For an enquiry that came straight to you — a call, a walk-in, a referral.",
      blocks: [
        {
          kind: "steps",
          items: [
            "On Leads, click **New lead**.",
            `Fill **Candidate name** (the only required field), phone and/or email, **Source**, **Service** and **Qualification**. If you pick **Others**, type the qualification (up to ${QUALIFICATION_OTHER_MAX} characters, e.g. MBA).`,
            "Leave **Stage** and **Status** on **Default** unless you already know more. Set **Temperature** if you can judge it.",
            "Click **Create lead**. It is assigned to you.",
          ],
        },
        {
          kind: "warn",
          items: [
            "If the phone or email already belongs to a lead, **no new lead is created** — your enquiry is added to the existing lead as a re-inquiry and its owner gets a follow-up task. If your new lead doesn't show up, search the phone number.",
            `You can't create a lead straight into ${PIPE}, ${ENR} or Duplicate — those come from actions.`,
            `A lead created straight into ${CENTRAL} is left unassigned.`,
          ],
        },
      ],
    },
    {
      id: "lead-page",
      title: "The lead page",
      group: "Working a lead",
      pages: ["/crm/leads"],
      covers: ["/crm/leads/[id]"],
      summary: "Everything about one candidate, and every action you take on them.",
      blocks: [
        {
          kind: "table",
          head: ["Part", "What it's for"],
          rows: [
            ["Action bar", "**Email**, **WhatsApp**, **Call** — shown on your own leads only."],
            ["Stage bar", "The working stages. Click one to move the lead."],
            ["Status band", "One-click status pills; **More** shows every status."],
            ["Lead quality band", "Rate the enquiry."],
            ["Summary", "Contact details. The pencil edits them — and is where you close a lead to a lost stage."],
            ["Timeline", "Every call, message, note and change. Add notes here."],
            ["Deal", "**Set deal**, **Enroll**, **Reopen for another service**."],
            ["Consultant / Lead detail", "Who owns the lead and since when; source, service, qualification, linked candidate."],
            ["Tabs", "**Tasks**, **WhatsApp** (company-number chat), **Instagram** (only for leads from an Instagram DM)."],
          ],
        },
        {
          kind: "tips",
          items: [
            "If the candidate has other records, a banner lists them with **Latest notes on those records**. Read it before you call — someone may already have spoken to them.",
          ],
        },
        { kind: "warn", items: ["On a lead that isn't yours, everything is read-only."] },
      ],
    },
    {
      id: "log-call",
      title: "Log a call in one step",
      group: "Working a lead",
      pages: ["/crm/leads"],
      summary: "One save logs the call, updates the status and books your next follow-up.",
      blocks: [
        {
          kind: "steps",
          items: [
            "On the lead, click **Call**. The **Log call** sheet opens; tap **Call {number}** to dial.",
            `Pick the **Outcome**: ${list(Object.values(CALL_OUTCOME_LABEL), "or")}.`,
            "Choose **Status after this call**, or keep the current one.",
            "Under **Next follow-up**, **Book it now** is already ticked: pick **Later today**, **Tomorrow**, **In 3 days** or **Next week**, and adjust the subject.",
            "Add **Minutes** and a **Note**, then click **Log call**.",
          ],
        },
        {
          kind: "tips",
          items: [
            `${outcome("connected")} on a lead in ${NEW} moves it to ${FU} for you.`,
            `Not reached? Pick ${outcome("no_answer")} or ${outcome("busy")} — the follow-up switches to **Later today**. An unanswered call still counts as contact.`,
            "Log every attempt. Your response time and Daily Report are built from them.",
            "Calls you make or take on Voxbay appear on the lead's **Timeline** by themselves: incoming or outgoing, the result, the length, and **Play recording** when there is one. That entry is only the phone record. It doesn't count as a logged call, so still use **Log call** to record the outcome.",
          ],
        },
        {
          kind: "warn",
          items: ["If the lead's quality rating is overdue and the call would move the stage, the call isn't saved and the rating box opens. Rate the lead, then log the call again."],
        },
      ],
    },
    {
      id: "contact",
      title: "Email, WhatsApp and notes",
      group: "Working a lead",
      pages: ["/crm/leads"],
      summary: "Message the candidate and keep notes, all from the lead.",
      blocks: [
        {
          kind: "steps",
          items: [
            "**Email** opens **Email lead**: pick a **Template** (the candidate's details are filled in), check the subject and body, and click **Send email**. If the button says **Open email**, it opens your own mail app instead.",
            "**WhatsApp** in the action bar opens your own WhatsApp (wa.me) with a template. To write from the company number, use the lead's **WhatsApp** tab or the Inbox.",
            "On the **WhatsApp** tab, reply while the window is open, or choose a template and **Start conversation**.",
            "Notes: type in **Enter a note…** on the Timeline and click **Add note**.",
          ],
        },
        {
          kind: "tips",
          items: [
            "Write notes for whoever picks the lead up next: what the candidate said, what you promised, what happens next.",
            "You can edit any note on your lead, but only delete notes you wrote.",
          ],
        },
      ],
    },
    {
      id: "stage-status",
      title: "Move the stage and set the status",
      group: "Working a lead",
      pages: ["/crm/leads"],
      summary: "Stage = where the lead is in the pipeline. Status = where the conversation stands. Update both after every real conversation.",
      blocks: [
        {
          kind: "steps",
          title: "Move the stage",
          items: [
            "Click a stage on the stage bar.",
            lost.length
              ? `To close a lead as lost (${list(lost, "or")}), open **Summary** → pencil → **Stage**.`
              : "To close a lead as lost, open **Summary** → pencil → **Stage**.",
          ],
        },
        {
          kind: "steps",
          title: "Set the status",
          items: ["Click a pill on the **Status** band, or **More** for every status, grouped.", "Changing the status restarts its day count."],
        },
        {
          kind: "table",
          title: "Stages that do something extra",
          head: ["Stage", "What happens"],
          rows: [
            [PIPE, "Only reached by saving a deal (**Set deal**)."],
            [ENR, "Only reached by **Enroll**. The stage is locked afterwards."],
            [RM, "The lead starts receiving the re-marketing message series (when it is switched on)."],
            [CENTRAL, "The lead is taken off you and goes to the central pool."],
            ...(lost.length ? [[lost.map(b).join(" / "), "Closed as lost; its forecast deal is marked lost."]] : []),
          ],
        },
        {
          kind: "warn",
          items: [
            "Closing a lead (any won or lost stage except Duplicate) asks for its quality rating in the same step.",
            "**Someone else changed this lead's stage just now** means two people edited at once — reload and try again.",
          ],
        },
      ],
    },
    {
      id: "quality",
      title: "Rate lead quality",
      group: "Working a lead",
      pages: ["/crm/leads"],
      summary: `Tell marketing whether each enquiry was genuine. Rating is mandatory ${days(QUALITY_DUE_AFTER_DAYS)} after the lead comes in (or is assigned to you, if that's later).`,
      blocks: [
        { kind: "table", head: ["Rating", "Use it when"], rows: LEAD_QUALITIES.map((q) => [q.label, q.hint]) },
        {
          kind: "steps",
          items: [
            "On the lead, click a pill on the **Lead quality** band.",
            "For **Poor** or **Junk**, pick a **Reason**. Add a note if marketing should know something.",
            "Click **Save rating**. You can change it later.",
          ],
        },
        ...(f.qualityReasons.length ? [{ kind: "text" as const, text: `Reasons to choose from: ${f.qualityReasons.join(" · ")}.` }] : []),
        {
          kind: "warn",
          items: [
            `Once a rating is overdue, that lead's stage changes, task completion, the Connected-call stage move and **Enroll** are blocked until you rate it. A pop-up lists your overdue ratings every ${minutes(QUALITY_REMIND_EVERY_MINUTES)}.`,
          ],
        },
        { kind: "tips", items: ["Rate as soon as you know — usually right after the first real conversation."] },
      ],
    },
    {
      id: "deal-enroll",
      title: "Set a deal and enroll",
      group: "Working a lead",
      pages: ["/crm/leads"],
      summary: "When the candidate is serious, set a deal. When they pay, enroll them.",
      blocks: [
        {
          kind: "steps",
          title: "Set a deal",
          items: [
            "On the **Deal** card, click **Set deal**.",
            "Fill **Service**, **Expected value (₹)** and **Expected close date** (and **Deal owner (L2 BDE)** if asked).",
            `Click **Save deal**. The lead moves to ${PIPE} and the card shows **In forecast**.`,
          ],
        },
        {
          kind: "steps",
          title: "Enroll",
          items: [
            "Click **Enroll** on the Deal card.",
            "Check **Service**, **Expected value (₹)** and **Enrollment date** — set the date back if the deal actually closed earlier. Rate quality if asked.",
            "Click **Enroll**. Finance receives a revenue draft to approve (you don't approve revenue), and an operations project starts if the service has one.",
          ],
        },
        {
          kind: "steps",
          title: "A second service for an enrolled candidate",
          items: [
            `On the enrolled lead, click **Reopen for another service**, pick the new service and click **Reopen for follow-up**. A new lead in ${FU} is created for you, with a follow-up task due in 2 days.`,
          ],
        },
        {
          kind: "warn",
          items: [
            "The lead's **Source** must be set before you can set a deal or enroll.",
            "Enrolled by mistake? You can't undo it yourself — ask an admin or supervisor to **Un-enroll** it.",
          ],
        },
      ],
    },

    // ── Rules and alerts ────────────────────────────────────────────────────
    {
      id: "alarms",
      title: "Pop-up alarms",
      group: "Rules and alerts",
      pages: [],
      summary: "Two pop-ups follow you around DesGro until the work is done. They can't be switched off — only snoozed.",
      blocks: [
        {
          kind: "table",
          head: ["Pop-up", "When it appears", "What clears it"],
          rows: [
            [
              "N leads not contacted yet (red)",
              `A ${NEW} lead assigned to you over ${alarmAfter} ago with no call, WhatsApp or email logged. Repeats every ${minutes(UNCONTACTED_REMIND_EVERY_MINUTES)}.`,
              `Contact the candidate and log it, or move the lead out of ${NEW}.`,
            ],
            [
              "N leads need a quality rating",
              `Leads past the ${days(QUALITY_DUE_AFTER_DAYS)} rating deadline. Repeats every ${minutes(QUALITY_REMIND_EVERY_MINUTES)}.`,
              "Rate each one — you can do it right in the pop-up.",
            ],
          ],
        },
        {
          kind: "tips",
          items: [
            `**Remind me in ${UNCONTACTED_REMIND_EVERY_MINUTES} min** only snoozes the alarm.`,
            "Reassigning a lead restarts its clock for the new owner.",
            "The chime plays only after you've clicked or typed on the page once.",
          ],
        },
      ],
    },
    {
      id: "attention",
      title: "What gets a lead flagged",
      group: "Rules and alerts",
      pages: ["/crm/team/queue"],
      showIf: ["/crm/team"],
      summary: "Your manager sees these flags on every consultant. Keep yours at zero.",
      blocks: [
        {
          kind: "table",
          head: ["Flag", "A lead gets it when"],
          rows: [
            [
              "SLA breach",
              timed.length
                ? `It's untouched longer than its stage allows: ${timed.map((s) => `${s.label} ${days(s.slaDays!)}`).join(", ")}.`
                : "It's untouched longer than its stage allows.",
            ],
            ["Abandoned", `It's untouched for more than ${days(f.abandonedDays)}, in any stage.`],
            ["No next step", "It has no open task."],
            ["Stuck", `Its stage hasn't changed for more than ${days(f.stuckDays)}.`],
            ["First-response gap", `It had no first contact within ${f.firstResponseHours} hours of being assigned.`],
            ["Re-inquiry follow-up", "The candidate enquired again and the re-inquiry task is still open."],
            ["Quality overdue", `It's unrated ${days(QUALITY_DUE_AFTER_DAYS)} after coming in.`],
          ],
        },
        {
          kind: "text",
          text: "Working a lead means: a call, email or WhatsApp you send, a note, a stage or status change, a completed task, an enrolment. These do **not** count: editing details, pushing a task's date, reassigning, automated or bulk messages.",
        },
        {
          kind: "tips",
          items: [
            `An open task due within the next ${days(f.upcomingTaskDays)} keeps a lead clear of **SLA breach** and **Stuck** (not of **Abandoned**). Always book the next step.`,
            ...(parked.length ? [`Parked stages (${list(parked)}) are never flagged.`] : []),
            ...(paced.length
              ? [`Waiting stages (${list(paced)}) are judged by your next task's date: clear while it's in the future, **Stuck** as soon as it passes.`]
              : []),
          ],
        },
        {
          kind: "text",
          text: `See your own list on ${nav("/crm/team")} → **View all →**, which opens the **Follow-up queue** (**My leads needing attention**).`,
        },
      ],
    },
    {
      id: "time-limits",
      title: "Lead time limits",
      group: "Rules and alerts",
      pages: [],
      covers: ["/crm/lifecycle"],
      summary: "A lead can't sit with one consultant forever. Past these limits it goes to the central pool.",
      blocks: [
        {
          kind: "table",
          head: ["Stage", "Limit", "Right now"],
          rows: [
            [
              FU,
              `After ${days(f.followUpCapDays)} in ${FU} the lead moves to ${CENTRAL}. From day ${f.followUpReviewDays} a supervisor reviews it and can grant an extension.`,
              f.followUpCapOn ? "**On**" : "Off",
            ],
            [RM, `After ${days(f.remarketingCapDays)} in ${RM} the lead moves to ${CENTRAL}.`, f.remarketingCapOn ? "**On**" : "Off"],
          ],
        },
        {
          kind: "text",
          text: "When a lead is moved you lose it, its tasks and its WhatsApp chat, and you get a notification. A lead that comes back from the central pool always goes to a **different** consultant.",
        },
        {
          kind: "text",
          text:
            f.remarketingOn && f.remarketingOffsets.length
              ? `While a lead is in ${RM} it is sent ${f.remarketingOffsets.length} WhatsApp messages, on days ${f.remarketingOffsets.join(", ")} after it entered the stage. If the candidate replies, the lead comes back to ${FU} and you're notified.`
              : `The automatic re-marketing messages for ${RM} leads are switched off right now.`,
        },
        ...(f.revivedFromLost.length
          ? [
              {
                kind: "text" as const,
                text: `A lead closed as ${list(f.revivedFromLost, "or")} that enquires again is revived to ${RM}, with a high-priority re-inquiry task for its owner.`,
              },
            ]
          : []),
      ],
    },

    // ── Reports ─────────────────────────────────────────────────────────────
    {
      id: "dashboard",
      title: "Your Dashboard and L2 Scorecard",
      group: "Reports",
      pages: ["/crm/team", "/crm/team/scorecard-guide"],
      summary: `${where("/crm/team")} shows your numbers for any period and how you score.`,
      blocks: [
        {
          kind: "steps",
          items: [
            "It opens on this month; change the period with the date filter.",
            "The top tiles: new leads, leads assigned, contacts logged, tasks completed (and % on time).",
            "The attention strip counts your flagged leads — click through and clear them.",
            "**L2 Scorecard**: every L2 consultant's score out of 100. **Why this score →** shows what pulled yours down.",
            "**Best Performer** (pick a single month) ranks the team on enrolments against target, scorecard and conversion.",
          ],
        },
        {
          kind: "table",
          title: "How the L2 Scorecard adds up",
          head: ["Part", "Points", "Full marks when"],
          rows: [
            ["Conversion", String(SCORE_WEIGHTS.conversion), `${CONVERSION_TARGET_PCT}% or more of your assigned leads enrol`],
            ["Pipeline hygiene", String(SCORE_WEIGHTS.hygiene), "None of your leads is flagged"],
            ["Responsiveness", String(SCORE_WEIGHTS.responsiveness), `First contact within ${FIRST_RESPONSE_FAST_HOURS} hours (zero at ${RESPONSE_SLA_HOURS}+ hours)`],
            ["Task discipline", String(SCORE_WEIGHTS.discipline), "Every task completed on time"],
          ],
        },
        {
          kind: "text",
          text: `Bands: ${SCORE_BANDS.map((band, i) => (i === 0 ? `${band.label} ${band.min}+` : band.min === 0 ? `${band.label} below ${SCORE_BANDS[i - 1].min}` : `${band.label} ${band.min}–${SCORE_BANDS[i - 1].min - 1}`)).join(" · ")}. Only L2 consultants are scored.`,
        },
        { kind: "tips", items: ["**How is this score calculated?** on the Dashboard opens the full scorecard guide."] },
      ],
    },
    {
      id: "campaign-reports",
      title: "Campaign reports",
      group: "Reports",
      pages: ["/crm/broadcasts/report", "/crm/deliveries", "/crm/remarketing"],
      summary: "Follow up the marketing messages that went to your leads.",
      blocks: [
        {
          kind: "table",
          head: ["Report", "Use it to"],
          rows: (
            [
              ["/crm/broadcasts/report", "See who replied to a WhatsApp campaign on your leads. Work the **Needs reply** tab: click **Reply** on each. Target: every reply answered."],
              ["/crm/deliveries", "See re-marketing messages that didn't reach the lead (bad number, too many messages). Fix the number on the lead."],
              ["/crm/remarketing", "See each re-marketing series on your leads: what went out, what's due next, who replied."],
            ] as const
          )
            .filter(([href]) => canSee(href))
            .map(([href, use]) => [nav(href), use]),
        },
        {
          kind: "tips",
          items: ["A reply counts as answered once you send a WhatsApp or log a call after the candidate's latest message. Automated messages don't count."],
        },
      ],
    },
    {
      id: "partner-enrollments",
      title: "Partner Enrollments",
      group: "Reports",
      pages: ["/crm/partner-enrollments"],
      summary: `${where("/crm/partner-enrollments")} records course fees and installments for partner programmes.`,
      blocks: [
        {
          kind: "steps",
          items: [
            "Click **New enrollment**.",
            "Pick the **Program** and **Partner**, link the CRM lead, and fill the candidate, installment plan, intake month, course name, **Total course fee (AUD)** and the first installment.",
            "Open an enrollment to see the course fee, what's paid and the balance. Tick **Still paying only** to list who still owes.",
          ],
        },
        { kind: "warn", items: ["Details can't change once an installment is recorded — ask Finance."] },
      ],
    },

    // ── Extra permissions ───────────────────────────────────────────────────
    {
      id: "extra-permissions",
      title: "If your role has extra permissions",
      group: "Extra permissions",
      pages: [],
      covers: Object.keys(PERMISSION_HELP),
      showIf: Object.keys(PERMISSION_HELP),
      summary: "Some roles get extra rights in the CRM. If yours does, this is what each one means.",
      blocks: [
        {
          kind: "table",
          head: ["Permission", "What you can do"],
          rows: Object.entries(PERMISSION_HELP).map(([href, help]) => [PERMISSION.get(href)?.label ?? href, help]),
        },
      ],
    },
  ];

  if (sidebarTable.kind === "table") {
    sidebarTable.rows = sidebarPages.map((p) => [
      b(p.label),
      p.group ?? "",
      sections.find((s) => s.pages.includes(p.href) || s.covers?.includes(p.href))?.title ?? "",
    ]);
  }
  return sections;
}

/** Sections this viewer can use: any of its `showIf` (default `pages`) is visible, or it's general. */
export function visibleSections(sections: GuideSection[], canSee: (href: string) => boolean): GuideSection[] {
  return sections.filter((s) => {
    const gate = s.showIf ?? s.pages;
    return gate.length === 0 || gate.some(canSee);
  });
}

/** The change log, newest first, limited to sections in view. */
export function changesFor(sections: GuideSection[], all: GuideChange[] = CRM_GUIDE_CHANGES): GuideChange[] {
  const ids = new Set(sections.map((s) => s.id));
  return all.filter((c) => ids.has(c.section)).sort((a, z) => z.date.localeCompare(a.date));
}

export function sectionUpdatedOn(id: string, changes: GuideChange[]): string | null {
  return changes.reduce<string | null>((acc, c) => (c.section === id && (!acc || c.date > acc) ? c.date : acc), null);
}

export function guideLastUpdated(changes: GuideChange[]): string | null {
  return changes.reduce<string | null>((acc, c) => (!acc || c.date > acc ? c.date : acc), null);
}

/** Every CRM href the guide documents. */
export function guideCoverage(sections: GuideSection[]): Set<string> {
  return new Set(sections.flatMap((s) => [...s.pages, ...(s.covers ?? [])]));
}

// ── Knowledge check ──────────────────────────────────────────────────────────

export type GuideQuizQuestion = {
  /** Stable id — keeps a question's row (and its history) across rewordings. */
  key: string;
  prompt: string;
  options: string[];
  correct: number[];
  explanation: string;
};

/** Stable pseudo-random order per question, so the right answer isn't always A. */
function arrange(key: string, right: string[], wrong: string[]): { options: string[]; correct: number[] } {
  const all = [...right.map((t) => ({ t, ok: true })), ...wrong.filter((w) => !right.includes(w)).map((t) => ({ t, ok: false }))];
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const order = all
    .map((o, i) => ({ o, w: (Math.imul(h ^ (i + 1), 2654435761) >>> 0) % 1000 }))
    .sort((x, y) => x.w - y.w)
    .map((x) => x.o);
  return { options: order.map((o) => o.t), correct: order.flatMap((o, i) => (o.ok ? [i] : [])) };
}

/**
 * The guide's quiz. Synced into the CRM_GUIDE_MODULE_ID training module by
 * syncCrmGuideQuiz, so it changes with the facts it quotes.
 */
export function crmGuideQuiz(f: GuideFacts): GuideQuizQuestion[] {
  const label = (code: string, fallback: string) => f.stages.find((s) => s.code === code)?.label ?? fallback;
  const NEW = label("not_yet_started", "New");
  const FU = label("follow_up", "Follow-Up");
  const PIPE = label("pipeline", "Pipeline");
  const parked = f.stages.filter((s) => s.parked).map((s) => s.label);
  const alarmAfter = minutes(UNCONTACTED_AFTER_MINUTES);
  const scoreParts = [
    { name: "Conversion", pts: SCORE_WEIGHTS.conversion },
    { name: "Pipeline hygiene", pts: SCORE_WEIGHTS.hygiene },
    { name: "Responsiveness", pts: SCORE_WEIGHTS.responsiveness },
    { name: "Task discipline", pts: SCORE_WEIGHTS.discipline },
  ];
  const top = scoreParts.reduce((a, z) => (z.pts > a.pts ? z : a));

  const q = (key: string, prompt: string, right: string[], wrong: string[], explanation: string): GuideQuizQuestion => ({
    key,
    prompt,
    explanation,
    ...arrange(key, right, wrong),
  });

  return [
    q(
      "stage-vs-status",
      "What is the difference between a lead's Stage and its Status?",
      ["Stage is where the lead is in the pipeline; Status is where the conversation stands"],
      ["They are the same thing with two names", "Stage is set by marketing; Status is set by Finance", "Status is only used after the lead is enrolled"],
      "A lead has both. The Status cuts across every stage — e.g. Details Sent and Not Responding can happen in Qualify or Follow-Up.",
    ),
    q(
      "voxbay-call-entry",
      "A call you made on Voxbay already shows on the lead's Timeline. What else do you need to do?",
      ["Log the call with Log call, so the outcome and your follow-up are recorded"],
      ["Nothing — the Voxbay entry counts as a logged call", "Delete the Voxbay entry and log it again", "Ask an admin to approve the Voxbay entry"],
      "The Voxbay entry is the phone system's record. It doesn't count towards your response time or Daily Report — Log call does, and it books your next follow-up.",
    ),
    q(
      "uncontacted-alarm",
      "A new lead is assigned to you. If you don't call, WhatsApp or email them, when does the red “not contacted yet” pop-up start?",
      [`${alarmAfter} after it was assigned`],
      ["Straight away", "After 24 hours", "Never — it only shows on My Day"],
      `The alarm lists ${NEW} leads assigned to you over ${alarmAfter} ago with no contact logged, and repeats every ${minutes(UNCONTACTED_REMIND_EVERY_MINUTES)}.`,
    ),
    q(
      "alarm-clears",
      "Which of these take a lead off the “not contacted yet” pop-up? (Tick all that apply.)",
      ["Logging a call, WhatsApp or email to the candidate", `Moving the lead out of ${NEW}`],
      [`Clicking “Remind me in ${UNCONTACTED_REMIND_EVERY_MINUTES} min”`, "Opening the lead page"],
      "Snoozing only hides the pop-up for a while. Real contact, or a stage move, clears the lead.",
    ),
    q(
      "quality-overdue",
      `A lead came in more than ${days(QUALITY_DUE_AFTER_DAYS)} ago and you haven't rated its quality. What happens?`,
      ["Its stage changes and task completion are blocked until you rate it"],
      ["Nothing — the rating is optional", "The lead is reassigned to another BDE", "The lead is closed automatically"],
      `Rating is mandatory ${days(QUALITY_DUE_AFTER_DAYS)} after the lead comes in. Until then you can rate it any time.`,
    ),
    q(
      "poor-junk-reason",
      "You rate a lead Poor or Junk. What else must you give?",
      ["A reason from the list"],
      ["A manager's approval", "The candidate's documents", "Nothing else"],
      "Marketing uses the reasons to fix campaigns, so Poor and Junk always need one.",
    ),
    q(
      "last-task",
      "You mark the last open task done on an active lead. What does the CRM do?",
      ["Asks you to book the next follow-up before it completes the task"],
      ["Closes the lead as lost", "Completes it and leaves the lead with no task", "Sends it to a supervisor for approval"],
      `An active lead must always have a next step.${parked.length ? ` Leads in ${parked.join(", ")} and` : ""} won or lost leads are exempt.`,
    ),
    q(
      "connected-new",
      `You log a call with outcome “Connected” on a lead in ${NEW}. What happens to its stage?`,
      [`It moves to ${FU}`],
      ["It stays where it is", `It moves to ${PIPE}`, "The lead is enrolled"],
      "Log call does it in one save: the call, the status, the next follow-up and this stage move.",
    ),
    q(
      "wa-window",
      "The candidate's last WhatsApp message was more than 24 hours ago. What can you send from the Inbox?",
      ["Only an approved template"],
      ["Any free-text message", "Nothing — the chat is closed for good", "Only a photo"],
      "WhatsApp allows free text for 24 hours after the candidate's last message. After that, start again with a template.",
    ),
    q(
      "pipeline-how",
      `How does a lead get to the ${PIPE} stage?`,
      ["By saving a deal with “Set deal” on the lead's Deal card"],
      ["By clicking it on the stage bar", "Marketing moves it there", "Automatically after three calls"],
      `${PIPE} means there is a deal in the forecast, so only Set deal puts a lead there.`,
    ),
    q(
      "duplicate-create",
      "You add a new lead but it doesn't appear in your list. What is the most likely reason?",
      ["Its phone or email matched an existing lead, so the CRM added your enquiry to that lead instead"],
      ["New leads only appear the next day", "Leads without a source are deleted", "It went to Finance for approval"],
      "Search the phone number to find the existing lead. Its owner gets a re-inquiry task.",
    ),
    q(
      "enroll-revenue",
      "After you enroll a candidate, who approves the revenue?",
      ["Finance reviews and approves the revenue draft"],
      ["You approve it on the Deal card", "The candidate confirms it", "Nobody — it's approved automatically"],
      "Enroll sends Finance a revenue draft. You don't approve revenue yourself.",
    ),
    q(
      "second-service",
      "An enrolled candidate now wants a second service. What do you do?",
      ["Use “Reopen for another service” on the Deal card"],
      ["Create a new lead by hand", "Change the service on the enrolled lead", "Un-enroll the lead and enroll it again"],
      `Reopening creates a new lead in ${FU} for the new service and keeps the original enrolment untouched.`,
    ),
    q(
      "wrong-enroll",
      "You enrolled a lead by mistake. What do you do?",
      ["Ask an admin or supervisor to Un-enroll it"],
      ["Move it back on the stage bar", "Delete the lead", "Leave it — Finance will fix it"],
      "Un-enroll also reverses the revenue draft and the operations project, so only admins and supervisors have it.",
    ),
    q(
      "touch-clock",
      "Which of these count as working a lead (they reset its “last touched” clock)? (Tick all that apply.)",
      ["A call you log", "A note you add", "A stage or status change"],
      ["Pushing a task's due date later", "An automated or bulk message"],
      "Only real work counts. Moving a date or an automated message doesn't.",
    ),
    ...(parked.length
      ? [
          q(
            "parked",
            `Your lead is in ${parked[0]}. Why does it never show as an SLA breach or Stuck?`,
            ["It's a parked stage: those leads are nurtured centrally and never flagged"],
            ["Because its temperature is Hot", "Because it's enrolled", "Because it has a note"],
            `Parked stages (${parked.join(", ")}) rest on their own schedule and need no next task.`,
          ),
        ]
      : []),
    q(
      "scorecard",
      "Which part of the L2 Scorecard carries the most points?",
      [`${top.name} (${top.pts} points)`],
      scoreParts.filter((p) => p !== top).map((p) => `${p.name} (${p.pts} points)`),
      `The scorecard is ${scoreParts.map((p) => `${p.name} ${p.pts}`).join(", ")} — out of 100.`,
    ),
    q(
      "daily-report",
      "How far back can you still submit a missed Daily Report?",
      [`Today and the ${days(BACKDATE_DAYS)} before it`],
      ["Only today", "Any day this month", "Never — a missed day stays missed"],
      "Older days can't be reported, so submit every evening.",
    ),
  ];
}
