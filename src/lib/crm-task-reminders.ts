/**
 * Task auto-reminders: the VOCABULARY and the pure logic.
 *
 * The feature in one line: when a consultant creates a task they arm a
 * candidate-facing safety net, and if the task is still open when it falls due,
 * the candidate hears from us anyway — an approved WhatsApp template and an
 * email from the team mailbox.
 *
 * Split from the engine (`crm-task-reminders-engine.ts`) because the task
 * composer renders these constants in the BROWSER, while the engine imports
 * prisma, nodemailer and the WhatsApp provider. The hiring module learned this
 * the hard way: a client component importing one constant from an engine pulled
 * all three into the bundle and broke the build. The boundary is a file.
 *
 * Everything here is pure and therefore testable without a database — which
 * matters more than usual, because the alternative way to verify "does this
 * fire at the right moment, to the right person, at most once" is to send real
 * messages to real candidates.
 */
import { istDateString, addDays } from "./lead-pulse-dates";
import { CRM_TEMPLATE_MERGE_FIELDS, type CrmMergeField } from "./crm";

export const TASK_REMINDER_CHANNELS = ["whatsapp", "email"] as const;
export type TaskReminderChannel = (typeof TASK_REMINDER_CHANNELS)[number];

export const CHANNEL_LABELS: Record<TaskReminderChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
};

/**
 * IST is a fixed UTC+5:30 with no daylight saving, which is what makes the
 * arithmetic below safe to do with a constant rather than a timezone library.
 * The rest of the CRM already leans on this (see lead-pulse-dates).
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * The hour (IST) a reminder becomes eligible to send, and the hour after which
 * it must wait for tomorrow.
 *
 * These exist because the cron is not a clock. Vercel's Hobby plan fires crons
 * daily, so the drain runs at a handful of fixed times and "when it fires" is
 * not something this feature controls. Without a window, a schedule change or a
 * backed-up drain could put a marketing-category WhatsApp message on a
 * candidate's phone at 3am — which is both a complaint and a quality-rating hit.
 * The window is enforced in the drain, independently of the cron schedule, so
 * the schedule can change without anyone re-deriving whether it is still safe.
 */
export const SEND_WINDOW_START_HOUR_IST = 9;
export const SEND_WINDOW_END_HOUR_IST = 20;

/** At most one automated reminder per candidate per this many hours. */
export const DEFAULT_COOLDOWN_HOURS = 24;

/** Hour of the day (0–23) in IST. */
export function istHour(date: Date): number {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours();
}

/**
 * When a task's reminder becomes eligible to send: 09:00 IST on the day AFTER
 * the due date.
 *
 * The day after, not the due day itself. `dueAt` comes from a date picker with
 * no time component, so it lands on midnight — firing "once due" would mean
 * messaging the candidate at the START of the day the consultant was given to
 * do the job, before they have had any chance at all. Giving them the whole due
 * day is the difference between a safety net and a race.
 *
 * Returns null for a task with no due date: there is no moment to fire at, and
 * a reminder that fires immediately is not what anyone armed.
 */
export function reminderFireAt(dueAt: Date | null | undefined): Date | null {
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  const dayAfter = addDays(istDateString(dueAt), 1);
  // Midnight IST of that day, then forward to the window's opening hour. Doing
  // the arithmetic in milliseconds rather than formatting a UTC time string
  // keeps it correct if the hour is ever moved earlier than 05:30 IST, where
  // the UTC instant falls on the PREVIOUS calendar day.
  const istMidnightUtc = Date.parse(`${dayAfter}T00:00:00.000Z`) - IST_OFFSET_MINUTES * 60_000;
  return new Date(istMidnightUtc + SEND_WINDOW_START_HOUR_IST * 3_600_000);
}

/** Whether a candidate-facing message may go out right now. See the window note. */
export function isWithinSendWindow(now: Date = new Date()): boolean {
  const h = istHour(now);
  return h >= SEND_WINDOW_START_HOUR_IST && h < SEND_WINDOW_END_HOUR_IST;
}

