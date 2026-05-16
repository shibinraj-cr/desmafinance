import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
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
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
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
            Only supervisors and admins can record the director&apos;s closed leads.
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

  const [sources, existing] = await Promise.all([
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
      select: { sourceId: true, closedWon: true },
    }),
  ]);
  const initialCloses: Record<string, number> = {};
  for (const r of existing) initialCloses[r.sourceId] = r.closedWon ?? 0;

  return (
    <DirectorEntryClient
      directorDisplayName={director.leadPulseRole?.displayName ?? director.username}
      date={date}
      today={today}
      sources={sources}
      initialCloses={initialCloses}
    />
  );
}
