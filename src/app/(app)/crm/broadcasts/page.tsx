import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { WA_UI_ADMIN_ONLY } from "@/lib/rbac";
import { getWaProvider } from "@/lib/wa/registry";
import { getBroadcastConfig } from "@/lib/wa/broadcast";
import { CRM_TEMPLATE_MERGE_FIELDS } from "@/lib/crm";
import { BroadcastsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * WhatsApp Broadcasts — marketing to a lead segment, from inside the CRM.
 *
 * Gated on canBulkEmail: sending WhatsApp marketing to a segment is the same
 * authority as sending a bulk email to one, so it reuses that capability rather
 * than inventing a second permission for the same power.
 *
 * The transport's ability to address a template BY NAME is resolved here and
 * passed down, because on Wabis it cannot — a workflow URL is the address — and
 * a create form that cannot produce a working campaign should say so before
 * anyone fills it in.
 */
export default async function CrmBroadcastsPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  // Same rollout gate as the inbox — see WA_UI_ADMIN_ONLY.
  if (!access.canBulkEmail || (WA_UI_ADMIN_ONLY && !access.isAdmin)) {
    return (
      <>
        <TopBar title="WhatsApp Broadcasts" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            {WA_UI_ADMIN_ONLY && access.canBulkEmail
              ? "WhatsApp broadcasts are still in testing and are limited to admins."
              : "Broadcasts are available to CRM admins only."}
          </div>
        </div>
      </>
    );
  }

  const [provider, config, statuses, services, sources] = await Promise.all([
    getWaProvider(),
    getBroadcastConfig(),
    prisma.crmLeadStatus.findMany({
      where: { active: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, label: true, code: true, kind: true },
    }),
    prisma.service.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.leadPulseSource.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" }, select: { id: true, label: true } }),
  ]);

  // Approved templates from the WABA when the transport can list them; the
  // catalogue lives at Meta, so on Wabis this is legitimately empty.
  const templates = await provider.listTemplates().catch(() => []);

  // Stages that are a COLD audience — the re-marketing pool and any lost stage.
  // A Marketing-category template to these mostly fails and hurts the number's
  // quality, so the form warns before you queue one.
  const coldStageIds = statuses.filter((s) => s.code === "re_marketing" || s.kind === "lost").map((s) => s.id);

  return (
    <>
      <TopBar title="WhatsApp Broadcasts" subtitle="CRM" />
      <div className="p-margin">
        <BroadcastsClient
          providerLabel={provider.label}
          canBroadcast={provider.supports("sendTemplate")}
          broadcastEnabled={config.enabled}
          batchSize={config.batchSize}
          templates={templates}
          mergeFields={CRM_TEMPLATE_MERGE_FIELDS.map((f) => ({ token: f.token, label: f.label }))}
          statuses={statuses.map((s) => ({ id: s.id, label: s.label }))}
          coldStageIds={coldStageIds}
          services={services}
          sources={sources}
        />
      </div>
    </>
  );
}