/**
 * Why a reminder will not be sent.
 *
 * Recorded on the row rather than deleting it, so "why did this candidate not
 * get their reminder" always has an answer — the same reasoning that gives
 * WaBroadcastRecipient a `skipReason` instead of a filtered-out audience.
 */
export type ReminderSkipReason =
  | "no_phone"
  | "no_email"
  | "opted_out"
  | "undeliverable"
  | "cooldown"
  | "lead_closed"
  | "not_configured"
  | "email_quota";

export const SKIP_REASON_LABELS: Record<ReminderSkipReason, string> = {
  no_phone: "No usable phone number on the lead.",
  no_email: "No email address on the lead.",
  opted_out: "The candidate opted out of WhatsApp.",
  undeliverable: "Meta reported this number as undeliverable.",
  cooldown: "The candidate was already reminded about another task recently.",
  lead_closed: "The lead was marked lost.",
  not_configured: "No default template is configured for this channel.",
  email_quota: "The daily email quota is exhausted.",
};

/** The lead facts a skip decision is made from. */
export type ReminderLeadFacts = {
  phoneE164: string | null;
  email: string | null;
  whatsappOptedOutAt: Date | null;
  whatsappUndeliverableAt: Date | null;
};

/**
 * Whether this channel can reach this candidate at all.
 *
 * Opt-out first, deliberately: it is a promise we made to the candidate, and it
 * outranks every other reason including "but this one is transactional". The
 * order also decides which reason gets recorded when several apply, and
 * "opted out" is the one a human needs to see.
 */
export function skipReasonForChannel(
  channel: TaskReminderChannel,
  lead: ReminderLeadFacts,
): ReminderSkipReason | null {
  if (channel === "whatsapp") {
    if (lead.whatsappOptedOutAt) return "opted_out";
    if (lead.whatsappUndeliverableAt) return "undeliverable";
    if (!lead.phoneE164) return "no_phone";
    return null;
  }
  if (!lead.email?.trim()) return "no_email";
  return null;
}

/**
 * Is this lead still inside its cooldown?
 *
 * The guard that keeps a candidate with four overdue tasks from getting four
 * messages the same morning. Counted per LEAD and across TASKS — the caller
 * excludes the reminder's own task, because a consultant who ticked both
 * WhatsApp and email asked for both and counting the first against the second
 * would mean the pair could never both go out.
 */
export function isCoolingDown(
  lastSentAt: Date | null | undefined,
  now: Date = new Date(),
  cooldownHours: number = DEFAULT_COOLDOWN_HOURS,
): boolean {
  if (!lastSentAt) return false;
  if (cooldownHours <= 0) return false;
  return now.getTime() - lastSentAt.getTime() < cooldownHours * 3_600_000;
}

// ── Template resolution ───────────────────────────────────────────────────────

/**
 * The admin-managed defaults, resolved from AppSetting into one object.
 *
 * `overrides` is keyed by task subject (the composer's closed TASK_TYPES list),
 * so a payment chase and a document request can read differently to a
 * candidate. Empty is the expected state: today's WhatsApp template carries no
 * variables, so one wording genuinely does serve every task type, and the
 * override only earns its keep once there are distinct templates to point at.
 */
export type TaskReminderOverride = {
  waTemplate?: string | null;
  emailTemplateId?: string | null;
  waVariables?: Record<string, string> | null;
};

export type TaskReminderConfig = {
  enabled: boolean;
  /** `name:language` of the default approved WhatsApp template. */
  waTemplate: string | null;
  /**
   * WhatsApp `{{n}}` slot → merge token, e.g. `{"1": "first_name"}` — the same
   * vocabulary broadcasts already use (see renderRecipientParams), so there is
   * one way to say "put the candidate's name here" rather than two.
   *
   * Empty today, because the approved `task_follow_up` carries no variables at
   * all. It exists anyway so that moving to a variables-carrying UTILITY
   * template — the fix for being categorised as Marketing — is a settings
   * change rather than a deploy.
   */
  waVariables: Record<string, string>;
  /** CrmMessageTemplate id (channel `email`) used as the default email. */
  emailTemplateId: string | null;
  /** Task subject → per-type overrides. */
  overrides: Record<string, TaskReminderOverride>;
  cooldownHours: number;
  /** Channels ticked by default in the composer. */
  defaultChannels: TaskReminderChannel[];
};

