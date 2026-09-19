/**
 * Task auto-reminders: the ENGINE — arm, cancel, drain.
 *
 * The safety net behind an overdue CRM task. A consultant arms it when they
 * create the task; if the task is still open the morning after it falls due,
 * the candidate gets an approved WhatsApp template and an email from the team
 * mailbox, whether or not anyone remembered.
 *
 * Three rules shape this file.
 *
 * FREEZE THE CONTENT AT ARM TIME. What will be sent is resolved and stored on
 * the reminder row, not read from settings when it fires. An admin rewriting the
 * default template next week has not silently rewritten a message a consultant
 * already reviewed and armed — the same reasoning that freezes a broadcast's
 * audience instead of re-running its segment mid-send.
 *
 * CANCELLING IS PART OF COMPLETING. A reminder is disarmed in the SAME
 * transaction as the task update that made it unnecessary. If those could drift
 * apart, the failure mode is a candidate being chased for something they already
 * did — which is worse than never having armed it.
 *
 * ASSUME THE DRAIN IS INTERRUPTED. This runs on Vercel: the request is killed at
 * 60 seconds and Hobby crons fire daily. The drain is therefore bounded by both
 * count and wall-clock, claims work by flipping row state before sending, and
 * re-checks every precondition at the last moment — the task may have been
 * completed two minutes ago.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { recordLeadActivity } from "./crm-activity";
import { buildLeadMergeVars, fillTemplate, qualificationText } from "./crm";
import { getEmailConfig, sendEmail, getDailyQuota, smtpErrorInfo } from "./mailer";
import { findOrCreateConversationForLead } from "./wa/mirror";
import { sendWaMessage } from "./wa/send";
import {
  getSetting,
  CRM_TASK_REMINDER_ENABLED_KEY,
  CRM_TASK_REMINDER_WA_TEMPLATE_KEY,
  CRM_TASK_REMINDER_WA_VARS_KEY,
  CRM_TASK_REMINDER_EMAIL_TEMPLATE_KEY,
  CRM_TASK_REMINDER_OVERRIDES_KEY,
  CRM_TASK_REMINDER_COOLDOWN_KEY,
  CRM_TASK_REMINDER_CHANNELS_KEY,
  CRM_TASK_REMINDER_CONSULTANTS_KEY,
} from "./app-settings";
import {
  reminderFireAt,
  isWithinSendWindow,
  skipReasonForChannel,
  isCoolingDown,
  resolveTemplates,
  buildTaskMergeVars,
  fillTemplateSlots,
  parseTaskReminderConfig,
  isConsultantEnrolled,
  TASK_REMINDER_CHANNELS,
  type TaskReminderChannel,
  type TaskReminderConfig,
  type ReminderSkipReason,
} from "./crm-task-reminders";

export * from "./crm-task-reminders";

/** Reminders sent per drain run. Bounded so one pass cannot empty the mail quota. */
const BATCH_SIZE = 60;
/** Vercel kills the request at 60s; stop with room to finish the send in flight. */
const DRAIN_TIME_BUDGET_MS = 45_000;
/** Meta rate-limits template sends; a small gap keeps a burst from tripping it. */
const INTER_SEND_DELAY_MS = 120;
/** Attempts before a transient failure is called a failure for good. */
const MAX_ATTEMPTS = 3;
/**
 * How far past its fire time a reminder may still be sent. A drain that has been
 * down for a week should not wake up and message everybody about tasks from last
 * Tuesday — by then the message is noise, and worse, confusing.
 */
const STALE_AFTER_MS = 3 * 86_400_000;
/**
 * How long a row may sit in `sending` before it is treated as interrupted. Far
 * longer than a request can live (Vercel kills at 60s), so a run still in
 * flight is never stolen from.
 */
const STRANDED_AFTER_MS = 15 * 60_000;

// ── Configuration ─────────────────────────────────────────────────────────────

