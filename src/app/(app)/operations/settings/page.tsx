import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";

export const dynamic = "force-dynamic";

export default async function OperationsSettingsPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const access = getOpsAccess(userId, perms);
  if (!access.isOpsManager) {
    return (
      <>
        <TopBar title="Operations Settings" subtitle="Operations" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Operations settings are available to Operations managers only.
          </div>
        </div>
      </>
    );
  }

  const [templates, activeProjects, services, untemplated] = await Promise.all([
    prisma.processTemplate.count({ where: { isActive: true } }),
    prisma.opsProject.count({ where: { status: "active" } }),
    prisma.service.count({ where: { isActive: true } }),
    // Active services lacking an active template — surfaced so the team knows
    // which processes still need authoring (enrollments there get no project).
    prisma.service.findMany({
      where: { isActive: true, processTemplates: { none: { isActive: true } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const Stat = ({ label, value }: { label: string; value: number }) => (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
      <div className="text-display-sm text-on-surface tabular-nums">{value}</div>
      <div className="text-label-sm text-on-surface-variant">{label}</div>
    </div>
  );

  return (
    <>
      <TopBar title="Operations Settings" subtitle="Control panel" />
      <div className="p-margin space-y-lg">
        <div className="grid gap-md sm:grid-cols-3">
          <Stat label="Active templates" value={templates} />
          <Stat label="Active projects" value={activeProjects} />
          <Stat label="Active services" value={services} />
        </div>

        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h3 className="text-h3 text-on-surface mb-xs">Process templates</h3>
          <p className="text-body-sm text-on-surface-variant mb-sm">
            Define the steps for each service. New enrollments use the active template for their service.
          </p>
          <Link href="/operations/templates" className="text-primary hover:underline text-body-sm font-semibold">
            Manage templates →
          </Link>
          {untemplated.length > 0 && (
            <div className="mt-md rounded-lg border border-outline-variant bg-surface-container-low p-md">
              <div className="text-label-sm text-on-surface-variant mb-xs">
                Services without an active template ({untemplated.length}) — enrollments here create no project until a template exists:
              </div>
              <div className="text-body-sm text-on-surface">{untemplated.map((s) => s.name).join(", ")}</div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
          <h3 className="text-h3 text-on-surface mb-xs">Access</h3>
          <p className="text-body-sm text-on-surface-variant">
            Grant the <strong>Operations User</strong> role for day-to-day workers (My Work + Projects), or{" "}
            <strong>Operations Manager</strong> (adds Templates + this Settings page, plus assignment) in{" "}
            <Link href="/roles" className="text-primary hover:underline">Role Management</Link>.
          </p>
        </section>
      </div>
    </>
  );
}
