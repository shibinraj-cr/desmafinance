import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import { getPipelineForecast } from "@/lib/lead-pulse-metrics";
import { todayIst } from "@/lib/lead-pulse-dates";
import { PipelineClient } from "./client";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { tab?: string; userId?: string; year?: string; month?: string; status?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);

  if (access.role !== "l2" && !access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <h1 className="text-[20px] font-semibold mb-[8px]">Pipeline is for L2 BDEs</h1>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            Only L2 BDEs and supervisors can see the pipeline tracker.
          </p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  const tab: "list" | "forecast" = searchParams.tab === "forecast" ? "forecast" : "list";

  // Month filter. Absent = every month on the list (the historical default, so
  // nothing disappears for someone who just opens the page); the forecast tab
  // always needs a month, so it falls back to the current one.
  const rawYear = Number(searchParams.year);
  const rawMonth = Number(searchParams.month);
  const monthFiltered =
    Number.isInteger(rawYear) && rawYear > 2000 && Number.isInteger(rawMonth) && rawMonth >= 1 && rawMonth <= 12;
  const year = monthFiltered ? rawYear : Number(today.slice(0, 4));
  const month = monthFiltered ? rawMonth : Number(today.slice(5, 7));

  const status =
    searchParams.status === "open" || searchParams.status === "closed_won" || searchParams.status === "lost"
      ? searchParams.status
      : null;

  // Pick whose pipeline to load.
  const scopedUserId = access.canSupervise
    ? searchParams.userId || null
    : userId;

  // A deal belongs to a month if it is either expected to close in it or was
  // actually closed in it — same rule the forecast uses, so both tabs agree on
  // what "August" means.
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const where: Prisma.LeadPulsePipelineWhereInput = {
    ...(scopedUserId ? { userId: scopedUserId } : {}),
    ...(status ? { status } : {}),
    ...(monthFiltered
      ? {
          OR: [
            { expectedCloseDate: { gte: monthStart, lte: monthEnd } },
            { closedDate: { gte: monthStart, lte: monthEnd } },
          ],
        }
      : {}),
  };

  const [rows, l2Bdes, services, sources, forecast] = await Promise.all([
    prisma.leadPulsePipeline.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { expectedCloseDate: "asc" },
      ],
      include: {
        service: { select: { id: true, name: true } },
        source: { select: { id: true, code: true, label: true } },
        user: { select: { id: true, username: true } },
      },
    }),
    prisma.leadPulseRole.findMany({
      where: { role: "l2" },
      orderBy: [{ active: "desc" }, { displayName: "asc" }],
      select: { userId: true, displayName: true, active: true },
    }),
    prisma.service.findMany({
      where: { isActive: true, showInL2Targets: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.leadPulseSource.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, code: true, label: true },
    }),
    tab === "forecast"
      ? getPipelineForecast(year, month, scopedUserId ? { userId: scopedUserId } : undefined)
      : Promise.resolve(null),
  ]);

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <PipelineClient
      currentUserId={userId}
      canSupervise={access.canSupervise}
      ownerFilter={scopedUserId}
      l2Bdes={l2Bdes}
      services={services}
      sources={sources}
      today={today}
      tab={tab}
      year={year}
      month={month}
      monthFiltered={monthFiltered}
      monthLabel={monthLabel}
      status={status}
      rows={rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.user.username,
        candidateName: r.candidateName,
        candidatePhone: r.candidatePhone,
        partyId: r.partyId,
        serviceId: r.serviceId,
        serviceName: r.service.name,
        sourceId: r.sourceId,
        sourceLabel: r.source.label,
        expectedCloseDate: r.expectedCloseDate.toISOString().slice(0, 10),
        expectedFirstInstallment: Number(r.expectedFirstInstallment.toString()),
        status: r.status as "open" | "closed_won" | "lost",
        closedDate: r.closedDate ? r.closedDate.toISOString().slice(0, 10) : null,
        notes: r.notes,
      }))}
      forecast={forecast}
    />
  );
}
