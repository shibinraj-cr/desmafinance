import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { isCareersPublic, setCareersPublic } from "@/lib/hiring/careers";

export const dynamic = "force-dynamic";

const schema = z.object({ isPublic: z.boolean() });

/**
 * PUT /api/hiring/careers-visibility — publish or unpublish the careers site.
 *
 * Audited, because "when did the public careers page go live" is exactly the
 * kind of question somebody asks three months later.
 */
export const PUT = withApiHandler(async (req: Request) => {
  const access = await requireHiring("team:manage");
  const { isPublic } = schema.parse(await req.json());
  const before = await isCareersPublic();

  await setCareersPublic(isPublic, access.userId);

  await recordHiringAudit({
    actorId: access.userId,
    action: isPublic ? "careers.published" : "careers.unpublished",
    entityType: "AppSetting",
    entityId: "hiring_careers_public",
    before: { isPublic: before },
    after: { isPublic },
  });

  return NextResponse.json({ isPublic });
});
