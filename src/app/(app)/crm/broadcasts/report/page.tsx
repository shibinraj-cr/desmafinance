import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { WA_UI_ADMIN_ONLY } from "@/lib/rbac";
import { canViewAllConversations } from "@/lib/wa/access";
import { loadBroadcastReport } from "@/lib/wa/broadcast-report-data";
import {
  DEFAULT_REPLY_WINDOW_DAYS,
  REPLY_WINDOW_OPTIONS,
  WORKLIST_TABS,
  resolveRange,
  type WorklistTab,
} from "@/lib/wa/broadcast-report";
import { listParam, oneParam } from "@/lib/filter-params";
import { BroadcastReportClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Broadcast Report — who replied to a campaign, whether anybody answered them,
 * and what happened to the lead afterwards. See src/lib/wa/broadcast-report.ts
 * for every counting rule.
 *
 * Open to every CRM user, scoped the way the inbox is: oversight roles (admin,
 * Marketing Admin, CRM team lead, CRM admin) see the whole desk; a consultant
 * sees only the leads they own, which makes the page their own list of replies
 * still waiting. The campaigns page itself stays behind canBulkEmail.
 *
 * Only the date range is read on the server — it decides which campaigns load.
 * Campaign, owner, reply window and tab are filtered in the browser from the
 * same data, so they switch instantly; they ride in the URL so a link reopens
 * the same view.
 */
export default async function BroadcastReportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads || (WA_UI_ADMIN_ONLY && !access.isAdmin)) {
    return (
      <>
        <TopBar title="Broadcast Report" subtitle="CRM · WhatsApp" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The broadcast report is available to CRM users only.
          </div>
        </div>
      </>
    );
  }

  const seesEveryone = canViewAllConversations(access);
  const range = resolveRange(oneParam(sp.range), oneParam(sp.from), oneParam(sp.to), new Date());
  const data = await loadBroadcastReport({
    from: range.from,
    to: range.to,
    ownerScope: seesEveryone ? null : userId,
  });

  const windowParam = Number(oneParam(sp.window));
  const windowDays = (REPLY_WINDOW_OPTIONS as readonly number[]).includes(windowParam)
    ? windowParam
    : DEFAULT_REPLY_WINDOW_DAYS;
  const tabParam = oneParam(sp.tab);
  const tab: WorklistTab = (WORKLIST_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as WorklistTab)
    : "waiting";

  return (
    <>
      <TopBar
        title="Broadcast Report"
        subtitle={seesEveryone ? "Replies to WhatsApp campaigns, and whether each one was answered" : "Replies to WhatsApp campaigns on your leads"}
      />
      <BroadcastReportClient
        data={data}
        range={{ key: range.key, fromDay: range.fromDay, toDay: range.toDay }}
        initial={{
          campaignIds: listParam(sp.campaign),
          ownerKeys: seesEveryone ? listParam(sp.owner) : [],
          windowDays,
          tab,
        }}
        seesEveryone={seesEveryone}
        canOpenCampaigns={access.canBulkEmail}
      />
    </>
  );
}