export async function getTaskReminderConfig(): Promise<TaskReminderConfig> {
  const [
    enabled,
    waTemplate,
    waVariables,
    emailTemplateId,
    overrides,
    cooldownHours,
    defaultChannels,
    consultantIds,
  ] = await Promise.all([
    getSetting(CRM_TASK_REMINDER_ENABLED_KEY).catch(() => null),
    getSetting(CRM_TASK_REMINDER_WA_TEMPLATE_KEY).catch(() => null),
    getSetting(CRM_TASK_REMINDER_WA_VARS_KEY).catch(() => null),
    getSetting(CRM_TASK_REMINDER_EMAIL_TEMPLATE_KEY).catch(() => null),
    getSetting(CRM_TASK_REMINDER_OVERRIDES_KEY).catch(() => null),
    getSetting(CRM_TASK_REMINDER_COOLDOWN_KEY).catch(() => null),
    getSetting(CRM_TASK_REMINDER_CHANNELS_KEY).catch(() => null),
    getSetting(CRM_TASK_REMINDER_CONSULTANTS_KEY).catch(() => null),
  ]);

  // The parsing itself is pure and lives beside the rest of the rules; this
  // function is only the read. A hand-edited setting that no longer parses falls
  // back to its default and is logged rather than taking the feature down.
  return parseTaskReminderConfig(
    {
      enabled,
      waTemplate,
      waVariables,
      emailTemplateId,
      overrides,
      cooldownHours,
      defaultChannels,
      consultantIds,
    },
    (key, value) => logger.warn("crm_task_reminder_setting_unparseable", { key, value: value.slice(0, 200) }),
  );
}

// ── Arming ────────────────────────────────────────────────────────────────────

const TASK_WITH_LEAD = {
  id: true,
  subject: true,
  dueAt: true,
  status: true,
  leadId: true,
  assignedToId: true,
  lead: {
    select: {
      id: true,
      candidateName: true,
      email: true,
      phoneE164: true,
      campaign: true,
      whatsappOptedOutAt: true,
      whatsappUndeliverableAt: true,
      status: { select: { kind: true } },
      service: { select: { name: true } },
      qualification: { select: { label: true } },
      qualificationOther: true,
      assignedToId: true,
      assignedTo: {
        select: {
          username: true,
          leadPulseRole: { select: { displayName: true, phone: true } },
        },
      },
    },
  },
} satisfies Prisma.CrmTaskSelect;

type TaskWithLead = Prisma.CrmTaskGetPayload<{ select: typeof TASK_WITH_LEAD }>;

/** The `{token}` map for one task's reminder: lead fields plus task fields. */
function mergeVarsFor(task: TaskWithLead): Record<string, string> {
  const lead = task.lead;
  return {
    ...buildLeadMergeVars({
      candidateName: lead.candidateName,
      service: lead.service?.name ?? null,
      consultant: lead.assignedTo?.leadPulseRole?.displayName ?? lead.assignedTo?.username ?? null,
      consultantPhone: lead.assignedTo?.leadPulseRole?.phone ?? null,
      campaign: lead.campaign ?? null,
      qualification: qualificationText(lead.qualification?.label, lead.qualificationOther),
    }),
    ...buildTaskMergeVars({ subject: task.subject, dueAt: task.dueAt }),
  };
}

/**
 * Render the WhatsApp `{{n}}` values from the configured slot → token map.
 *
 * Accepts a bare token (`first_name`) or a braced one (`{first_name}`), matching
 * what broadcasts already accept — a bare token used to echo its own name into
 * the message, so wrapping it is the difference between "Hi Deepa" and
 * "Hi first_name".
 */
function renderWaParams(map: Record<string, string>, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slot, raw] of Object.entries(map)) {
    const value = (raw ?? "").trim();
    out[slot] = !value ? "" : /^[a-z0-9_]+$/i.test(value) ? fillTemplate(`{${value}}`, vars) : fillTemplate(value, vars);
  }
  return out;
}

export type ArmResult = {
  armed: TaskReminderChannel[];
  skipped: { channel: TaskReminderChannel; reason: ReminderSkipReason }[];
};

/**
 * Arm (or re-arm) the reminders for one task.
 *
 * Idempotent by `@@unique([taskId, channel])`: called again after the due date
 * moves, it re-times the pending row rather than creating a second one. A row
 * that has already SENT is never rewritten — the message is out, and a new
 * fire time would send it twice.
 *
 * Channels the consultant did not pick are cancelled rather than deleted, so
 * un-ticking a box leaves a record that it was once armed.
 */
