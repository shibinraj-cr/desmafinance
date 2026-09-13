import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { SopEditor, type EditorCapabilities } from "@/components/sop/SopEditor";
import { loadSopAccess } from "@/lib/sop/access";
import { editorOptions, versionDetailInclude } from "@/lib/sop/queries";
import { serializeSopHeader, serializeVersion } from "@/lib/sop/editor-dto";
import { sopDetailInclude } from "@/lib/sop/queries";
import {
  canApproveVersion,
  canEditVersion,
  canPublish,
  canRequestReview,
  canReview,
  canViewVersion,
  isProcessOwner,
} from "@/lib/sop/rbac";
import { NoAccess } from "../../_no-access";

export const dynamic = "force-dynamic";

/**
 * The SOP builder for an existing SOP.
 *
 * Which version it opens, in order: the one asked for, else the in-flight
 * draft, else the published one. That last case is not an error — a reviewer
 * or an admin opening the editor on a published SOP gets the same screen in
 * read-only mode, which is how they see exactly what was approved.
 *
 * Every capability handed to the client is computed HERE from the same
 * `rbac.ts` functions the API routes call, so the buttons on screen and the
 * permissions on the server can never disagree.
 */
export default async function SopEditPage({
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

  const targetId = searchParams.version ?? sop.draftVersionId ?? sop.currentVersionId;
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
        message="You do not have access to this SOP."
        cta={{ href: "/sop/library", label: "Go to the SOP Library" }}
      />
    );
  }

  const capabilities: EditorCapabilities = {
    canEdit: canEditVersion(access, sop, version),
    // "Request review" shows only when there IS a reviewer to send it to;
    // otherwise the author gets "Submit for approval" instead, so the button
    // bar never offers an action the server will refuse.
    canRequestReview: canRequestReview(access, sop, version) && !!version.reviewerId,
    canSubmitForApproval: canRequestReview(access, sop, version) && !version.reviewerId,
    canReview: canReview(access, sop, version),
    canApprove: canApproveVersion(access, sop, version),
    canPublish: canPublish(access, sop, version),
    canRecordKpi: access.isSopAdmin || isProcessOwner(access, sop),
  };

  const options = await editorOptions();

  return (
    <>
      <TopBar
        title={sop.title}
        subtitle={`${sop.sopNumber} · ${version.versionLabel}`}
        action={
          <Link
            href={`/sop/${sop.id}`}
            className="h-10 px-lg inline-flex items-center gap-xs rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              arrow_back
            </span>
            Back to SOP
          </Link>
        }
      />
      <div className="p-margin">
        <SopEditor
          sop={serializeSopHeader(sop)}
          version={serializeVersion(version)}
          options={options}
          capabilities={capabilities}
        />
      </div>
    </>
  );
}