export const EMPTY_CONFIG: TaskReminderConfig = {
  enabled: false,
  waTemplate: null,
  waVariables: {},
  emailTemplateId: null,
  overrides: {},
  cooldownHours: DEFAULT_COOLDOWN_HOURS,
  defaultChannels: ["whatsapp", "email"],
};

/** The seven AppSetting values this feature is configured by, as stored. */
export type RawTaskReminderSettings = {
  enabled: string | null;
  waTemplate: string | null;
  waVariables: string | null;
  emailTemplateId: string | null;
  overrides: string | null;
  cooldownHours: string | null;
  defaultChannels: string | null;
};

function parseJsonRecord<T>(raw: string | null, onBadJson?: (raw: string) => void): T | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    onBadJson?.(raw);
    return null;
  }
}

/**
 * Turn the stored settings into a config.
 *
 * Pure, and deliberately forgiving: every one of these values can be edited by
 * hand in the AppSetting table, and a single unparseable row must not take the
 * whole feature down. A bad value falls back to its default and reports itself
 * through `onBadJson` rather than throwing — the caller logs it.
 */
export function parseTaskReminderConfig(
  raw: RawTaskReminderSettings,
  onBadJson?: (key: string, value: string) => void,
): TaskReminderConfig {
  const hours = Number.parseInt(raw.cooldownHours || "", 10);
  const picked = (raw.defaultChannels ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is TaskReminderChannel => (TASK_REMINDER_CHANNELS as readonly string[]).includes(c));

  return {
    enabled: raw.enabled === "1",
    waTemplate: raw.waTemplate?.trim() || null,
    waVariables: parseJsonRecord<Record<string, string>>(raw.waVariables, (v) => onBadJson?.("waVariables", v)) ?? {},
    emailTemplateId: raw.emailTemplateId?.trim() || null,
    overrides:
      parseJsonRecord<Record<string, TaskReminderOverride>>(raw.overrides, (v) => onBadJson?.("overrides", v)) ?? {},
    // A negative or unparseable cooldown falls back to the default rather than
    // to zero: "disabled" is a deliberate choice an admin types as 0, not
    // something a typo should quietly turn on.
    cooldownHours: Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_COOLDOWN_HOURS,
    // An unset list means "both", not "none" — the feature has its own on/off
    // switch, and a blank list would make it inert while appearing enabled.
    defaultChannels: picked.length ? picked : [...TASK_REMINDER_CHANNELS],
  };
}

/**
 * The template this task should use on each channel: its per-type override if
 * one is set, otherwise the global default. A blank override falls through to
 * the default rather than disabling the channel — an admin who clears a field
 * means "use the usual one", not "send nothing".
 */
export function resolveTemplates(
  config: TaskReminderConfig,
  taskSubject: string,
): { waTemplate: string | null; emailTemplateId: string | null; waVariables: Record<string, string> } {
  const override = config.overrides[taskSubject.trim()] ?? {};
  const waTemplate = override.waTemplate?.trim() || config.waTemplate;
  return {
    waTemplate,
    emailTemplateId: override.emailTemplateId?.trim() || config.emailTemplateId,
    // The variable map belongs to the TEMPLATE, so an override that names its
    // own template must bring its own slots: inheriting the default map would
    // pour one template's values into another's placeholders.
    waVariables:
      override.waTemplate?.trim() ? override.waVariables ?? {} : override.waVariables ?? config.waVariables,
  };
}

