/**
 * The automation VOCABULARY and its pure logic: trigger and action types, the
 * matchers, and the starter recipes.
 *
 * Split out from `automations.ts` because the Automations rail renders this in
 * the browser, and the engine imports prisma, nodemailer and the WhatsApp
 * provider. A client component importing one constant from the engine pulled
 * all three into the browser bundle and broke the build — the kind of coupling
 * that is invisible until it is fatal, so the boundary is now a file.
 */
import type { Prisma } from "@prisma/client";

export const TRIGGER_TYPES = [
  "stage_entered",
  "score_threshold",
  "time_in_stage",
  "offer_sent",
  "no_activity",
  "application_created",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const ACTION_TYPES = [
  "move_stage",
  "assign_owner",
  "send_whatsapp_template",
  "send_email_template",
  "create_task",
  "notify_user",
  "add_tag",
  "schedule_followup",
  "add_to_talent_pool",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type Trigger = { type: TriggerType; params?: Record<string, unknown> };
export type Condition = { field: string; op: "eq" | "neq" | "gt" | "lt" | "contains"; value: unknown };
export type Action = { type: ActionType; params?: Record<string, unknown> };

export const ERROR_STREAK_LIMIT = 3;

/** The context an event-driven trigger is evaluated against. */
export type FireContext = {
  event: "stage_entered" | "application_created" | "offer_sent" | "scored";
  applicationId: string;
  stageName?: string | null;
  stageKind?: string | null;
  aiScore?: number | null;
};

/** Does this automation's trigger match what just happened? */
export function triggerMatches(trigger: Trigger, ctx: FireContext): boolean {
  switch (trigger.type) {
    case "application_created":
      return ctx.event === "application_created";
    case "offer_sent":
      return ctx.event === "offer_sent";
    case "stage_entered": {
      if (ctx.event !== "stage_entered") return false;
      const want = String(trigger.params?.stageName ?? "").trim().toLowerCase();
      if (!want) return true;
      return (ctx.stageName ?? "").trim().toLowerCase() === want;
    }
    case "score_threshold": {
      if (ctx.event !== "scored" && ctx.event !== "application_created") return false;
      const min = Number(trigger.params?.minScore ?? 0);
      return typeof ctx.aiScore === "number" && ctx.aiScore >= min;
    }
    // Time-based triggers are not events; the cron sweeps for them.
    case "time_in_stage":
    case "no_activity":
      return false;
  }
}

/**
 * The `where` that finds applications a TIME-BASED trigger currently matches.
 * Also what the dry-run uses, so "which applications would this touch" and
 * "which will it touch" are the same query.
 */
export function timeTriggerWhere(trigger: Trigger, now: Date = new Date()): Prisma.HiringApplicationWhereInput | null {
  const days = Number(trigger.params?.days ?? 0);
  if (!Number.isFinite(days) || days <= 0) return null;
  const cutoff = new Date(now.getTime() - days * 86_400_000);

  if (trigger.type === "time_in_stage") {
    return {
      deletedAt: null,
      status: "active",
      stageEnteredAt: { lt: cutoff },
      ...(trigger.params?.stageName
        ? { stage: { name: { equals: String(trigger.params.stageName), mode: "insensitive" } } }
        : {}),
    };
  }

  if (trigger.type === "no_activity") {
    return {
      deletedAt: null,
      status: "active",
      // Never contacted counts as no activity — that is the case that matters
      // most, and a `lt` on a null column would silently exclude it.
      OR: [{ lastContactedAt: null, appliedAt: { lt: cutoff } }, { lastContactedAt: { lt: cutoff } }],
    };
  }

  return null;
}

/** Evaluate the optional conditions against an application row. */
export function conditionsPass(conditions: Condition[], row: Record<string, unknown>): boolean {
  return conditions.every((c) => {
    const actual = row[c.field];
    switch (c.op) {
      case "eq":
        return actual === c.value;
      case "neq":
        return actual !== c.value;
      case "gt":
        return typeof actual === "number" && typeof c.value === "number" && actual > c.value;
      case "lt":
        return typeof actual === "number" && typeof c.value === "number" && actual < c.value;
      case "contains":
        return String(actual ?? "").toLowerCase().includes(String(c.value ?? "").toLowerCase());
      default:
        return false;
    }
  });
}

/** The starter recipes (§3.10). Created INACTIVE — nothing fires unasked. */
export const STARTER_RECIPES: {
  name: string;
  description: string;
  trigger: Trigger;
  actions: Action[];
}[] = [
  {
    name: "Reactivate cold candidates",
    description: "When a candidate has gone quiet for 30 days, put them in the talent pool to nurture.",
    trigger: { type: "no_activity", params: { days: 30 } },
    actions: [{ type: "add_to_talent_pool", params: { state: "re_engage" } }],
  },
  {
    name: "Background check kickoff",
    description: "A day after an offer goes out, remind the owner to start document checks.",
    trigger: { type: "offer_sent" },
    actions: [
      { type: "create_task", params: { days: 1, title: "Start document and reference checks" } },
    ],
  },
  {
    name: "Offer expiry reminder",
    description: "Nudge the recruiter two days before an offer lapses.",
    trigger: { type: "offer_sent" },
    actions: [{ type: "schedule_followup", params: { days: 5 } }],
  },
  {
    name: "Recruiter coordination handoff",
    description: "When someone reaches Interview, assign a scheduling owner.",
    trigger: { type: "stage_entered", params: { stageName: "Interview" } },
    actions: [{ type: "notify_user", params: { title: "Interview stage — book a slot" } }],
  },
  {
    name: "Candidate-experience pulse",
    description: "Two days after the final interview, ask the candidate how it went.",
    trigger: { type: "time_in_stage", params: { stageName: "Interview", days: 2 } },
    actions: [
      {
        type: "send_email_template",
        params: {
          subject: "How did your interview go?",
          body: "Hi {{firstName}},\n\nYou spoke with us about the {{jobTitle}} role recently. How did you find it? Anything we could have done better?\n\n— DESMA International",
        },
      },
    ],
  },
  {
    name: "Stalled requisition nudge",
    description: "Tell the owner when a shortlisted candidate has sat untouched for a week.",
    trigger: { type: "time_in_stage", params: { stageName: "Shortlisted", days: 7 } },
    actions: [
      { type: "notify_user", params: { title: "Shortlisted and stalled for a week" } },
    ],
  },
];
