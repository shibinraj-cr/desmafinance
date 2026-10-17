import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { badRequest, conflict } from "@/lib/http-error";
import { cleanName } from "@/lib/finance-docs";
import { agreementFolderNamed, requireAgreementFilesUser } from "@/lib/esign/folders-store";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().min(1).max(500) });

/** POST /api/esign/folders — create a folder. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireAgreementFilesUser();
  const body = Body.parse(await req.json());
  const name = cleanName(body.name);
  if (!name) throw badRequest("The folder needs a name");

  const clash = await agreementFolderNamed(name);
  if (clash) throw conflict(`A folder called "${clash.name}" already exists`, "duplicate_name");

  const folder = await prisma.agreementFolder.create({ data: { name, createdById: userId } });
  await recordAudit({ entityType: "AgreementFolder", entityId: folder.id, action: "CREATE", userId, changes: { name } });
  return NextResponse.json({ folder });
});
