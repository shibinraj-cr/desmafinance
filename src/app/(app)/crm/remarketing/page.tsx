import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { REMARKETING_TOUCH_EVENT } from "@/lib/crm-webhook";
import { getRemarketingConfig } from "@/lib/crm-remarketing";
import { buildFunnel, buildTouchSchedule, nextUpcoming, repliedAfterTouch } from "@/lib/crm-remarketing-report";
import { RemarketingClient, type CampaignRow } from "./client";

export const dynamic = "force-dynamic";

/**
 * The re-marketing drip, whole.
 *
 * Campaign Delivery next door lists only what FAILED, which answers "what broke"
 * and never "what is happening" — so nothing in the CRM has ever been able to say
 * when touch 2 is due for a given lead, or whether touch 2 has reached anybody at
 * all. Both are computable from what is already stored; this page computes them.
 *
 * Scoped like the rest of the CRM: a consultant sees their own leads' campaigns,
 * anyone who can see every lead sees every campaign. The schedule for a candidate
 * you own is plainly your business; the schedule for one you do not is not.
 */
const MAX_CAMPAIGNS = 1000;

export default async function CrmRemarketingPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="Re-marketing" subtitle="Touch-point schedule and results" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The re-marketing report is available to CRM users only.
          </div>
        </div>
      </>
    );
  }

  const seesEveryone = access.isAdmin || access.isSupervisor || access.isCrmTeamLead || access.canManageCrm;

  const config = await getRemarketingConfig();

  const campaigns = await prisma.crmRemarketingCampaign.findMany({
    where: seesEveryone
      ? {}
      : // A consultant's own desk: leads assigned to them now, or campaigns they
        // owned when it opened and have since handed on.
        { OR: [{ lead: { assignedToId: userId } }, { ownerUserId: userId }] },
    orderBy: { startedAt: "desc" },
    take: MAX_CAMPAIGNS,
    select: {
      id: true,
      startedAt: true,
      status: true,
      endedReason: true,
      endedAt: true,
      touch1SentAt: true,
      touch2SentAt: true,
      touch3SentAt: true,
      touch4SentAt: true,
      ownerUserId: true,
      lead: {
        select: {
          id: true,
          candidateName: true,
          whatsappUndeliverableAt: true,
          status: { select: { label: true } },
          assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
        },
      },
    },
  });

  // Delivery outcomes, keyed the way the engine writes them:
  // `remarketing_touch:{campaignId}:{touchIndex}`. Fetched in one query rather
  // than per row — a page that issues a query per campaign would fall over at a
  // few hundred.
  const campaignIds = campaigns.map((c) => c.id);
  const deliveries = campaignIds.length
    ? await prisma.crmWebhookDelivery.findMany({
        where: {
          event: REMARKETING_TOUCH_EVENT,
          OR: campaignIds.map((id) => ({ dedupeKey: { startsWith: `${REMARKETING_TOUCH_EVENT}:${id}:` } })),
        },
        select: { dedupeKey: true, status: true, waStatus: true, waErrorCode: true },
      })
    : [];

  const byKey = new Map<string, { status: string | null; errorCode: string | null }>();
  for (const d of deliveries) {
    if (!d.dedupeKey) continue;
    byKey.set(d.dedupeKey, {
      // The transport verdict stands in until Meta says otherwise — a touch our
      // POST never landed is a failure whatever the (absent) callback says.
      status: d.waStatus ?? (d.status === "failed" ? "failed" : d.status === "sent" ? "sent" : null),
      errorCode: d.waErrorCode,
    });
  }

  const now = new Date();
  const shaped = campaigns.map((c) => {
    const sentAt = [c.touch1SentAt, c.touch2SentAt, c.touch3SentAt, c.touch4SentAt];
    const delivery = [1, 2, 3, 4].map(
      (n) => byKey.get(`${REMARKETING_TOUCH_EVENT}:${c.id}:${n}`) ?? null,
    );
    return { campaign: c, sentAt, delivery };
  });

  const funnel = buildFunnel(
    shaped.map((s) => ({
      sentAt: s.sentAt,
      delivery: s.delivery,
      endedAt: s.campaign.endedAt,
      status: s.campaign.status,
    })),
  );

  const rows: CampaignRow[] = shaped.map(({ campaign: c, sentAt, delivery }) => {
    const cells = buildTouchSchedule({
      startedAt: c.startedAt,
      offsets: config.offsets,
      sentAt,
      delivery,
      now,
    });
    const upcoming = nextUpcoming(cells);
    return {
      id: c.id,
      leadId: c.lead?.id ?? null,
      candidateName: c.lead?.candidateName ?? "(lead removed)",
      consultant:
        c.lead?.assignedTo?.leadPulseRole?.displayName ?? c.lead?.assignedTo?.username ?? null,
      stage: c.lead?.status?.label ?? null,
      startedAt: c.startedAt.toISOString(),
      status: c.status,
      endedReason: c.endedReason,
      undeliverable: !!c.lead?.whatsappUndeliverableAt,
      repliedAfter: repliedAfterTouch({ sentAt, endedAt: c.endedAt, status: c.status }),
      nextAt: upcoming?.at?.toISOString() ?? null,
      nextIndex: upcoming?.index ?? null,
      nextDue: upcoming?.state === "due",
      touches: cells.map((cell) => ({
        index: cell.index,
        state: cell.state,
        at: cell.at?.toISOString() ?? null,
        delivery: cell.delivery,
        errorCode: cell.errorCode,
      })),
    };
  });

  return (
    <>
      <TopBar title="Re-marketing" subtitle="Touch-point schedule and results" />
      <RemarketingClient
        rows={rows}
        funnel={funnel}
        offsets={config.offsets}
        enabled={config.enabled}
        configuredTouches={config.urls.filter(Boolean).length}
        truncated={campaigns.length === MAX_CAMPAIGNS}
      />
    </>
  );
}
