import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { loadSopAccess } from "@/lib/sop/access";
import { sopStatusClass, sopStatusLabel } from "@/lib/sop/constants";
import { Empty, Pill, Td, Th, formatDateTime } from "@/components/sop/ui";
import { NoAccess } from "../_no-access";

export const dynamic = "force-dynamic";

/**
 * Review & Approval (§11) — the governance queue.
 *
 * Two lists, not one: "waiting on me" is a to-do, and "in flight" is oversight.
 * Merging them would bury the three items someone actually has to act on
 * underneath everything the department happens to have in motion.
 *
 * A reviewer is someone NAMED on a version, so the personal queue needs no
 * page grant to be correct — it is empty for anyone with nothing assigned. The
 * page grant only decides who gets the oversight list.
 */
export default async function SopReviewPage() {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  const live = { sop: { deletedAt: null, isArchived: false } } as const;

  const [mine, inFlight] = await Promise.all([
    prisma.sopVersion.findMany({
      where: {
        ...live,
        OR: [
          { reviewerId: access.userId, status: "review_requested" },
          { approverId: access.userId, status: "approval_pending" },
        ],
      },
      orderBy: { submittedForReviewAt: "asc" },
      include: {
        sop: { select: { id: true, sopNumber: true, title: true } },
        department: { select: { name: true } },
        ownerEmployee: { select: { name: true } },
      },
    }),
    access.isGovernance || access.isSopAdmin
      ? prisma.sopVersion.findMany({
          where: {
            ...live,
            status: { in: ["review_requested", "approval_pending", "approved", "changes_requested"] },
          },
          orderBy: { updatedAt: "desc" },
          take: 100,
          include: {
            sop: { select: { id: true, sopNumber: true, title: true } },
            department: { select: { name: true } },
            ownerEmployee: { select: { name: true } },
            reviewer: { select: { username: true } },
            approver: { select: { username: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Someone with neither an assignment nor the oversight grant has no business
  // on this page — say so rather than showing two empty tables.
  if (mine.length === 0 && !access.isGovernance && !access.isSopAdmin) {
    return (
      <NoAccess
        title="Review & Approval"
        message="Nothing is assigned to you for review or approval, and you do not have the SOP governance grant. SOPs assigned to you will appear here and in My SOPs."
        cta={{ href: "/sop/my-sops", label: "Go to My SOPs" }}
      />
    );
  }

  return (
    <>
      <TopBar title="Review & Approval" subtitle="SOPs moving through the workflow" />
      <div className="p-margin space-y-lg">
        <section>
          <h3 className="text-h3 text-on-surface mb-sm">Waiting on you</h3>
          {mine.length === 0 ? (
            <Empty
              icon="task_alt"
              title="Nothing waiting on you"
              hint="When an SOP is sent to you for review or approval, it appears here."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
              <table className="w-full min-w-[44rem] border-collapse">
                <thead className="bg-surface-container-low border-b border-outline-variant">
                  <tr>
                    <Th className="w-36">SOP ID</Th>
                    <Th>Title</Th>
                    <Th className="hidden md:table-cell w-40">Department</Th>
                    <Th className="hidden lg:table-cell w-40">Owner</Th>
                    <Th className="w-20">Version</Th>
                    <Th className="w-40">Stage</Th>
                    <Th className="hidden xl:table-cell w-44">Submitted</Th>
                    <Th className="w-24 text-right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((v) => (
                    <tr key={v.id} className="border-b border-outline-variant last:border-0">
                      <Td className="font-mono text-label-sm text-on-surface-variant">{v.sop.sopNumber}</Td>
                      <Td className="text-on-surface font-medium">{v.title}</Td>
                      <Td className="hidden md:table-cell text-on-surface-variant">
                        {v.department?.name ?? "—"}
                      </Td>
                      <Td className="hidden lg:table-cell text-on-surface-variant">
                        {v.ownerEmployee?.name ?? "—"}
                      </Td>
                      <Td className="font-mono text-label-sm">{v.versionLabel}</Td>
                      <Td>
                        <Pill className={sopStatusClass(v.status)}>{sopStatusLabel(v.status)}</Pill>
                      </Td>
                      <Td className="hidden xl:table-cell text-on-surface-variant whitespace-nowrap">
                        {formatDateTime(v.submittedForApprovalAt ?? v.submittedForReviewAt)}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {/* Straight into the editor: a reviewer has to read the
                            document before deciding, and the decision buttons
                            live in its action bar. */}
                        <Link
                          href={`/sop/${v.sop.id}/edit?version=${v.id}`}
                          className="text-label-sm text-accent hover:underline"
                        >
                          Review
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {(access.isGovernance || access.isSopAdmin) && (
          <section>
            <h3 className="text-h3 text-on-surface mb-sm">In flight</h3>
            {inFlight.length === 0 ? (
              <Empty icon="hourglass_empty" title="Nothing in the workflow" hint="Every SOP is either a draft or published." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
                <table className="w-full min-w-[48rem] border-collapse">
                  <thead className="bg-surface-container-low border-b border-outline-variant">
                    <tr>
                      <Th className="w-36">SOP ID</Th>
                      <Th>Title</Th>
                      <Th className="hidden md:table-cell w-40">Department</Th>
                      <Th className="w-20">Version</Th>
                      <Th className="w-40">Stage</Th>
                      <Th className="hidden lg:table-cell w-32">Reviewer</Th>
                      <Th className="hidden lg:table-cell w-32">Approver</Th>
                      <Th className="w-24 text-right">Open</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {inFlight.map((v) => (
                      <tr key={v.id} className="border-b border-outline-variant last:border-0">
                        <Td className="font-mono text-label-sm text-on-surface-variant">{v.sop.sopNumber}</Td>
                        <Td className="text-on-surface">{v.title}</Td>
                        <Td className="hidden md:table-cell text-on-surface-variant">
                          {v.department?.name ?? "—"}
                        </Td>
                        <Td className="font-mono text-label-sm">{v.versionLabel}</Td>
                        <Td>
                          <Pill className={sopStatusClass(v.status)}>{sopStatusLabel(v.status)}</Pill>
                        </Td>
                        <Td className="hidden lg:table-cell text-on-surface-variant">
                          {v.reviewer?.username ?? "—"}
                        </Td>
                        <Td className="hidden lg:table-cell text-on-surface-variant">
                          {v.approver?.username ?? "—"}
                        </Td>
                        <Td className="text-right">
                          <Link
                            href={`/sop/${v.sop.id}?version=${v.id}`}
                            className="text-label-sm text-accent hover:underline"
                          >
                            Open
                          </Link>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
