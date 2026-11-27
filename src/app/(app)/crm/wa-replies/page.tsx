import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { WA_UI_ADMIN_ONLY } from "@/lib/rbac";
import { canViewAllConversations, conversationVisibilityWhere } from "@/lib/wa/access";
import { loadReplyTracker } from "@/lib/wa/reply-tracker-data";
import { DEFAULT_SLA_MINUTES, SLA_OPTIONS, resolveTrackerRange } from "@/lib/wa/reply-tracker";
import { listParam, oneParam } from "@/lib/filter-params";
import { ReplyTrackerClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * WhatsApp Reply Tracker — is every message on the company WhatsApp answered,
 * and how fast? See src/lib/wa/reply-tracker.ts for the counting rules.
 *
 * Open to every CRM user and scoped exactly like the inbox
 * (conversationVisibilityWhere): oversight roles see the whole desk and get a
 * consultant filter; a consultant sees their own threads, which makes the page
 * their personal "what do I still owe a reply" list.
 *
 * Only the period goes to the server. The SLA, consultant and tab are applied
 * in the browser from the same data so they switch instantly, and ride in the
 * URL so a link reopens the same view.
 */
export default async function ReplyTrackerPage({
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
        <TopBar title="Reply Tracker" subtitle="CRM · WhatsApp" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The reply tracker is available to CRM users only.
          </div>
        </div>
      </>
    );
  }

  const seesEveryone = canViewAllConversations(access);
  const range = resolveTrackerRange(oneParam(sp.range), Date.now());
  const data = await loadReplyTracker({ range, visibility: conversationVisibilityWhere(access, userId) });

  const slaParam = Number(oneParam(sp.sla));
  const slaMinutes = (SLA_OPTIONS as readonly number[]).includes(slaParam) ? slaParam : DEFAULT_SLA_MINUTES;
  const tab = oneParam(sp.tab) === "late" ? "late" : "waiting";

  return (
    <>
      <TopBar
        title="Reply Tracker"
        subtitle={seesEveryone ? "Every WhatsApp message answered — who is waiting, and how fast the team replies" : "WhatsApp messages on your chats still waiting for your reply"}
      />
      <ReplyTrackerClient
        data={data}
        seesEveryone={seesEveryone}
        initial={{ slaMinutes, ownerKeys: seesEveryone ? listParam(sp.owner) : [], tab }}
      />
    </>
  );
}
