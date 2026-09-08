import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { ReferralsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HiringReferralsPage() {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");
  if (!can(access, "referral:manage")) redirect("/me/home");

  const seesAll = can(access, "candidate:read");

  const [jobs, referrals] = await Promise.all([
    prisma.hiringJob.findMany({
      where: { status: "live", deletedAt: null },
      select: { id: true, title: true, department: true, mustHaves: true, openings: true },
      orderBy: { title: "asc" },
    }),
    prisma.hiringReferral.findMany({
      where: seesAll ? {} : { referrerId: userId },
      include: {
        job: { select: { title: true, department: true } },
        candidate: { select: { fullName: true } },
        referrer: { select: { username: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <>
      <TopBar
        title="Referrals"
        subtitle="Refer someone you'd vouch for — the bonus pays out when they're hired"
      />
      <div className="p-margin">
        <ReferralsClient
          jobs={jobs}
          referrals={referrals.map((r) => ({
            id: r.id,
            candidateName: r.candidate.fullName,
            jobTitle: r.job.title,
            department: r.job.department,
            referrerName: r.referrer.username,
            status: r.status,
            bonusStatus: r.bonusStatus,
            bonusAmount: r.bonusAmount == null ? null : Number(r.bonusAmount),
            createdAt: r.createdAt.toISOString(),
          }))}
          seesAll={seesAll}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
