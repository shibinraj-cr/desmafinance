import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { loadSopAccess } from "@/lib/sop/access";
import { acknowledgementRegister, myAcknowledgements, visibleSopWhere } from "@/lib/sop/queries";
import { ACK_STATE_CLASSES, ACK_STATE_LABELS } from "@/lib/sop/constants";
import { Empty, Pill, Section, Td, Th, formatDate, formatDateTime } from "@/components/sop/ui";

export const dynamic = "force-dynamic";

/**
 * Acknowledgements (§13).
 *
 * Two audiences on one page, in the order that matters to each:
 *   • Everyone sees their OWN outstanding acknowledgements first, because that
 *     is the thing they can actually do something about.
 *   • Process owners and SOP admins then see the compliance register — either
 *     one version in detail (`?version=`) or a roll-up across the SOPs they are
 *     responsible for.
 */
export default async function SopAcknowledgementsPage({
  searchParams,
}: {
  searchParams: { version?: string };
}) {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  const mine = await myAcknowledgements(access);

  // One version's register, when asked for and the viewer is entitled to it.
  let register: Awaited<ReturnType<typeof acknowledgementRegister>> | null = null;
  let registerVersion: { id: string; versionLabel: string; sopId: string; sopNumber: string; title: string } | null =
    null;

  if (searchParams.version) {
    const v = await prisma.sopVersion.findUnique({
      where: { id: searchParams.version },
      select: {
        id: true,
        versionLabel: true,
        ownerEmployeeId: true,
        sop: { select: { id: true, sopNumber: true, title: true } },
      },
    });
    const isOwner = !!v && !!access.employeeId && v.ownerEmployeeId === access.employeeId;
    if (v && (access.isSopAdmin || isOwner)) {
      register = await acknowledgementRegister(v.id);
      registerVersion = {
        id: v.id,
        versionLabel: v.versionLabel,
        sopId: v.sop.id,
        sopNumber: v.sop.sopNumber,
        title: v.sop.title,
      };
    }
  }

  // The roll-up: every published version requiring acknowledgement that the
  // viewer oversees, with its five compliance numbers.
  const oversight =
    !register && (access.isSopAdmin || !!access.employeeId)
      ? await prisma.sopVersion.findMany({
          where: {
            requiresAcknowledgement: true,
            status: "published",
            currentOf: { is: visibleSopWhere(access) },
            ...(access.isSopAdmin ? {} : { ownerEmployeeId: access.employeeId ?? "__none__" }),
          },
          orderBy: { publishedAt: "desc" },
          take: 100,
          select: {
            id: true,
            versionLabel: true,
            acknowledgementDeadline: true,
            publishedAt: true,
            sop: { select: { id: true, sopNumber: true, title: true } },
            acknowledgements: { select: { deadline: true, viewedAt: true, acknowledgedAt: true } },
          },
        })
      : [];

  return (
    <>
      <TopBar title="Acknowledgements" subtitle="Who has read which SOP" />
      <div className="p-margin space-y-lg">
        {/* ── Mine ── */}
        <Section
          title="Your acknowledgements"
          description="SOPs published to you, and whether you have confirmed them."
        >
          {mine.length === 0 ? (
            <Empty
              icon="how_to_reg"
              title="Nothing assigned to you"
              hint={
                access.employeeId
                  ? "You are up to date — no SOP is waiting on your confirmation."
                  : "Your login is not linked to an employee record, so SOPs cannot be assigned to you. Ask HR to link your account."
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-outline-variant">
              <table className="w-full min-w-[44rem] border-collapse">
                <thead className="bg-surface-container-low border-b border-outline-variant">
                  <tr>
                    <Th className="w-36">SOP ID</Th>
                    <Th>Title</Th>
                    <Th className="w-20">Version</Th>
                    <Th className="hidden lg:table-cell w-36">Process owner</Th>
                    <Th className="hidden md:table-cell w-32">Effective</Th>
                    <Th className="w-32">Deadline</Th>
                    <Th className="w-36">Status</Th>
                    <Th className="w-24 text-right">Open</Th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((a) => (
                    <tr key={a.id} className="border-b border-outline-variant last:border-0">
                      <Td className="font-mono text-label-sm text-on-surface-variant">{a.sopNumber}</Td>
                      <Td className="text-on-surface font-medium">{a.title}</Td>
                      <Td className="font-mono text-label-sm">{a.versionLabel}</Td>
                      <Td className="hidden lg:table-cell text-on-surface-variant">{a.processOwner ?? "—"}</Td>
                      <Td className="hidden md:table-cell text-on-surface-variant">
                        {formatDate(a.effectiveDate)}
                      </Td>
                      <Td className="text-on-surface-variant">{formatDate(a.deadline)}</Td>
                      <Td>
                        <Pill className={ACK_STATE_CLASSES[a.state]}>{ACK_STATE_LABELS[a.state]}</Pill>
                      </Td>
                      <Td className="text-right">
                        <Link
                          href={`/sop/${a.sopId}?version=${a.versionId}`}
                          className="text-label-sm text-accent hover:underline"
                        >
                          {a.acknowledgedAt ? "Read SOP" : "Read & confirm"}
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── One version's register ── */}
        {register && registerVersion && (
          <Section
            title={`${registerVersion.sopNumber} — ${registerVersion.title}`}
            description={`Acknowledgement register for ${registerVersion.versionLabel}.`}
            action={
              <Link href="/sop/acknowledgements" className="text-label-sm text-accent hover:underline">
                Back to all
              </Link>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-base mb-md">
              <Stat label="Assigned" value={register.summary.total} />
              <Stat label="Viewed" value={register.summary.viewed} />
              <Stat label="Acknowledged" value={register.summary.acknowledged} />
              <Stat label="Pending" value={register.summary.pending} />
              <Stat label="Overdue" value={register.summary.overdue} alert={register.summary.overdue > 0} />
            </div>

            <div className="overflow-x-auto rounded-xl border border-outline-variant">
              <table className="w-full min-w-[40rem] border-collapse">
                <thead className="bg-surface-container-low border-b border-outline-variant">
                  <tr>
                    <Th className="w-28">Code</Th>
                    <Th>Employee</Th>
                    <Th className="hidden md:table-cell w-40">Department</Th>
                    <Th className="hidden lg:table-cell w-44">Viewed</Th>
                    <Th className="hidden lg:table-cell w-44">Acknowledged</Th>
                    <Th className="w-36">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {register.rows.map((r) => (
                    <tr key={r.id} className="border-b border-outline-variant last:border-0">
                      <Td className="font-mono text-label-sm text-on-surface-variant">{r.empCode}</Td>
                      <Td className="text-on-surface">{r.employeeName}</Td>
                      <Td className="hidden md:table-cell text-on-surface-variant">{r.department ?? "—"}</Td>
                      <Td className="hidden lg:table-cell text-on-surface-variant">
                        {formatDateTime(r.viewedAt)}
                      </Td>
                      <Td className="hidden lg:table-cell text-on-surface-variant">
                        {formatDateTime(r.acknowledgedAt)}
                      </Td>
                      <Td>
                        <Pill className={ACK_STATE_CLASSES[r.state]}>{ACK_STATE_LABELS[r.state]}</Pill>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* ── Oversight roll-up ── */}
        {!register && oversight.length > 0 && (
          <Section
            title="Acknowledgement status"
            description={
              access.isSopAdmin
                ? "Every published SOP that requires acknowledgement."
                : "The SOPs you own that require acknowledgement."
            }
          >
            <div className="overflow-x-auto rounded-xl border border-outline-variant">
              <table className="w-full min-w-[44rem] border-collapse">
                <thead className="bg-surface-container-low border-b border-outline-variant">
                  <tr>
                    <Th className="w-36">SOP ID</Th>
                    <Th>Title</Th>
                    <Th className="w-20">Version</Th>
                    <Th className="w-24">Assigned</Th>
                    <Th className="w-24">Viewed</Th>
                    <Th className="w-28">Acknowledged</Th>
                    <Th className="w-24">Overdue</Th>
                    <Th className="hidden lg:table-cell w-32">Deadline</Th>
                    <Th className="w-24 text-right">Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  {oversight.map((v) => {
                    const total = v.acknowledgements.length;
                    const acknowledged = v.acknowledgements.filter((a) => a.acknowledgedAt).length;
                    const viewed = v.acknowledgements.filter((a) => a.viewedAt || a.acknowledgedAt).length;
                    const overdue = v.acknowledgements.filter(
                      (a) => !a.acknowledgedAt && a.deadline && a.deadline < new Date(),
                    ).length;
                    return (
                      <tr key={v.id} className="border-b border-outline-variant last:border-0">
                        <Td className="font-mono text-label-sm text-on-surface-variant">{v.sop.sopNumber}</Td>
                        <Td className="text-on-surface font-medium">{v.sop.title}</Td>
                        <Td className="font-mono text-label-sm">{v.versionLabel}</Td>
                        <Td className="text-on-surface-variant">{total}</Td>
                        <Td className="text-on-surface-variant">{viewed}</Td>
                        <Td className="text-on-surface">
                          {acknowledged}
                          {total > 0 && (
                            <span className="text-caption text-on-surface-variant">
                              {" "}
                              ({Math.round((acknowledged / total) * 100)}%)
                            </span>
                          )}
                        </Td>
                        <Td className={overdue > 0 ? "text-error font-medium" : "text-on-surface-variant"}>
                          {overdue}
                        </Td>
                        <Td className="hidden lg:table-cell text-on-surface-variant">
                          {formatDate(v.acknowledgementDeadline)}
                        </Td>
                        <Td className="text-right">
                          <Link
                            href={`/sop/acknowledgements?version=${v.id}`}
                            className="text-label-sm text-accent hover:underline"
                          >
                            Open
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div
      className={
        "rounded-xl border p-md " + (alert ? "border-error bg-error-container/30" : "border-outline-variant")
      }
    >
      <div className="text-label-sm text-on-surface-variant">{label}</div>
      <div className={"text-h3 mt-px " + (alert ? "text-error" : "text-on-surface")}>{value}</div>
    </div>
  );
}
