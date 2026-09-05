import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getEmailConfig, sendEmail } from "@/lib/mailer";
import { getWaProvider } from "@/lib/wa/registry";
import { moveApplication } from "./pipeline";
import { notifyUsers } from "./notify";
import {
  timeTriggerWhere,
  triggerMatches,
  ERROR_STREAK_LIMIT,
  type Action,
  type ActionType,
  type FireContext,
  type Trigger,
} from "./automation-types";

/**
 * The automation engine: trigger → conditions → actions.
 *
 * Two rules the spec is emphatic about, and they shape everything here:
 *   1. Every run is LOGGED, including failures. Nothing is swallowed.
 *   2. A recipe that fails three times in a row auto-pauses and tells its
 *      owner — an automation quietly erroring forever is worse than one that
 *      stops.
 *
 * And one the spec implies: automations never REJECT anyone. `move_stage` into
 * a terminal `lost` stage is refused, because §4 says a human sends every
 * rejection and a recipe is not a human.
 */

export * from "./automation-types";

export type ActionOutcome = { action: ActionType; ok: boolean; detail: string };

/** Run one action. Returns an outcome rather than throwing, so one failing
 *  action does not hide the ones that succeeded. */
async function runAction(
  action: Action,
  applicationId: string,
  automationId: string,
): Promise<ActionOutcome> {
  const params = action.params ?? {};

  const app = await prisma.hiringApplication.findFirst({
    where: { id: applicationId, deletedAt: null },
    include: {
      candidate: { select: { id: true, fullName: true, email: true, phone: true, whatsappOptIn: true, tags: true } },
      job: { select: { id: true, title: true, ownerId: true, stages: { orderBy: { position: "asc" } } } },
    },
  });
  if (!app) return { action: action.type, ok: false, detail: "The application no longer exists." };

  switch (action.type) {
    case "move_stage": {
      const name = String(params.stageName ?? "").trim().toLowerCase();
      const target = app.job.stages.find((s) => s.name.trim().toLowerCase() === name);
      if (!target) return { action: action.type, ok: false, detail: `No stage named "${params.stageName}".` };
      if (target.kind === "lost") {
        // §4: AI never decides, and neither does a recipe. Rejections are human.
        return { action: action.type, ok: false, detail: "A recipe may not reject someone." };
      }
      await moveApplication({
        applicationId,
        toStageId: target.id,
        actorId: null,
        automationId,
      });
      return { action: action.type, ok: true, detail: `Moved to ${target.name}.` };
    }

    case "assign_owner": {
      const userId = String(params.userId ?? "");
      if (!userId) return { action: action.type, ok: false, detail: "No user given." };
      await prisma.hiringCandidate.update({ where: { id: app.candidate.id }, data: { ownerId: userId } });
      return { action: action.type, ok: true, detail: "Owner set." };
    }

    case "add_tag": {
      const tag = String(params.tag ?? "").trim();
      if (!tag) return { action: action.type, ok: false, detail: "No tag given." };
      if (app.candidate.tags.includes(tag)) {
        return { action: action.type, ok: true, detail: "Tag was already there." };
      }
      await prisma.hiringCandidate.update({
        where: { id: app.candidate.id },
        data: { tags: [...app.candidate.tags, tag] },
      });
      return { action: action.type, ok: true, detail: `Tagged ${tag}.` };
    }

    case "schedule_followup":
    case "create_task": {
      // Hiring has no separate task object: the Follow-ups rail IS the queue,
      // so "create a task" schedules a follow-up and tells the owner.
      const days = Number(params.days ?? 1);
      await prisma.hiringApplication.update({
        where: { id: applicationId },
        data: { nextFollowUpAt: new Date(Date.now() + Math.max(0, days) * 86_400_000) },
      });
      if (action.type === "create_task" && app.job.ownerId) {
        await notifyUsers({
          userIds: [app.job.ownerId],
          kind: "hiring_assigned",
          title: String(params.title ?? "Follow-up scheduled"),
          body: `${app.candidate.fullName} — ${app.job.title}`,
          href: "/hiring/follow-ups",
        });
      }
      return { action: action.type, ok: true, detail: `Follow-up in ${days} day(s).` };
    }

    case "notify_user": {
      const userIds = Array.isArray(params.userIds)
        ? (params.userIds as string[])
        : params.userId
          ? [String(params.userId)]
          : app.job.ownerId
            ? [app.job.ownerId]
            : [];
      if (!userIds.length) return { action: action.type, ok: false, detail: "Nobody to notify." };
      const sent = await notifyUsers({
        userIds,
        title: String(params.title ?? "Hiring update"),
        body: String(params.body ?? `${app.candidate.fullName} — ${app.job.title}`),
        href: `/hiring/candidates`,
      });
      return { action: action.type, ok: sent > 0, detail: `${sent} notified.` };
    }

    case "add_to_talent_pool": {
      await prisma.hiringTalentPool.upsert({
        where: { candidateId: app.candidate.id },
        create: {
          candidateId: app.candidate.id,
          state: String(params.state ?? "nurturing"),
          interestAreas: Array.isArray(params.interestAreas) ? (params.interestAreas as string[]) : [],
          lastTouchAt: new Date(),
        },
        update: { state: String(params.state ?? "nurturing") },
      });
      return { action: action.type, ok: true, detail: "Added to the talent pool." };
    }

    case "send_email_template": {
      if (!app.candidate.email) return { action: action.type, ok: false, detail: "No email address." };
      const cfg = await getEmailConfig();
      if (!cfg) return { action: action.type, ok: false, detail: "Email is not configured." };
      const text = render(String(params.body ?? ""), app);
      await sendEmail(cfg, {
        to: app.candidate.email,
        subject: render(String(params.subject ?? "About your application"), app),
        text,
      });
      await prisma.$transaction([
        prisma.hiringApplication.update({
          where: { id: applicationId },
          data: { lastContactedAt: new Date() },
        }),
        prisma.hiringApplicationEvent.create({
          data: {
            applicationId,
            type: "email_sent",
            actorId: null,
            payload: { automationId, to: app.candidate.email },
          },
        }),
      ]);
      return { action: action.type, ok: true, detail: "Email sent." };
    }

    case "send_whatsapp_template": {
      if (!app.candidate.phone) return { action: action.type, ok: false, detail: "No phone number." };
      // §5: honour the opt-in, always.
      if (!app.candidate.whatsappOptIn) {
        return { action: action.type, ok: false, detail: "This candidate has not opted in to WhatsApp." };
      }
      const template = String(params.template ?? "").trim();
      if (!template) return { action: action.type, ok: false, detail: "No template named." };

      // The existing provider, addressed BY PHONE — deliberately not through
      // the CRM's conversation store, which belongs to nurse clients. Templates
      // are always legal in or out of the 24-hour window, which is why an
      // automation may only ever send one.
      const provider = await getWaProvider();
      const result = await provider.sendTemplate({
        toE164: app.candidate.phone,
        template,
        params: (params.params as Record<string, string>) ?? {},
      });
      if (!result.ok) {
        return { action: action.type, ok: false, detail: `WhatsApp send failed: ${result.body.slice(0, 200)}` };
      }
      await prisma.$transaction([
        prisma.hiringApplication.update({
          where: { id: applicationId },
          data: { lastContactedAt: new Date() },
        }),
        prisma.hiringApplicationEvent.create({
          data: {
            applicationId,
            type: "whatsapp_sent",
            actorId: null,
            payload: { automationId, template, providerMessageId: result.providerMessageId },
          },
        }),
      ]);
      return { action: action.type, ok: true, detail: "WhatsApp template sent." };
    }
  }
}

