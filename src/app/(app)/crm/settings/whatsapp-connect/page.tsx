import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { ConnectClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Connect a number that runs on the WhatsApp Business app (Coexistence).
 *
 * Its own page rather than a card on CRM Settings because it loads Facebook's
 * SDK, and the CSP only allows that script on this path (next.config.mjs).
 */
export default async function WhatsAppConnectPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) {
    return (
      <>
        <TopBar title="Connect WhatsApp number" subtitle="Admin" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            CRM settings are available to administrators only.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Connect WhatsApp number" subtitle="WhatsApp Business app → CRM (Coexistence)" />
      <div className="p-margin space-y-lg">
        <ConnectClient />
      </div>
    </>
  );
}
