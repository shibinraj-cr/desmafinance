import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { prisma } from "@/lib/prisma";
import { siteBaseUrl } from "@/lib/site-url";
import { SHEET_SOURCES } from "@/lib/crm-sheet-ingest";
import { SHEET_LEADS_APPS_SCRIPT } from "@/lib/sheet-leads-apps-script";
import { getSetting, setSetting, SHEET_LEADS_SECRET_KEY } from "@/lib/app-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto

function sourcesSummary() {
  return Object.values(SHEET_SOURCES).map((s) => ({
    key: s.key,
    label: s.label,
    sourceCode: s.sourceCode,
    nameColumns: s.nameKeys.slice(0, 4),
    emailColumns: s.emailKeys.slice(0, 3),
    phoneColumns: s.phoneKeys.slice(0, 4),
  }));
}

// GET /api/crm/integrations — config for the Integrations settings page (admin).
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const secret = await getSetting(SHEET_LEADS_SECRET_KEY);
  const recent = await prisma.leadImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      fileName: true,
      totalRows: true,
      insertedRows: true,
      duplicateRows: true,
      errorRows: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    webhookUrl: `${siteBaseUrl(req)}/api/integrations/sheet-leads`,
    secret: secret ?? null,
    secretSet: !!secret,
    envFallback: !secret && !!process.env.SHEET_LEADS_WEBHOOK_SECRET,
    sources: sourcesSummary(),
    appsScript: SHEET_LEADS_APPS_SCRIPT,
    recentBatches: recent.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
  });
});

// POST /api/crm/integrations — generate (or set) the webhook secret (admin).
const PostSchema = z.object({
  action: z.enum(["generate", "set"]),
  value: z.string().trim().min(16).max(200).optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const { action, value } = PostSchema.parse(await req.json().catch(() => null));
  const secret = action === "set" && value ? value : randomBytes(24).toString("base64url");
  await setSetting(SHEET_LEADS_SECRET_KEY, secret, userId);
  return NextResponse.json({ secret });
});
