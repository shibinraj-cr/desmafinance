import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { listMessageTemplates } from "@/lib/crm-message-templates";
import { MessageTemplatesClient } from "./client";

export const dynamic = "force-dynamic";

export default async function CrmTemplatesPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canManageTemplates) {
    return (
      <>
        <TopBar title="Message Templates" subtitle="CRM" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Message templates are available to CRM admins and roles granted the Templates page.
          </div>
        </div>
      </>
    );
  }

  const templates = await listMessageTemplates();
  return (
    <>
      <TopBar title="Message Templates" subtitle="Email, WhatsApp quick replies, and templates submitted to Meta for approval" />
      <div className="p-margin">
        <MessageTemplatesClient templates={templates} />
      </div>
    </>
  );
}