export async function armTaskReminders(opts: {
  taskId: string;
  channels: TaskReminderChannel[];
  actorId: string | null;
  /** Runs inside the caller's transaction when given, so arming cannot half-apply. */
  tx?: Prisma.TransactionClient;
}): Promise<ArmResult> {
  const db = opts.tx ?? prisma;
  const result: ArmResult = { armed: [], skipped: [] };

  const task = await db.crmTask.findUnique({ where: { id: opts.taskId }, select: TASK_WITH_LEAD });
  if (!task) return result;

  const fireAt = reminderFireAt(task.dueAt);
  // No due date means no moment to fire at. Nothing is armed, and any reminder
  // already armed for a date that has since been cleared is stood down.
  if (!fireAt) {
    await db.crmTaskReminder.updateMany({
      where: { taskId: opts.taskId, status: "pending" },
      data: { status: "cancelled" },
    });
    return result;
  }

  const config = await getTaskReminderConfig();

  // The allow-list, checked before anything is armed. A consultant who is not
  // enrolled gets no reminders on their tasks at all, and any already armed are
  // stood down — removing someone from the list has to take effect on the tasks
  // they already booked, not just future ones.
  if (!isConsultantEnrolled(config, task.assignedToId)) {
    await db.crmTaskReminder.updateMany({
      where: { taskId: opts.taskId, status: "pending" },
      data: { status: "cancelled" },
    });
    for (const channel of opts.channels) {
      result.skipped.push({ channel, reason: "consultant_not_enrolled" });
    }
    return result;
  }

  const templates = resolveTemplates(config, task.subject);
  const vars = mergeVarsFor(task);
  const wanted = new Set(opts.channels);

  for (const channel of TASK_REMINDER_CHANNELS) {
    if (!wanted.has(channel)) {
      await db.crmTaskReminder.updateMany({
        where: { taskId: opts.taskId, channel, status: "pending" },
        data: { status: "cancelled" },
      });
      continue;
    }

    const configured = channel === "whatsapp" ? templates.waTemplate : templates.emailTemplateId;
    if (!configured) {
      result.skipped.push({ channel, reason: "not_configured" });
      continue;
    }
    const unreachable = skipReasonForChannel(channel, task.lead);
    if (unreachable) {
      result.skipped.push({ channel, reason: unreachable });
      continue;
    }

    const content =
      channel === "whatsapp"
        ? await renderWaContent(db, templates.waTemplate!, templates.waVariables, vars)
        : await renderEmailContent(db, templates.emailTemplateId!, vars);
    if (!content) {
      // The configured template has since been deleted.
      result.skipped.push({ channel, reason: "not_configured" });
      continue;
    }

    // `update` rather than `upsert` on a SENT row: re-arming must never resend.
    const existing = await db.crmTaskReminder.findUnique({
      where: { taskId_channel: { taskId: opts.taskId, channel } },
      select: { id: true, status: true },
    });
    // `sending` is excluded alongside `sent`: the message may already be with
    // the candidate, and resetting it to pending would send it again.
    if (existing && (existing.status === "sent" || existing.status === "sending")) continue;

    await db.crmTaskReminder.upsert({
      where: { taskId_channel: { taskId: opts.taskId, channel } },
      create: {
        taskId: opts.taskId,
        leadId: task.leadId,
        channel,
        fireAt,
        status: "pending",
        createdById: opts.actorId,
        ...content,
      },
      update: {
        fireAt,
        status: "pending",
        skipReason: null,
        lastError: null,
        attempts: 0,
        ...content,
      },
    });
    result.armed.push(channel);
  }

  return result;
}

/**
 * The frozen WhatsApp payload.
 *
 * Never null: a template that Meta will accept needs only its name, language and
 * parameters, and the local `WaTemplate` row is consulted purely to render the
 * text the CRM thread displays. A template approved at Meta but never authored
 * here (listWaTemplates calls these `metaOnly`) therefore still arms — it just
 * shows its technical name on the thread instead of its wording, which is a far
 * smaller loss than silently refusing to arm the reminder at all.
 *
 * The row lookup is deliberately NOT filtered on status. That status is a cache
 * refreshed by a sync that may not have run, and gating on it would hide a
 * template Meta approved days ago — precisely the state `task_follow_up` was in
 * when this was configured. Meta gets the final say, at send time.
 */