/** Fill `{{candidateName}}` / `{{jobTitle}}` in a template body. */
export function render(
  text: string,
  app: { candidate: { fullName: string }; job: { title: string } },
): string {
  return text
    .replace(/\{\{\s*candidateName\s*\}\}/g, app.candidate.fullName)
    .replace(/\{\{\s*firstName\s*\}\}/g, app.candidate.fullName.trim().split(/\s+/)[0] ?? "")
    .replace(/\{\{\s*jobTitle\s*\}\}/g, app.job.title);
}

/**
 * Run one automation against one application, log the run, and manage the
 * error streak. Never throws.
 */
export async function runAutomation(
  automation: { id: string; name: string; actions: unknown; errorStreak: number; ownerId: string | null },
  applicationId: string,
): Promise<{ status: "success" | "error" | "skipped"; outcomes: ActionOutcome[] }> {
  const started = Date.now();
  const actions = Array.isArray(automation.actions) ? (automation.actions as Action[]) : [];
  const outcomes: ActionOutcome[] = [];
  let threw: string | null = null;

  try {
    for (const action of actions) {
      outcomes.push(await runAction(action, applicationId, automation.id));
    }
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }

  const failed = threw != null || outcomes.some((o) => !o.ok);
  const status: "success" | "error" | "skipped" = threw
    ? "error"
    : outcomes.length === 0
      ? "skipped"
      : failed
        ? "error"
        : "success";

  await prisma.hiringAutomationRun
    .create({
      data: {
        automationId: automation.id,
        applicationId,
        status,
        input: { applicationId } as never,
        output: outcomes as never,
        error: threw ?? (failed ? outcomes.filter((o) => !o.ok).map((o) => o.detail).join("; ") : null),
        durationMs: Date.now() - started,
      },
    })
    .catch((e) => logger.error("hiring_automation_run_log_failed", { message: String(e) }));

  if (status === "error") {
    const streak = automation.errorStreak + 1;
    const shouldPause = streak >= ERROR_STREAK_LIMIT;
    await prisma.hiringAutomation.update({
      where: { id: automation.id },
      data: {
        errorStreak: streak,
        ...(shouldPause
          ? {
              isActive: false,
              pausedAt: new Date(),
              pauseReason: `Paused after ${streak} consecutive failures.`,
            }
          : {}),
      },
    });
    if (shouldPause && automation.ownerId) {
      await notifyUsers({
        userIds: [automation.ownerId],
        kind: "hiring_automation_paused",
        title: `Automation paused: ${automation.name}`,
        body: `It failed ${streak} times in a row and has been switched off. Its runs are logged.`,
        href: "/hiring/automations",
      });
    }
  } else {
    await prisma.hiringAutomation.update({
      where: { id: automation.id },
      data: { errorStreak: 0, lastFiredAt: new Date(), fireCount: { increment: 1 } },
    });
  }

  return { status, outcomes };
}

/** Fire every active automation whose trigger matches what just happened. */
export async function fireFor(ctx: FireContext): Promise<number> {
  const automations = await prisma.hiringAutomation.findMany({ where: { isActive: true } });
  let fired = 0;
  for (const a of automations) {
    const trigger = a.trigger as unknown as Trigger;
    if (!triggerMatches(trigger, ctx)) continue;
    await runAutomation(a, ctx.applicationId);
    fired++;
  }
  return fired;
}
