import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, forbidden } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { listSops, type SopFilters, type SopSort } from "@/lib/sop/queries";
import { CreateSopSchema } from "@/lib/sop/schemas";
import { deptCodeFor, withMintedNumber } from "@/lib/sop/numbering";
import { initialVersion, versionLabel } from "@/lib/sop/versioning";
import { recordSopAudit } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

/** GET /api/sop/sops — the filtered, visibility-checked list. */
export const GET = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  const url = new URL(req.url);
  const q = url.searchParams;

  const filters: SopFilters = {
    search: q.get("q") ?? undefined,
    departmentIds: q.getAll("department"),
    ownerEmployeeIds: q.getAll("owner"),
    statuses: q.getAll("status"),
    categoryIds: q.getAll("category"),
    createdByIds: q.getAll("createdBy"),
    reviewDue: q.get("reviewDue") ?? undefined,
    archived: q.get("archived") === "1",
    requiresAcknowledgement: q.get("requiresAck") === "1",
    publishedOnly: q.get("published") === "1",
  };

  const { rows, total } = await listSops(access, filters, {
    sort: (q.get("sort") as SopSort | null) ?? "recent",
    take: Number(q.get("take") ?? 200),
  });
  return NextResponse.json({ rows, total });
});

/**
 * POST /api/sop/sops — create an SOP and its V1.0 draft.
 *
 * The Sop row and its first version are written in one transaction: an SOP with
 * no version is not a state any reader should ever observe.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  if (!access.canCreate) throw forbidden();

  const d = CreateSopSchema.parse(await req.json().catch(() => null));

  // The pickers come from the employee/department masters, so validate against
  // them rather than trusting the ids the client sent back.
  const [owner, department] = await Promise.all([
    prisma.employee.findFirst({ where: { id: d.ownerEmployeeId, active: true }, select: { id: true } }),
    prisma.hrDepartment.findFirst({ where: { id: d.departmentId, active: true }, select: { id: true, name: true } }),
  ]);
  if (!owner) throw badRequest("The SOP owner must be an active employee.", "bad_owner");
  if (!department) throw badRequest("The department was not found.", "bad_department");
  if (d.categoryId) {
    const category = await prisma.sopCategory.findFirst({
      where: { id: d.categoryId, isActive: true },
      select: { id: true },
    });
    if (!category) throw badRequest("The category was not found.", "bad_category");
  }

  const deptCode = await deptCodeFor(d.departmentId);
  const first = initialVersion();

  const created = await withMintedNumber(deptCode, async (minted) =>
    prisma.$transaction(async (tx) => {
      const sop = await tx.sop.create({
        data: {
          sopNumber: minted.sopNumber,
          deptCode: minted.deptCode,
          seq: minted.seq,
          title: d.title,
          departmentId: d.departmentId,
          categoryId: d.categoryId ?? null,
          processFunction: d.processFunction ?? null,
          ownerEmployeeId: d.ownerEmployeeId,
          confidentiality: d.confidentiality,
          status: "draft",
          createdById: access.userId,
        },
      });

      const version = await tx.sopVersion.create({
        data: {
          sopId: sop.id,
          versionLabel: versionLabel(first),
          major: first.major,
          minor: first.minor,
          status: "draft",
          title: d.title,
          departmentId: d.departmentId,
          categoryId: d.categoryId ?? null,
          processFunction: d.processFunction ?? null,
          ownerEmployeeId: d.ownerEmployeeId,
          supportingRoleIds: d.supportingRoleIds,
          confidentiality: d.confidentiality,
          reviewerId: d.reviewerId ?? null,
          approverId: d.approverId ?? null,
          createdById: access.userId,
        },
      });

      await tx.sop.update({ where: { id: sop.id }, data: { draftVersionId: version.id } });
      return { sop, version };
    }),
  );

  await recordSopAudit({
    sopId: created.sop.id,
    versionId: created.version.id,
    versionLabel: created.version.versionLabel,
    userId: access.userId,
    action: "SOP_CREATED",
    newValue: created.sop.sopNumber,
    metadata: { title: d.title, departmentId: d.departmentId },
  });

  return NextResponse.json(
    {
      sop: { id: created.sop.id, sopNumber: created.sop.sopNumber },
      version: { id: created.version.id, versionLabel: created.version.versionLabel },
    },
    { status: 201 },
  );
});
