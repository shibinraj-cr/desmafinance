import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { loadSopAccess } from "@/lib/sop/access";
import {
  auditTrail,
  sopDetailInclude,
  versionDetailInclude,
  versionHistory,
} from "@/lib/sop/queries";
import {
  serializeAudit,
  serializeHistory,
  serializeMyAck,
  serializeSopHeader,
  serializeVersion,
} from "@/lib/sop/editor-dto";
import {
  canArchiveSop,
  canCreateRevision,
  canEditVersion,
  canViewVersion,
  isProcessOwner,
} from "@/lib/sop/rbac";
import { NoAccess } from "../_no-access";
import { SopReadClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * The published SOP reading view (§14).
 *
 * The operational surface — what someone actually opens to do the work. It
 * renders whichever version is asked for, defaulting to the live published one,
 * and shows an explicit banner when the reader is looking at anything else, so
 * nobody follows a superseded procedure without noticing.
 */
export default async function SopDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { version?: string };
}) {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  const sop = await prisma.sop.findUnique({ where: { id: params.id }, include: sopDetailInclude });
  if (!sop || sop.deletedAt) notFound();

  const targetId = searchParams.version ?? sop.currentVersionId ?? sop.draftVersionId;
  const version = targetId
    ? await prisma.sopVersion.findFirst({
        where: { id: targetId, sopId: sop.id },
        include: versionDetailInclude,
      })
    : null;

  if (!version) notFound();
  if (!canViewVersion(access, sop, version)) {
    return (
      <NoAccess
        title="SOP"
        message="You do not have access to this SOP. If you believe you should, ask its process owner or a SOP administrator."
        cta={{ href: "/sop/library", label: "Go to the SOP Library" }}
      />
    );
  }

  const isOwner = isProcessOwner(access, sop);

  const [history, audit, myAck] = await Promise.all([
    versionHistory(sop.id),
    // The audit trail names people and their actions: governance surfaces only.
    access.isSopAdmin || isOwner ? auditTrail(sop.id, 100) : Promise.resolve([]),
    access.employeeId
      ? prisma.sopAcknowledgement.findUnique({
          where: { versionId_employeeId: { versionId: version.id, employeeId: access.employeeId } },
          select: { id: true, deadline: true, viewedAt: true, acknowledgedAt: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <TopBar title={sop.title} subtitle={`${sop.sopNumber} · ${version.versionLabel}`} />
      <div className="p-margin">
        <SopReadClient
          sop={serializeSopHeader(sop)}
          version={serializeVersion(version)}
          history={serializeHistory(history)}
          audit={serializeAudit(audit)}
          myAck={serializeMyAck(myAck)}
          isLiveVersion={version.id === sop.currentVersionId}
          capabilities={{
            canEdit: canEditVersion(access, sop, version),
            canCreateRevision: canCreateRevision(access, sop) && !!sop.currentVersionId && !sop.draftVersionId,
            canArchive: canArchiveSop(access, sop),
            canSeeAudit: access.isSopAdmin || isOwner,
            canSeeAcknowledgements: access.isSopAdmin || isOwner,
            canRecordKpi: access.isSopAdmin || isOwner,
          }}
        />
      </div>
    </>
  );
}