async function renderWaContent(
  db: Prisma.TransactionClient | typeof prisma,
  templateKey: string,
  variableMap: Record<string, string>,
  vars: Record<string, string>,
): Promise<{ templateName: string; templateParams: Prisma.InputJsonValue; body: string }> {
  const [name, language] = templateKey.split(":");
  const row = await db.waTemplate.findFirst({
    where: { name, ...(language ? { language } : {}) },
    select: { spec: true },
  });

  const spec = row?.spec as { body?: string; headerText?: string | null } | null;
  const params = renderWaParams(variableMap, vars);
  const rendered = [spec?.headerText, fillTemplateSlots(spec?.body ?? null, params)].filter(Boolean).join("\n\n");

  return { templateName: templateKey, templateParams: params, body: rendered };
}

/** The frozen email payload, or null when the template no longer exists. */
async function renderEmailContent(
  db: Prisma.TransactionClient | typeof prisma,
  templateId: string,
  vars: Record<string, string>,
): Promise<{ subject: string; body: string } | null> {
  const row = await db.crmMessageTemplate.findUnique({
    where: { id: templateId },
    select: { subject: true, body: true, channel: true, isActive: true },
  });
  if (!row || row.channel !== "email" || !row.isActive) return null;
  return {
    subject: fillTemplate(row.subject || "A quick reminder from DESMA", vars),
    body: fillTemplate(row.body, vars),
  };
}

// ── Composer preview ──────────────────────────────────────────────────────────

export type ChannelPreview = {
  available: boolean;
  reason: ReminderSkipReason | null;
  /** Lead merge fields already filled; `{task}` and `{due_date}` left for the client. */
  subject: string | null;
  body: string | null;
};

export type TaskReminderPreview = {
  enabled: boolean;
  defaultChannels: TaskReminderChannel[];
  /**
   * The enrolled consultants. Sent to the browser because the composer's
   * "Assign to" dropdown can change who the task belongs to, so whether a
   * reminder is possible is a question only the client can answer as it is
   * being filled in.
   */
  consultantIds: string[];
  /** Task type → what each channel would send for it. */
  byTaskType: Record<string, Record<TaskReminderChannel, ChannelPreview>>;
};

/**
 * What the composer shows before a consultant commits.
 *
 * Rendered per task TYPE because a per-type override can point at different
 * wording, and rendered with the LEAD's merge fields already filled but
 * `{task}` / `{due_date}` deliberately left intact — those two depend on the
 * type and date being chosen in the form, and the client fills them live as the
 * consultant types. Sending a half-rendered preview beats a round trip per
 * keystroke.
 *
 * Arming is the one moment anybody looks at this. A channel that was never going
 * to work has to say so here, not fail quietly a day later.
 */
