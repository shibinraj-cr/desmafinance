import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { REMARKETING_TOUCH_EVENT } from "@/lib/crm-webhook";
import { DeliveriesClient, type DeliveryRow } from "./client";

export const dynamic = "force-dynamic";

/**
 * Campaign Delivery report — every re-marketing touch that did NOT reach the
 * candidate, so a BDE/admin/supervisor can see which leads the campaign failed to
 * reach and why (bad number, frequency cap, transport error). Failures land here
 * from the Wabis delivery-status webhook (async) and from our own transport layer
 * (a POST that never landed). Visible to anyone with CRM lead access.
 */
export default async function CrmDeliveriesPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) {
    return (
      <>
        <TopBar title="Campaign Delivery" subtitle="Re-marketing" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The campaign delivery report is available to CRM users only.
          </div>
        </div>
      </>
    );
  }

  const failed = await prisma.crmWebhookDelivery.findMany({
    where: {
      event: REMARKETING_TOUCH_EVENT,
      // A failure at either layer: our POST never landed (`status`), or Meta
      // bounced it after acceptance (`waStatus`, from the delivery webhook).
      OR: [{ status: "failed" }, { waStatus: "failed" }],
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: {
      id: true,
      leadId: true,
      assigneeUserId: true,
      payload: true,
      status: true,
      waStatus: true,
      waErrorCode: true,
      waErrorMessage: true,
      responseStatus: true,
      responseBody: true,
      createdAt: true,
      waStatusAt: true,
    },
  });

  const leadIds = [...new Set(failed.map((f) => f.leadId).filter((x): x is string => !!x))];
  const leads = leadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: {
          id: true,
          candidateName: true,
          phone: true,
          assignedToId: true,
          status: { select: { label: true } },
          whatsappUndeliverableAt: true,
          whatsappUndeliverableReason: true,
        },
      })
    : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const ownerIds = [
    ...new Set(
      [...failed.map((f) => f.assigneeUserId), ...leads.map((l) => l.assignedToId)].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, username: true, leadPulseRole: { select: { displayName: true } } },
      })
    : [];
  const ownerName = new Map(owners.map((u) => [u.id, u.leadPulseRole?.displayName || u.username]));

  const rows: DeliveryRow[] = failed.map((f) => {
    const p = (f.payload ?? {}) as Record<string, unknown>;
    const lead = f.leadId ? leadById.get(f.leadId) : undefined;
    const ownerId = lead?.assignedToId ?? f.assigneeUserId ?? null;
    const errorCode = f.waErrorCode ?? null;
    return {
      id: f.id,
      leadId: f.leadId,
      candidateName: (lead?.candidateName ?? (p.name as string) ?? "").trim() || null,
      phone: (lead?.phone ?? (p.phone as string) ?? "").toString().trim() || null,
      touch: typeof p.touch === "number" ? p.touch : Number(p.touch) || null,
      stage: lead?.status?.label ?? null,
      owner: ownerId ? (ownerName.get(ownerId) ?? null) : null,
      layer: f.waStatus === "failed" ? "delivery" : "transport",
      errorCode,
      errorMessage:
        (f.waErrorMessage ?? f.responseBody ?? "").toString().trim().slice(0, 300) || null,
      flaggedUndeliverable: !!lead?.whatsappUndeliverableAt,
      undeliverableReason: lead?.whatsappUndeliverableReason ?? null,
      at: (f.waStatusAt ?? f.createdAt).toISOString(),
    };
  });

  return (
    <>
      <TopBar title="Campaign Delivery" subtitle="Re-marketing touches that didn't reach the lead" />
      <div className="p-margin space-y-lg">
        <DeliveriesClient rows={rows} />
      </div>
    </>
  );
}
