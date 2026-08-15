import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { WA_UI_ADMIN_ONLY } from "@/lib/rbac";
import { getWaMirrorConfig } from "@/lib/wa/mirror";
import { getWaProvider } from "@/lib/wa/registry";
import { InboxClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * WhatsApp Inbox — the shared inbox, inside the CRM.
 *
 * Visible to any CRM user (same rule as the Campaign Delivery report); the page
 * authorises via getCrmAccess and every mutation is re-checked per conversation
 * at the API, because who may act depends on which lead the thread belongs to.
 *
 * Two capabilities are resolved server-side and passed down so the composer can
 * be honest before a consultant types rather than after they press send:
 * whether the mirror is even collecting messages, and whether the live transport
 * can send free text at all.
 */
export default async function CrmInboxPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Deep links from the sidebar ticker: ?conversation=<id> opens a thread
  // directly, ?filter=needs_reply lands on the same slice the badge counted.
  const sp = (await searchParams) ?? {};
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  // Hidden from the nav by ADMIN_RESTRICTED_PAGES while WA_UI_ADMIN_ONLY holds;
  // checked here too, so knowing the URL is not a way around the rollout gate.
  if (!access.canViewLeads || (WA_UI_ADMIN_ONLY && !access.isAdmin)) {
    return (
      <>
        <TopBar title="WhatsApp Inbox" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            {WA_UI_ADMIN_ONLY && access.canViewLeads
              ? "The WhatsApp inbox is still in testing and is limited to admins."
              : "The WhatsApp inbox is available to CRM users only."}
          </div>
        </div>
      </>
    );
  }

  const [config, provider, bdes] = await Promise.all([
    getWaMirrorConfig(),
    getWaProvider(),
    prisma.leadPulseRole.findMany({
      where: { active: true, role: { in: ["l1", "l2"] } },
      orderBy: { displayName: "asc" },
      select: { userId: true, displayName: true },
    }),
  ]);

  // Templates come from the WABA, NOT from CrmMessageTemplate. A CRM template's
  // `name` is a free-text label somebody typed ("Follow-up nudge"); Meta needs
  // the approved template's registered name and language. Sending the label
  // would fail every out-of-window reply with "template does not exist", so the
  // picker is populated from the transport's own catalogue — which is empty on
  // Wabis, and the composer says so rather than offering a list that cannot work.
  const waTemplates = await provider.listTemplates().catch(() => []);
  const templates = waTemplates
    .filter((t) => t.status === "APPROVED")
    .map((t) => ({ id: `${t.name}:${t.language}`, name: `${t.name}:${t.language}`, body: `${t.name} (${t.language})` }));

  return (
    <>
      <TopBar title="WhatsApp Inbox" subtitle="CRM" />
      <div className="p-margin">
        <InboxClient
          initialFilter={one(sp.filter)}
          initialConversationId={one(sp.conversation)}
          mirrorEnabled={config.enabled}
          providerLabel={provider.label}
          canSendText={provider.supports("sendText")}
          canSendTemplate={provider.supports("sendTemplate")}
          canAssign={access.canAssign}
          templates={templates}
          bdes={bdes.map((b) => ({ userId: b.userId, displayName: b.displayName }))}
        />
      </div>
    </>
  );
}