export async function previewTaskReminders(
  leadId: string,
  taskTypes: readonly string[],
): Promise<TaskReminderPreview> {
  const config = await getTaskReminderConfig();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      candidateName: true,
      email: true,
      phoneE164: true,
      campaign: true,
      whatsappOptedOutAt: true,
      whatsappUndeliverableAt: true,
      service: { select: { name: true } },
      qualification: { select: { label: true } },
      qualificationOther: true,
      assignedTo: {
        select: { username: true, leadPulseRole: { select: { displayName: true, phone: true } } },
      },
    },
  });

  const empty: TaskReminderPreview = {
    enabled: config.enabled,
    defaultChannels: config.defaultChannels,
    consultantIds: config.consultantIds,
    byTaskType: {},
  };
  if (!lead || !config.enabled) return empty;

  const vars = buildLeadMergeVars({
    candidateName: lead.candidateName,
    service: lead.service?.name ?? null,
    consultant: lead.assignedTo?.leadPulseRole?.displayName ?? lead.assignedTo?.username ?? null,
    consultantPhone: lead.assignedTo?.leadPulseRole?.phone ?? null,
    campaign: lead.campaign ?? null,
    qualification: qualificationText(lead.qualification?.label, lead.qualificationOther),
  });

  // Memoised across task types. With no per-type overrides configured — the
  // expected state — every type resolves to the SAME pair of templates, and
  // rendering per type would fire eight template lookups on every lead page
  // load to produce four identical answers.
  const cache = new Map<string, ChannelPreview>();
  const once = async (key: string, make: () => Promise<ChannelPreview>) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const made = await make();
    cache.set(key, made);
    return made;
  };

  for (const type of taskTypes) {
    const templates = resolveTemplates(config, type);
    const waKey = `wa:${templates.waTemplate ?? ""}:${JSON.stringify(templates.waVariables)}`;
    const emailKey = `email:${templates.emailTemplateId ?? ""}`;
    empty.byTaskType[type] = {
      whatsapp: await once(waKey, () => previewWa(templates.waTemplate, templates.waVariables, vars, lead)),
      email: await once(emailKey, () => previewEmail(templates.emailTemplateId, vars, lead)),
    };
  }
  return empty;
}

async function previewWa(
  templateKey: string | null,
  variableMap: Record<string, string>,
  vars: Record<string, string>,
  lead: { phoneE164: string | null; email: string | null; whatsappOptedOutAt: Date | null; whatsappUndeliverableAt: Date | null },
): Promise<ChannelPreview> {
  const reason = !templateKey ? "not_configured" : skipReasonForChannel("whatsapp", lead);
  if (reason || !templateKey) return { available: false, reason, subject: null, body: null };

  const content = await renderWaContent(prisma, templateKey, variableMap, vars);
  return {
    available: true,
    reason: null,
    subject: null,
    // A variable-free template renders to its own body, which is exactly what
    // the candidate receives; an empty string means we hold no copy of the
    // wording locally (a catalogue-only template) rather than that it is blank.
    body: content.body || null,
  };
}

async function previewEmail(
  templateId: string | null,
  vars: Record<string, string>,
  lead: { email: string | null; phoneE164: string | null; whatsappOptedOutAt: Date | null; whatsappUndeliverableAt: Date | null },
): Promise<ChannelPreview> {
  const reason = !templateId ? "not_configured" : skipReasonForChannel("email", lead);
  if (reason || !templateId) return { available: false, reason, subject: null, body: null };

  const content = await renderEmailContent(prisma, templateId, vars);
  if (!content) return { available: false, reason: "not_configured", subject: null, body: null };
  return { available: true, reason: null, subject: content.subject, body: content.body };
}

/**
 * The channels this task has ever been armed on, excluding any already sent.
 *
 * What "re-arm it the way it was" means when a request does not say which
 * channels it wants — a due date being moved, or a completed task being
 * reopened. A `sent` row is excluded because re-arming it would send twice.
 */
export async function armedChannelsFor(
  taskId: string,
  tx?: Prisma.TransactionClient,
): Promise<TaskReminderChannel[]> {
  const db = tx ?? prisma;
  const rows = await db.crmTaskReminder.findMany({
    where: { taskId, status: { notIn: ["sent", "sending"] } },
    select: { channel: true },
  });
  return rows
    .map((r) => r.channel)
    .filter((c): c is TaskReminderChannel => (TASK_REMINDER_CHANNELS as readonly string[]).includes(c));
}

// ── Cancelling ────────────────────────────────────────────────────────────────

/**
 * Stand down every pending reminder on a task.
 *
 * Called when the task is completed or its due date cleared. Only `pending` rows
 * move: a sent reminder is a fact, and a previously skipped one already has the
 * more informative status.
 */
export async function cancelTaskReminders(
  taskId: string,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const db = tx ?? prisma;
  const { count } = await db.crmTaskReminder.updateMany({
    where: { taskId, status: "pending" },
    data: { status: "cancelled" },
  });
  return count;
}

// ── Draining ──────────────────────────────────────────────────────────────────

