import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { todayIst, toPrismaDate } from "@/lib/lead-pulse-dates";
import { DirectorEntryClient } from "./client";

export const dynamic = "force-dynamic";

const DIRECTOR_USERNAME = "devika";

export default async function DirectorEntryPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  // Director Entry is retired — the CRM now captures every close directly, so
  // this legacy self-report surface is admin-only for oversight.
  if (!isAdmin(perms)) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <h1 className="text-[20px] font-semibold mb-[8px]">Admin access required</h1>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            Director Entry has been retired — the CRM now captures every enrollment directly. This page is available to
            administrators only.
          </p>
        </div>
      </div>
    );
  }

  const director = await prisma.user.findFirst({
    where: { username: { equals: DIRECTOR_USERNAME, mode: "insensitive" } },
    select: {
      id: true,
      username: true,
      leadPulseRole: { select: { displayName: true } },
    },
  });
  if (!director) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            No user named &quot;{DIRECTOR_USERNAME}&quot; is set up. Ask an admin to
            create the account.
          </p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  const date =
    searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : today;

  const [sources, existing, services] = await Promise.all([
    prisma.leadPulseSource.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, code: true },
    }),
    prisma.leadPulseDailyEntry.findMany({
      where: {
        userId: director.id,
        entryDate: toPrismaDate(date),
        roleAtEntry: "l2",
      },
      include: {
        closes: {
          orderBy: { createdAt: "asc" },
          select: { serviceId: true },
        },
      },
    }),
    // Active services for the per-close service picker — same filter
    // the L2 BDE form uses so both surfaces stay in lockstep.
    prisma.service.findMany({
      where: { isActive: true, showInL2Targets: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const initialCloses: Record<string, { count: number; serviceIds: string[] }> = {};
  for (const r of existing) {
    initialCloses[r.sourceId] = {
      count: r.closedWon ?? 0,
      serviceIds: r.closes.map((c) => c.serviceId),
    };
  }

  return (
    <DirectorEntryClient
      directorDisplayName={director.leadPulseRole?.displayName ?? director.username}
      date={date}
      today={today}
      sources={sources}
      services={services}
      initialCloses={initialCloses}
    />
  );
}
