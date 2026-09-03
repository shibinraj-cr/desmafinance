import { redirect } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { SettingsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HiringSettingsPage() {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "team:manage")) {
    return (
      <>
        <TopBar title="Roles & Access" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Hiring roles and access are managed by the hiring Owner or HR Manager. You are signed in
            as <strong className="text-on-surface">{access.roleLabel}</strong>.
          </div>
        </div>
      </>
    );
  }

  const [members, users, lastActive] = await Promise.all([
    prisma.hiringMember.findMany({
      include: { user: { select: { id: true, username: true, email: true, isActive: true } } },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true, email: true },
      orderBy: { username: "asc" },
    }),
    // "Last active" without new plumbing: the engagement telemetry the app
    // already writes per user/module/day (see ModuleUsageDaily).
    prisma.moduleUsageDaily.groupBy({
      by: ["userId"],
      where: { moduleId: "hiring" },
      _max: { day: true },
    }),
  ]);

  const lastActiveByUser = new Map(
    lastActive.map((r) => [r.userId, r._max.day ? r._max.day.toISOString() : null]),
  );

  return (
    <>
      <TopBar title="Roles & Access" subtitle="Hiring workspace" />
      <div className="p-margin space-y-lg">
        <SettingsClient
          members={members.map((m) => ({
            id: m.id,
            userId: m.userId,
            username: m.user.username,
            email: m.user.email,
            userIsActive: m.user.isActive,
            baseRole: m.baseRole,
            customRoleName: m.customRoleName,
            extraPermissions: m.extraPermissions,
            deniedPermissions: m.deniedPermissions,
            isActive: m.isActive,
            lastActiveAt: lastActiveByUser.get(m.userId) ?? null,
          }))}
          allUsers={users}
          currentUserId={userId}
        />

        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h3 className="text-h3 text-on-surface mb-xs">How someone gets in</h3>
          <p className="text-body-md text-on-surface-variant">
            Two doors, and they compose. A Desgro role granted the{" "}
            <strong className="text-on-surface">Hiring → Roles &amp; Access</strong> page in{" "}
            <Link href="/roles" className="text-primary hover:underline">
              Role Management
            </Link>{" "}
            becomes an HR Manager here; a role granted any other hiring page becomes a Recruiter.
            System admins are always Owners. The table above overrides that for one specific person —
            use it to hand someone a narrower or wider hiring role without minting a new Desgro role.
          </p>
        </section>
      </div>
    </>
  );
}
