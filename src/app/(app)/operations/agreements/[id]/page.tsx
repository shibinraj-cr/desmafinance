import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { AGREEMENTS_PAGE } from "@/lib/esign/requests";
import { isSendingEnabled } from "@/lib/esign/settings";
import { AgreementDetail, type AgreementDetailDTO } from "./client";

export const dynamic = "force-dynamic";

export default async function AgreementPage({ params }: { params: { id: string } }) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, AGREEMENTS_PAGE)) redirect(AGREEMENTS_PAGE);

  const r = await prisma.esignRequest.findUnique({
    where: { id: params.id },
    include: {
      lead: { select: { id: true, candidateName: true } },
      templateVersion: { select: { version: true, template: { select: { id: true, name: true } } } },
      createdBy: { select: { username: true } },
      signers: { orderBy: { signOrder: "asc" } },
      events: { orderBy: { seq: "asc" } },
    },
  });
  if (!r) notFound();

  // Re-walk the hash chain in the database (see the esign migration).
  const [chain] = await prisma.$queryRaw<Array<{ broken: number | null }>>`SELECT esign_event_chain_break(${r.id}) AS broken`;
  const sendingEnabled = await isSendingEnabled();

  const detail: AgreementDetailDTO = {
    id: r.id,
    reference: r.reference,
    status: r.status,
    category: r.category,
    lead: r.lead ? { id: r.lead.id, name: r.lead.candidateName } : null,
    template: r.templateVersion ? { id: r.templateVersion.template.id, name: r.templateVersion.template.name, version: r.templateVersion.version } : null,
    hasPdf: !!r.originalPathname,
    originalSha256: r.originalSha256,
    createdBy: r.createdBy?.username ?? null,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    reminderDays: r.reminderDays,
    cancelledReason: r.cancelledReason,
    cc: (Array.isArray(r.cc) ? r.cc : []) as Array<{ name: string; email: string }>,
    mergeData: (r.mergeData ?? {}) as Record<string, string>,
    signers: r.signers.map((s) => ({
      id: s.id,
      role: s.role,
      name: s.name,
      email: s.email,
      phone: s.phone,
      signOrder: s.signOrder,
      status: s.status,
      hasLink: !!s.tokenHash,
      viewedAt: s.viewedAt?.toISOString() ?? null,
      signedAt: s.signedAt?.toISOString() ?? null,
    })),
    events: r.events.map((e) => ({
      id: e.id,
      seq: e.seq,
      action: e.action,
      actor: e.actor,
      signerId: e.signerId,
      meta: e.meta as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
    })),
    chainIntact: chain?.broken == null,
    sendingEnabled,
  };

  return (
    <>
      <TopBar
        title={r.lead?.candidateName ?? "Agreement"}
        subtitle={r.templateVersion?.template.name ?? r.reference}
        action={
          <Link href={AGREEMENTS_PAGE} className="text-body-md text-on-surface-variant hover:underline">
            All agreements
          </Link>
        }
      />
      <div className="p-margin">
        <AgreementDetail a={detail} />
      </div>
    </>
  );
}
