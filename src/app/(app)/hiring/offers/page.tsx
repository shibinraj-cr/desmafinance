import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { offerInclude, serializeOffer } from "@/lib/hiring/offers";
import { OffersClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HiringOffersPage() {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "offer:manage")) {
    return (
      <>
        <TopBar title="Offers" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Offers are money, so they are kept to the Owner and HR Manager tiers. Recruiters see
            everything up to this point.
          </div>
        </div>
      </>
    );
  }

  const [offers, candidates, locations] = await Promise.all([
    prisma.hiringOffer.findMany({
      where: { deletedAt: null },
      include: offerInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    // Who can be offered: still active, on a req that is not closed. The rail
    // deliberately does NOT restrict this to a stage named "Offer" — stages are
    // renameable per job, and a recruiter who wants to move fast should not be
    // blocked by a column's label.
    prisma.hiringApplication.findMany({
      where: {
        deletedAt: null,
        status: "active",
        job: { deletedAt: null, status: { in: ["live", "paused"] } },
      },
      select: {
        id: true,
        candidate: { select: { fullName: true, email: true } },
        stage: { select: { name: true, kind: true } },
        job: {
          select: {
            id: true,
            title: true,
            department: true,
            locationId: true,
            compMinLakh: true,
            compMaxLakh: true,
          },
        },
      },
      orderBy: { aiScore: "desc" },
      take: 300,
    }),
    prisma.hiringLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <TopBar title="Offers & e-sign" subtitle="Simulate, approve, send, and get it signed" />
      <div className="p-margin">
        <OffersClient
          offers={offers.map(serializeOffer)}
          candidates={candidates.map((a) => ({
            applicationId: a.id,
            name: a.candidate.fullName,
            email: a.candidate.email,
            stageName: a.stage?.name ?? null,
            jobId: a.job.id,
            jobTitle: a.job.title,
            department: a.job.department,
            locationId: a.job.locationId,
            compMinLakh: a.job.compMinLakh == null ? null : Number(a.job.compMinLakh),
            compMaxLakh: a.job.compMaxLakh == null ? null : Number(a.job.compMaxLakh),
          }))}
          locations={locations}
          canApprove={can(access, "team:manage")}
          currentUserId={userId}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
