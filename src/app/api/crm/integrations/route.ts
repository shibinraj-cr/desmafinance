import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { prisma } from "@/lib/prisma";
import { siteBaseUrl } from "@/lib/site-url";
import { SHEET_SOURCES } from "@/lib/crm-sheet-ingest";
import { SHEET_LEADS_APPS_SCRIPT } from "@/lib/sheet-leads-apps-script";
import {
  getSetting,
  setSetting,
  SHEET_LEADS_SECRET_KEY,
  SHEET_LEADS_DATE_FLOOR_KEY,
  SHEET_LEADS_ROUTES_KEY,
} from "@/lib/app-settings";
import { getAssignableBdes } from "@/lib/crm-leads";
import { campaignKey, parseSheetRoutes, MAX_SHEET_ROUTES, type SheetRoute } from "@/lib/crm-sheet-routes";
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

// What the "Auto-assign by tab" editor needs: the rules, who can receive
// leads, the services a rule may stamp, and the tab names each source has sent
// (so the admin picks a tab rather than retyping Meta's double spaces).
async function routesSummary() {
  const [routes, bdes, services, batches] = await Promise.all([
    getSetting(SHEET_LEADS_ROUTES_KEY).then(parseSheetRoutes),
    getAssignableBdes(),
    prisma.service.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.leadImportBatch.findMany({
      where: { OR: Object.values(SHEET_SOURCES).map((s) => ({ fileName: { startsWith: s.label + ": " } })) },
      distinct: ["fileName"],
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { fileName: true },
    }),
  ]);
  const tabs: Record<string, string[]> = {};
  for (const s of Object.values(SHEET_SOURCES)) {
    const prefix = s.label + ": ";
    tabs[s.key] = batches
      .map((b) => b.fileName ?? "")
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length));
  }
  return {
    routes,
    routeOptions: {
      bdes: bdes.map((b) => ({ userId: b.userId, displayName: b.displayName, role: b.role })),
      services,
      tabs,
    },
  };
}

// GET /api/crm/integrations — config for the Integrations settings page (admin).
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const secret = await getSetting(SHEET_LEADS_SECRET_KEY);
  const health = await readSheetSyncHealth();
  const dateFloor = await getSetting(SHEET_LEADS_DATE_FLOOR_KEY);
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
    dateFloor,
    appsScript: SHEET_LEADS_APPS_SCRIPT,
    recentBatches: recent.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
    ...(await routesSummary()),
  });
});

// POST /api/crm/integrations — generate (or set) the webhook secret (admin).
const RouteSchema = z.object({
  source: z.string().trim().min(1).max(40),
  campaign: z.string().trim().min(1).max(200),
  assigneeUserId: z.string().trim().min(1).max(64),
  serviceId: z.string().trim().min(1).max(64).nullable().optional(),
});

const PostSchema = z.object({
  action: z.enum(["generate", "set", "set_floor", "clear_floor", "set_routes"]),
  /** The secret for "set"; an ISO timestamp for "set_floor" (omit for now). */
  value: z.string().trim().min(1).max(200).optional(),
  /** The full rule list for "set_routes" (replaces what is stored). */
  routes: z.array(RouteSchema).max(MAX_SHEET_ROUTES).optional(),
});

/**
 * Check a rule list before storing it: a known source, one rule per tab, an
 * active L1/L2 consultant (the only people `assignLeadTo` accepts — a rule
 * naming anyone else would fail on every lead), and an active service.
 */
async function validateRoutes(input: z.infer<typeof RouteSchema>[]): Promise<SheetRoute[]> {
  const bdeIds = new Set((await getAssignableBdes()).map((b) => b.userId));
  const serviceIds = new Set(
    (await prisma.service.findMany({ where: { isActive: true }, select: { id: true } })).map((s) => s.id),
  );
  const seen = new Set<string>();
  return input.map((r) => {
    if (!SHEET_SOURCES[r.source]) throw badRequest(`Unknown source "${r.source}"`, "unknown_source");
    const key = r.source + "|" + campaignKey(r.campaign);
    if (seen.has(key)) throw badRequest(`Tab "${r.campaign}" has two rules — keep one`, "duplicate_route");
    seen.add(key);
    if (!bdeIds.has(r.assigneeUserId)) {
      throw badRequest("Leads can only go to an active L1/L2 consultant on the Team Roster", "invalid_assignee");
    }
    const serviceId = r.serviceId ?? null;
    if (serviceId && !serviceIds.has(serviceId)) throw badRequest("That service is not active", "invalid_service");
    return { source: r.source, campaign: r.campaign, assigneeUserId: r.assigneeUserId, serviceId };
  });
}

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const { action, value, routes } = PostSchema.parse(await req.json().catch(() => null));

  // Replace the tab rules. Takes effect on the next batch each sheet sends.
  if (action === "set_routes") {
    const clean = await validateRoutes(routes ?? []);
    await setSetting(SHEET_LEADS_ROUTES_KEY, JSON.stringify(clean), userId);
    return NextResponse.json(await routesSummary());
  }

  // "Start fresh from here" — nothing dated earlier is imported by any sheet.
  if (action === "set_floor") {
    const at = value ? new Date(value) : new Date();
    if (Number.isNaN(at.getTime())) throw badRequest("Invalid date", "invalid_date");
    await setSetting(SHEET_LEADS_DATE_FLOOR_KEY, at.toISOString(), userId);
    return NextResponse.json({ dateFloor: at.toISOString() });
  }
  if (action === "clear_floor") {
    await prisma.appSetting.deleteMany({ where: { key: SHEET_LEADS_DATE_FLOOR_KEY } });
    return NextResponse.json({ dateFloor: null });
  }

  if (action === "set" && value && value.length < 16) throw badRequest("Secret is too short", "secret_too_short");
  const secret = action === "set" && value ? value : randomBytes(24).toString("base64url");
  await setSetting(SHEET_LEADS_SECRET_KEY, secret, userId);
  return NextResponse.json({ secret });
});
