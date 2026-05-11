import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess, leadPulseRoleLabel, leadPulseRoleBadgeClass } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

/**
 * Index of all BDEs. Supervisors land here first; clicking a BDE drills
 * into [userId]/page.tsx for the per-BDE detail view.
 */
export default async function BdePerformanceIndexPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);

  // BDEs see their own page directly; supervisors see the index.
  if (access.role === "l1" || access.role === "l2") {
    redirect(`/marketing/lead-pulse/bde-performance/${userId}`);
  }
  if (!access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
        >
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            You don&apos;t have permission to view BDE performance.
          </p>
        </div>
      </div>
    );
  }

  const roles = await prisma.leadPulseRole.findMany({
    where: { role: { in: ["l1", "l2"] } },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
    include: { user: { select: { username: true, email: true } } },
  });

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header>
        <h1 className="text-[30px] font-bold tracking-tight">BDE Performance</h1>
        <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          Pick a BDE to drill into their funnel and recent activity.
        </p>
      </header>

      <div
        className="rounded-[12px] border overflow-hidden"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              <Th>Name</Th>
              <Th>Username</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th align="right">{""}</Th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                <td className="px-[16px] py-[10px] font-semibold">{r.displayName}</td>
                <td className="px-[16px] py-[10px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                  {r.user.username}
                </td>
                <td className="px-[16px] py-[10px]">
                  <span className={`text-[11px] px-[8px] py-[2px] rounded-full font-semibold ${leadPulseRoleBadgeClass(r.role)}`}>
                    {leadPulseRoleLabel(r.role)}
                  </span>
                </td>
                <td className="px-[16px] py-[10px] text-[12px]" style={{ color: r.active ? "var(--lp-cyan)" : "var(--lp-on-surface-variant)" }}>
                  {r.active ? "Active" : "Inactive"}
                </td>
                <td className="px-[16px] py-[10px] text-right">
                  <Link
                    href={`/marketing/lead-pulse/bde-performance/${r.userId}`}
                    className="text-[12px] underline"
                    style={{ color: "var(--lp-primary)" }}
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
            {roles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-[16px] py-[24px] text-center" style={{ color: "var(--lp-on-surface-variant)" }}>
                  No BDEs rostered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="px-[16px] py-[10px] text-[11px] font-semibold uppercase tracking-[0.05em]"
      style={{ textAlign: align ?? "left", color: "var(--lp-on-surface-variant)" }}
    >
      {children}
    </th>
  );
}
