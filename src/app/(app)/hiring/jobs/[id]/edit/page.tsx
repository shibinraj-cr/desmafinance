import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { EditJobClient } from "./client";

export const dynamic = "force-dynamic";

export default async function EditJobPage({ params }: { params: { id: string } }) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");
  if (!can(access, "job:write")) redirect(`/hiring/jobs/${params.id}`);

  const [job, locations, users, departments] = await Promise.all([
    prisma.hiringJob.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        rubrics: { orderBy: { position: "asc" } },
        _count: { select: { applications: true } },
      },
    }),
    prisma.hiringLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
    prisma.hiringJob.findMany({
      where: { deletedAt: null },
      select: { department: true },
      distinct: ["department"],
      orderBy: { department: "asc" },
    }),
  ]);
  if (!job) notFound();

  return (
    <>
      <TopBar
        title="Edit requisition"
        subtitle={job.title}
        action={
          <Link
            href={`/hiring/jobs/${job.id}`}
            className="h-10 px-md inline-flex items-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
          >
            Back to the job
          </Link>
        }
      />
      <div className="p-margin">
        <EditJobClient
          job={{
            id: job.id,
            title: job.title,
            slug: job.slug,
            department: job.department,
            locationId: job.locationId,
            workType: job.workType,
            employmentType: job.employmentType,
            seniority: job.seniority,
            compMinLakh: job.compMinLakh == null ? null : Number(job.compMinLakh),
            compMaxLakh: job.compMaxLakh == null ? null : Number(job.compMaxLakh),
            compVisible: job.compVisible,
            openings: job.openings,
            descriptionMd: job.descriptionMd,
            mustHaves: job.mustHaves,
            niceToHaves: job.niceToHaves,
            ownerId: job.ownerId,
            hiringManagerId: job.hiringManagerId,
            resumeMode: job.resumeMode,
            askScreeningQs: job.askScreeningQs,
            status: job.status,
            applicantCount: job._count.applications,
            rubrics: job.rubrics.map((r) => ({
              criterion: r.criterion,
              description: r.description ?? "",
              weight: r.weight,
            })),
          }}
          locations={locations}
          users={users}
          departments={departments.map((d) => d.department)}
        />
      </div>
    </>
  );
}
