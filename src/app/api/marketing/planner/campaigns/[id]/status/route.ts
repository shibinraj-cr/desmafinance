import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, forbidden, notFound } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import {
  MKT_PLANNER_HREF,
  formatInr,
  logCampaignEvent,
  notifyPlanner,
  plannerApproverIds,
  requirePlannerApi,
} from "@/lib/mkt-planner";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  action: z.enum(["submit", "approve", "reject", "done", "cancel", "reopen"]),
  note: z.string().trim().max(1000).optional(),
});

/** Which stored statuses each action may start from, and where it lands. */
const MOVES: Record<z.infer<typeof BodySchema>["action"], { from: string[]; to: string; adminOnly: boolean }> = {
  submit: { from: ["idea", "draft"], to: "awaiting", adminOnly: false },
  // An Admin may approve a draft straight away — submitting it to themselves first is ceremony.
  approve: { from: ["awaiting", "draft"], to: "approved", adminOnly: true },
  reject: { from: ["awaiting"], to: "draft", adminOnly: true },
  done: { from: ["approved"], to: "done", adminOnly: false },
  cancel: { from: ["idea", "draft", "awaiting", "approved", "done"], to: "cancelled", adminOnly: false },
  reopen: { from: ["cancelled", "done"], to: "draft", adminOnly: false },
};

/** POST /api/marketing/planner/campaigns/:id/status — the campaign's approval lifecycle. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, admin } = await requirePlannerApi();
  const { action, note } = BodySchema.parse(await req.json().catch(() => null));
  const move = MOVES[action];
  if (move.adminOnly && !admin) throw forbidden("Only an Admin can approve or send back a campaign.");

  const c = await prisma.mktCampaign.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, status: true, startDate: true, budget: true, ownerId: true, createdById: true },
  });
  if (!c) throw notFound();
  if (!move.from.includes(c.status)) {
    throw badRequest(`A campaign that is "${c.status}" can't be moved that way.`, "bad_transition");
  }
  if ((action === "submit" || action === "approve") && !c.startDate) {
    throw badRequest("Give it dates before it goes for approval.", "needs_dates");
  }

  const now = new Date();
  await prisma.mktCampaign.update({
    where: { id: c.id },
    data: {
      status: move.to,
      ...(action === "submit" ? { submittedAt: now } : {}),
      ...(action === "approve" || action === "reject"
        ? { decidedAt: now, decidedById: userId, decisionNote: note || null }
        : {}),
    },
  });

  const link = `${MKT_PLANNER_HREF}/campaigns/${c.id}`;
  const text: Record<typeof action, string> = {
    submit: `Submitted for approval at ${formatInr(c.budget)}`,
    approve: `Approved at ${formatInr(c.budget)}${note ? ` — "${note}"` : ""}`,
    reject: `Sent back${note ? ` — "${note}"` : ""}`,
    done: "Marked done",
    cancel: `Cancelled${note ? ` — "${note}"` : ""}`,
    reopen: "Reopened as a draft",
  };
  await logCampaignEvent(c.id, userId, text[action]);

  if (action === "submit") {
    await notifyPlanner(await plannerApproverIds(), userId, {
      kind: "mkt_campaign_submitted",
      title: `Campaign awaiting approval: ${c.name}`,
      body: `${formatInr(c.budget)} requested.`,
      linkUrl: link,
    });
  } else if (action === "approve" || action === "reject") {
    await notifyPlanner([c.ownerId, c.createdById], userId, {
      kind: "mkt_campaign_decided",
      title: action === "approve" ? `Campaign approved: ${c.name}` : `Campaign sent back: ${c.name}`,
      body: note || (action === "approve" ? `Approved at ${formatInr(c.budget)}.` : "Open it to see what to change."),
      linkUrl: link,
    });
  }

  await recordAudit({
    entityType: "MktCampaign",
    entityId: c.id,
    action: "UPDATE",
    userId,
    changes: { status: { from: c.status, to: move.to }, note: note ?? null },
  });
  return NextResponse.json({ ok: true, status: move.to });
});
