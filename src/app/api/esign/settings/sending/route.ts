import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { forbidden } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { requireAgreementsUser } from "@/lib/esign/send";
import { setSendingEnabled } from "@/lib/esign/settings";

export const dynamic = "force-dynamic";

/** PUT /api/esign/settings/sending — admins switch sending to clients on or off. */
export const PUT = withApiHandler(async (req: Request) => {
  const { userId, isAdmin } = await requireAgreementsUser();
  if (!isAdmin) throw forbidden("Only an admin can switch agreement sending on or off.");
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await req.json().catch(() => null));
  await setSendingEnabled(enabled, userId);
  await recordAudit({ entityType: "AppSetting", entityId: "esign_sending_enabled", action: "UPDATE", userId, changes: { enabled } });
  return NextResponse.json({ enabled });
});