/**
 * Substitute `{{n}}` placeholders for display.
 *
 * Deliberately duplicated rather than imported from the WhatsApp composer:
 * that copy lives in a "use client" React component, and a server module
 * reaching into one to borrow four lines is the coupling that broke the hiring
 * build. Unfilled placeholders stay visible so a half-mapped template reads as
 * obviously incomplete rather than as a message with a hole in it.
 */
export function fillTemplateSlots(body: string | null | undefined, params: Record<string, string>): string {
  if (!body) return "";
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, n: string) => params[n]?.trim() || whole);
}

/**
 * Which channels can be armed for this task right now, and why not when not.
 *
 * Used by the composer to explain itself before the consultant commits — the
 * whole point of arming a reminder is that nobody looks at it again, so a
 * channel that was never going to work has to say so at arm time, not fail
 * silently a day later.
 */
export function availableChannels(
  config: TaskReminderConfig,
  taskSubject: string,
  lead: ReminderLeadFacts,
): Record<TaskReminderChannel, { available: boolean; reason: ReminderSkipReason | null }> {
  const templates = resolveTemplates(config, taskSubject);
  const out = {} as Record<TaskReminderChannel, { available: boolean; reason: ReminderSkipReason | null }>;
  for (const channel of TASK_REMINDER_CHANNELS) {
    const configured = channel === "whatsapp" ? templates.waTemplate : templates.emailTemplateId;
    const reason = !configured ? "not_configured" : skipReasonForChannel(channel, lead);
    out[channel] = { available: reason === null, reason };
  }
  return out;
}

// ── Merge fields ──────────────────────────────────────────────────────────────

/**
 * The tokens an email reminder may use: every CRM template token, plus the two
 * that only exist in this context.
 *
 * Kept local rather than added to CRM_TEMPLATE_MERGE_FIELDS because `{task}`
 * means nothing in a bulk campaign or an inbox reply, and a merge field offered
 * where it cannot resolve renders as a literal `{task}` in a candidate's inbox.
 */
export const TASK_REMINDER_MERGE_FIELDS: CrmMergeField[] = [
  ...CRM_TEMPLATE_MERGE_FIELDS,
  { token: "task", label: "What is pending", sample: "Document Request" },
  { token: "due_date", label: "Due date", sample: "15 Sep 2026" },
];

/** Human date for `{due_date}`, rendered in IST. */
export function formatDueDate(dueAt: Date | null | undefined): string {
  if (!dueAt || Number.isNaN(dueAt.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(dueAt);
}

/** The reminder-only tokens, to be spread over `buildLeadMergeVars`'s output. */
export function buildTaskMergeVars(task: { subject: string; dueAt: Date | null }): Record<string, string> {
  return { task: task.subject, due_date: formatDueDate(task.dueAt) };
}

// ── Status presentation ───────────────────────────────────────────────────────

export type ReminderStatus = "pending" | "sending" | "sent" | "failed" | "skipped" | "cancelled";

/** One line describing where a reminder stands, for the task row. */
export function reminderStatusLabel(r: {
  status: string;
  channel: string;
  fireAt: Date | string;
  sentAt: Date | string | null;
  skipReason: string | null;
}): string {
  const channel = CHANNEL_LABELS[r.channel as TaskReminderChannel] ?? r.channel;
  const when = (v: Date | string) => formatDueDate(typeof v === "string" ? new Date(v) : v);
  switch (r.status) {
    case "sent":
      return `${channel} reminder sent${r.sentAt ? ` ${when(r.sentAt)}` : ""}`;
    case "cancelled":
      return `${channel} reminder cancelled`;
    case "skipped":
      return `${channel} reminder skipped — ${SKIP_REASON_LABELS[r.skipReason as ReminderSkipReason] ?? "no reason recorded"}`;
    case "failed":
      return `${channel} reminder failed`;
    case "sending":
      return `${channel} reminder sending now`;
    default:
      return `${channel} reminder scheduled for ${when(r.fireAt)}`;
  }
}