export type DrainSummary = {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  cancelled: number;
  remaining: number;
  stoppedEarly: boolean;
  outsideWindow: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send every reminder that has come due.
 *
 * Every precondition is re-checked HERE rather than trusted from arm time,
 * because the whole point is that hours or days have passed: the task may be
 * done, the lead may have opted out, the candidate may already have had a
 * reminder about something else this morning.
 */
export async function drainTaskReminders(now: Date = new Date()): Promise<DrainSummary> {
  const summary: DrainSummary = {
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
    remaining: 0,
    stoppedEarly: false,
    outsideWindow: false,
  };

  const config = await getTaskReminderConfig();
  if (!config.enabled) return summary;

  // The window is enforced here, independently of the cron schedule, so the
  // schedule can be changed without anyone re-deriving whether 3am sends are
  // now possible. See the note in crm-task-reminders.ts.
  if (!isWithinSendWindow(now)) {
    summary.outsideWindow = true;
    return summary;
  }

  // A row left in `sending` means a previous run was killed between claiming it
  // and recording the outcome, so whether the candidate got the message is
  // genuinely unknown. It is resolved as FAILED rather than returned to pending:
  // a reminder that silently never arrives is a smaller harm than one that
  // arrives twice, and `failed` is visible on the task row where somebody can
  // act on it. Nothing else in this file can produce a stale `sending` row,
  // since a live request cannot outlive Vercel's 60-second ceiling.
  const stranded = await prisma.crmTaskReminder.updateMany({
    where: { status: "sending", updatedAt: { lt: new Date(now.getTime() - STRANDED_AFTER_MS) } },
    data: {
      status: "failed",
      lastError: "The send was interrupted; whether it reached the candidate is unknown.",
    },
  });
  if (stranded.count > 0) {
    logger.warn("crm_task_reminders_stranded", { count: stranded.count });
  }

  const deadline = Date.now() + DRAIN_TIME_BUDGET_MS;
  const due = await prisma.crmTaskReminder.findMany({
    where: { status: "pending", fireAt: { lte: now } },
    orderBy: { fireAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      channel: true,
      leadId: true,
      taskId: true,
      fireAt: true,
      templateName: true,
      templateParams: true,
      subject: true,
      body: true,
      attempts: true,
    },
  });

  summary.remaining = Math.max(
    0,
    (await prisma.crmTaskReminder.count({ where: { status: "pending", fireAt: { lte: now } } })) - due.length,
  );

  // One config read, not one per row.
  const emailCfg = due.some((r) => r.channel === "email") ? await getEmailConfig() : null;
  let emailBudget = emailCfg ? (await getDailyQuota(emailCfg)).remaining : 0;

  for (const reminder of due) {
    if (Date.now() > deadline) {
      summary.stoppedEarly = true;
      break;
    }
    summary.considered++;

    const verdict = await evaluate(reminder, now, config);
    if (verdict.kind === "cancel") {
      await prisma.crmTaskReminder.update({
        where: { id: reminder.id },
        data: { status: "cancelled" },
      });
      summary.cancelled++;
      continue;
    }
    if (verdict.kind === "skip") {
      await prisma.crmTaskReminder.update({
        where: { id: reminder.id },
        data: { status: "skipped", skipReason: verdict.reason },
      });
      summary.skipped++;
      continue;
    }

    if (reminder.channel === "email" && emailBudget <= 0) {
      await prisma.crmTaskReminder.update({
        where: { id: reminder.id },
        data: { status: "skipped", skipReason: "email_quota" },
      });
      summary.skipped++;
      continue;
    }

    // CLAIM BEFORE SENDING, conditionally on the row still being pending. The
    // cron is not the only caller — `?key=` triggers a run by hand — so two
    // drains can overlap, and without an atomic claim both would read the same
    // pending row and message the candidate twice. `updateMany` returning 0
    // means somebody else got there first.
    const claim = await prisma.crmTaskReminder.updateMany({
      where: { id: reminder.id, status: "pending" },
      data: { status: "sending", attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;

    const outcome =
      reminder.channel === "whatsapp"
        ? await sendWhatsAppReminder(reminder, verdict.task)
        : await sendEmailReminder(reminder, verdict.task, emailCfg);

    if (outcome.ok) {
      if (reminder.channel === "email") emailBudget--;
      await prisma.crmTaskReminder.update({
        where: { id: reminder.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          providerMessageId: outcome.providerMessageId,
          lastError: null,
        },
      });
      summary.sent++;
      await recordSend(reminder, verdict.task, outcome.providerMessageId);
      await sleep(INTER_SEND_DELAY_MS);
      continue;
    }

    // A retryable failure stays pending for the next run; past the ceiling, or
    // on a permanent rejection, it is called failed so it stops cycling.
    const exhausted = reminder.attempts + 1 >= MAX_ATTEMPTS || !outcome.retryable;
    await prisma.crmTaskReminder.update({
      where: { id: reminder.id },
      data: { status: exhausted ? "failed" : "pending", lastError: outcome.detail.slice(0, 500) },
    });
    if (exhausted) summary.failed++;
    logger.warn("crm_task_reminder_send_failed", {
      reminderId: reminder.id,
      channel: reminder.channel,
      attempts: reminder.attempts + 1,
      exhausted,
      detail: outcome.detail.slice(0, 200),
    });
  }

  logger.info("crm_task_reminders_run", { ...summary });
  return summary;
}

type DueReminder = {
  id: string;
  channel: string;
  leadId: string;
  taskId: string;
  fireAt: Date;
  templateName: string | null;
  templateParams: Prisma.JsonValue;
  subject: string | null;
  body: string | null;
  attempts: number;
};

type Verdict =
  | { kind: "cancel" }
  | { kind: "skip"; reason: ReminderSkipReason }
  | { kind: "send"; task: TaskWithLead };

/**
 * The last-moment re-check. Everything that could have changed between arming
 * and firing is looked at again here — in the order that decides which reason
 * gets recorded when several apply.
 */
async function evaluate(reminder: DueReminder, now: Date, config: TaskReminderConfig): Promise<Verdict> {
  const task = await prisma.crmTask.findUnique({ where: { id: reminder.taskId }, select: TASK_WITH_LEAD });
  // The task is gone, or the consultant did the job. Either way the reminder has
  // done its work by NOT being sent.
  if (!task || task.status !== "open") return { kind: "cancel" };

  // A drain that has been down for days should not message people about last
  // week's tasks.
  if (now.getTime() - reminder.fireAt.getTime() > STALE_AFTER_MS) return { kind: "cancel" };

  // Re-checked here and not merely trusted from arm time: a task can be
  // reassigned after it is armed, and an admin can withdraw a consultant from
  // the list at any point. Either way the message must not go out.
  if (!isConsultantEnrolled(config, task.assignedToId)) {
    return { kind: "skip", reason: "consultant_not_enrolled" };
  }

  // A LOST lead is never chased. Deliberately only `lost`: a won or enrolled
  // candidate still legitimately owes documents and payments, and those are
  // exactly the tasks this exists to chase — muting them would gut the feature
  // for the people furthest along.
  if (task.lead.status?.kind === "lost") return { kind: "skip", reason: "lead_closed" };

  const unreachable = skipReasonForChannel(reminder.channel as TaskReminderChannel, task.lead);
  if (unreachable) return { kind: "skip", reason: unreachable };

  // Per LEAD and ACROSS TASKS: from the candidate's side, being messaged about
  // four different overdue things in one morning does not become acceptable
  // because they were four different tasks.
  //
  // This task is excluded, and that exclusion is the point. A consultant who
  // ticked both WhatsApp and email asked for both; counting the first against
  // the second would mean the pair could never both go out, and the second
  // channel would silently never work.
  const lastSend = await prisma.crmTaskReminder.findFirst({
    where: {
      leadId: reminder.leadId,
      taskId: { not: reminder.taskId },
      status: "sent",
      sentAt: { not: null },
    },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (isCoolingDown(lastSend?.sentAt ?? null, now, config.cooldownHours)) {
    return { kind: "skip", reason: "cooldown" };
  }

  return { kind: "send", task };
}

type SendOutcome = {
  ok: boolean;
  providerMessageId: string | null;
  detail: string;
  /** False for a rejection that retrying cannot fix (bad template, dead number). */
  retryable: boolean;
};

async function sendWhatsAppReminder(reminder: DueReminder, task: TaskWithLead): Promise<SendOutcome> {
  if (!reminder.templateName) {
    return { ok: false, providerMessageId: null, detail: "No template on the reminder", retryable: false };
  }
  const conv = await findOrCreateConversationForLead({
    id: task.lead.id,
    phoneE164: task.lead.phoneE164!,
    assignedToId: task.lead.assignedToId,
  });
  if (!conv.ok) {
    return {
      ok: false,
      providerMessageId: null,
      detail: "This number's WhatsApp thread belongs to a different lead",
      retryable: false,
    };
  }

  // `sentById: null` — this is an automation, and attributing it to the
  // consultant would put a message they did not write under their name.
  const result = await sendWaMessage({
    conversationId: conv.conversationId,
    sentById: null,
    template: reminder.templateName,
    templateParams: (reminder.templateParams ?? {}) as Record<string, string>,
    renderedBody: reminder.body,
  });

  if (result.ok) return { ok: true, providerMessageId: result.providerMessageId, detail: "", retryable: true };
  return {
    ok: false,
    providerMessageId: null,
    detail: result.detail,
    // A capability gap or a closed session will never resolve itself on retry;
    // a transport failure might.
    retryable: result.reason === "send_failed",
  };
}

async function sendEmailReminder(
  reminder: DueReminder,
  task: TaskWithLead,
  cfg: Awaited<ReturnType<typeof getEmailConfig>>,
): Promise<SendOutcome> {
  if (!cfg) {
    return { ok: false, providerMessageId: null, detail: "Email is not configured", retryable: false };
  }
  if (!reminder.body) {
    return { ok: false, providerMessageId: null, detail: "No body on the reminder", retryable: false };
  }
  try {
    const { messageId } = await sendEmail(cfg, {
      to: task.lead.email!,
      subject: reminder.subject || "A quick reminder from DESMA",
      text: reminder.body,
    });
    return { ok: true, providerMessageId: messageId, detail: "", retryable: true };
  } catch (e) {
    const { rateLimited, auth, message } = smtpErrorInfo(e);
    // Rate limiting clears on its own; a rejected App Password does not.
    return { ok: false, providerMessageId: null, detail: message, retryable: rateLimited && !auth };
  }
}

/**
 * Put the send on the lead's timeline and tell the consultant it happened.
 *
 * The notification is not a courtesy: the candidate may reply within minutes,
 * and a consultant who does not know a message went out in their name reads that
 * reply as coming from nowhere.
 */
async function recordSend(
  reminder: DueReminder,
  task: TaskWithLead,
  providerMessageId: string | null,
): Promise<void> {
  const isWa = reminder.channel === "whatsapp";
  try {
    await recordLeadActivity({
      leadId: reminder.leadId,
      actorId: null,
      type: isWa ? "WHATSAPP_SENT" : "EMAIL_SENT",
      summary: `Automated reminder sent: “${task.subject}”`,
      metadata: {
        channel: reminder.channel,
        via: "task_reminder",
        taskId: reminder.taskId,
        template: reminder.templateName,
        providerMessageId,
        // Matches what the manual email path records, so the daily-quota count
        // in getDailyQuota includes reminders rather than under-counting.
        ...(isWa ? {} : { delivery: "gmail", to: task.lead.email }),
      },
    });
  } catch (e) {
    logger.error("crm_task_reminder_activity_failed", {
      reminderId: reminder.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  if (!task.lead.assignedToId) return;
  try {
    await prisma.crmNotification.create({
      data: {
        userId: task.lead.assignedToId,
        kind: "task_reminder_sent",
        title: "Automated reminder sent to your candidate",
        body: `${task.lead.candidateName || "A candidate"} was sent the ${
          isWa ? "WhatsApp" : "email"
        } reminder for “${task.subject}” — the task is still open.`,
        linkUrl: `/crm/leads/${reminder.leadId}`,
        leadId: reminder.leadId,
      },
    });
  } catch (e) {
    // Best-effort, exactly like notifyLeadAssigned: a notification failure must
    // not turn a delivered message into a reported failure.
    logger.warn("crm_task_reminder_notify_failed", {
      reminderId: reminder.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
