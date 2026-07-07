import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { TeamRosterEditor, AddBdeButton } from "./client";

export const dynamic = "force-dynamic";

export default async function TeamRosterPage() {
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
            Only Lead Pulse Supervisors and DESGRO Admins can manage the team roster.
          </p>
        </div>
      </div>
    );
  }

  const [roles, allUsers, regions] = await Promise.all([
    prisma.leadPulseRole.findMany({
      orderBy: [{ role: "asc" }, { displayName: "asc" }],
      include: { user: { select: { id: true, username: true, email: true } } },
    }),
    prisma.user.findMany({
      orderBy: [{ username: "asc" }],
      select: { id: true, username: true, email: true },
    }),
    prisma.leadPulseRegion.findMany({
      where: { active: true },
      orderBy: { label: "asc" },
      select: { code: true, label: true },
    }),
  ]);

  // Pre-compute "users without a Lead Pulse role" so the Add BDE picker only
  // shows assignable users.
  const rosteredIds = new Set(roles.map((r) => r.userId));
  const assignable = allUsers.filter((u) => !rosteredIds.has(u.id));

  return (
    <div className="px-[24px] py-[24px] space-y-[24px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Team Roster</h1>
          <p
            className="mt-[4px] text-[13px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            {roles.length} BDE{roles.length === 1 ? "" : "s"} rostered ·{" "}
            {assignable.length} unassigned DESGRO user{assignable.length === 1 ? "" : "s"}
          </p>
        </div>
        <AddBdeButton assignableUsers={assignable} regions={regions} />
      </header>

      <TeamRosterEditor
        roster={roles.map((r) => ({
          id: r.id,
          userId: r.userId,
          username: r.user.username,
          email: r.user.email,
          role: r.role as "l1" | "l2" | "supervisor",
          displayName: r.displayName,
          phone: r.phone,
          regionFocus: r.regionFocus,
          active: r.active,
        }))}
        regions={regions}
      />
    </div>
  );
}
