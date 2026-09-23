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
import { readSheetSyncHealth, verdictFor, explainVerdict, type SheetSyncHealth } from "@/lib/sheet-sync-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto

// "Last sync" only ever meant "last time a row became a NEW lead", which is
// silent both when the sheet stops calling and when every row is already in the
// CRM. The health heartbeat separates the two — see sheet-sync-health.ts.
async function sourcesSummary(health: SheetSyncHealth) {
  return Promise.all(
    Object.values(SHEET_SOURCES).map(async (s) => {
      const src = await prisma.leadPulseSource.findUnique({
        where: { code: s.sourceCode },
        select: { id: true },
      });
      const [leadCount, lastBatch] = await Promise.all([
        src ? prisma.lead.count({ where: { sourceId: src.id } }) : Promise.resolve(0),
        // Last time this source pushed data (the import batch records the sync time;
        // lead.createdAt is the original lead date, so it can't be used here).
        prisma.leadImportBatch.findFirst({
          where: { fileName: { startsWith: s.label + ":" } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      const contact = health.contacts[s.key] ?? null;
      const verdict = verdictFor({ contact, rejected: health.rejected });
      return {
        key: s.key,
        label: s.label,
        sourceCode: s.sourceCode,
        nameColumns: s.nameKeys.slice(0, 4),
        emailColumns: s.emailKeys.slice(0, 3),
        phoneColumns: s.phoneKeys.slice(0, 4),
        leadCount,
        lastSyncAt: lastBatch?.createdAt?.toISOString() ?? null,
        lastContactAt: contact?.at ?? null,
        lastContact: contact,
        verdict,
        verdictNote: explainVerdict(verdict, contact, health.rejected),
      };
    }),
  );
}

// GET /api/crm/integrations — config for the Integrations settings page (admin).
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const secret = await getSetting(SHEET_LEADS_SECRET_KEY);
  const health = await readSheetSyncHealth();
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
    sources: await sourcesSummary(health),
    rejected: health.rejected,
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
