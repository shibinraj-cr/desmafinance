import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { AGREEMENTS_PAGE } from "@/lib/esign/requests";
import { AGREEMENT_FOLDERS_PAGE } from "@/lib/esign/folders";
import { isSendingEnabled } from "@/lib/esign/settings";
import { AgreementsList, type AgreementRow } from "./list-client";

export const dynamic = "force-dynamic";

export default async function AgreementsPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canSeePage(perms, AGREEMENTS_PAGE)) {
    return (
      <>
        <TopBar title="Agreements" />
        <div className="p-margin text-body-md text-on-surface-variant">
          Agreements are sent and tracked by admins and roles granted this page in Roles.
        </div>
      </>
    );
  }

  const [requests, sendingEnabled, mine] = await Promise.all([
    prisma.esignRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        reference: true,
        status: true,
        category: true,
        sentAt: true,
        expiresAt: true,
        createdAt: true,
        lead: { select: { candidateName: true } },
        createdBy: { select: { username: true } },
      },
    }),
    isSendingEnabled(),
    // Agreements waiting for THIS user's signature (DESMA staff sign in DesGro).
    prisma.esignRequest.findMany({
      where: {
        status: { in: ["sent", "viewed", "partially_signed"] },
        signers: { some: { userId, status: { in: ["sent", "viewed"] } } },
      },
      orderBy: { sentAt: "asc" },
      select: { id: true, reference: true, expiresAt: true },
    }),
  ]);

  const rows: AgreementRow[] = requests.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    category: r.category,
    client: r.lead?.candidateName ?? null,
    sentAt: r.sentAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy?.username ?? null,
  }));

  return (
    <>
      <TopBar
        title="Agreements"
        subtitle="Agreements sent for e-signature"
        action={
          <>
            <Link href={AGREEMENT_FOLDERS_PAGE} className="text-body-md text-on-surface-variant hover:underline">
              Folders
            </Link>
            {canSeePage(perms, "/operations/agreements/templates") && (
              <Link href="/operations/agreements/templates" className="text-body-md text-on-surface-variant hover:underline">
                Templates
              </Link>
            )}
          </>
        }
      />
      <div className="p-margin">
        <AgreementsList
          rows={rows}
          sendingEnabled={sendingEnabled}
          isAdmin={perms.isAdmin}
          waitingForMe={mine.map((m) => ({ id: m.id, reference: m.reference, expiresAt: m.expiresAt?.toISOString() ?? null }))}
        />
      </div>
    </>
  );
}
