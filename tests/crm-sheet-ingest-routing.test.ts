/**
 * The sheet ingest hands a routed tab's leads to applySheetRoute: the leads it
 * just created plus the existing leads candidates re-enquired on (each with the
 * stage it was in before the re-enquiry) — and not the rows it skipped as
 * already known.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  leadPulseSource: { findUnique: vi.fn() },
  crmQualification: { findMany: vi.fn() },
  lead: { findMany: vi.fn(), createMany: vi.fn() },
  leadImportBatch: { create: vi.fn(), update: vi.fn() },
  leadActivity: { createMany: vi.fn() },
}));
const routes = vi.hoisted(() => ({ applySheetRoute: vi.fn(), getSheetRoutes: vi.fn() }));
const reinq = vi.hoisted(() => ({
  recordReInquiry: vi.fn(),
  resolveReInquiryContext: vi.fn(),
  notifySupervisorOfReInquiries: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/crm-leads", () => ({ resolveDefaultStatus: vi.fn(async () => ({ id: "status-new" })) }));
vi.mock("@/lib/crm-reinquiry", () => reinq);
vi.mock("@/lib/crm-sheet-routes", async (orig) => ({
  ...(await orig<typeof import("@/lib/crm-sheet-routes")>()),
  applySheetRoute: routes.applySheetRoute,
  getSheetRoutes: routes.getSheetRoutes,
}));

import { ingestSheetLeads } from "@/lib/crm-sheet-ingest";
import type { SheetRoute } from "@/lib/crm-sheet-routes";

const TAB = "GF | Nursing  | Study Abroad | Plus Two | AUG 24";
const RULE: SheetRoute = { source: "meta", campaign: TAB, assigneeUserId: "bde-sa", serviceId: "svc-sa" };

const rows = [
  // A — someone the CRM has never seen.
  { Date: "2026-11-15T09:00:00+0000", Name: "New Person", Phone: 919000000101, Email: "new@x.com" },
  // B — an old dead lead re-enquiring through this tab.
  { Date: "2026-11-13T16:00:00+0000", Name: "Came Back", Phone: 919000000102, Email: "back@x.com" },
  // C — the same enquiry a Voxbay call already created 21 seconds later: not news.
  { Date: "2026-11-14T23:00:00+0000", Name: "Called In", Phone: 919000000103, Email: "called@x.com" },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.leadPulseSource.findUnique.mockResolvedValue({ id: "src-meta" });
  db.crmQualification.findMany.mockResolvedValue([]);
  db.lead.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    if ("externalKey" in args.where) return [];
    if ("importBatchId" in args.where) return [{ id: "lead-new", emailKey: "new@x.com", phoneE164: "+919000000101" }];
    return [
      { id: "lead-old", emailKey: "back@x.com", phoneE164: "+919000000102", altPhoneE164: null, createdAt: new Date("2025-11-16T08:00:00Z"), lastInquiryAt: null },
      { id: "lead-voxbay", emailKey: null, phoneE164: "+919000000103", altPhoneE164: null, createdAt: new Date("2026-11-14T23:00:21Z"), lastInquiryAt: null },
    ];
  });
  db.lead.createMany.mockResolvedValue({ count: 1 });
  db.leadImportBatch.create.mockResolvedValue({ id: "batch-1" });
  db.leadImportBatch.update.mockResolvedValue({});
  db.leadActivity.createMany.mockResolvedValue({ count: 1 });
  reinq.resolveReInquiryContext.mockResolvedValue({});
  reinq.recordReInquiry.mockImplementation(async (ev: { leadId: string }) => ({ leadId: ev.leadId, revived: true, fromStatusCode: "not_eligible" }));
  reinq.notifySupervisorOfReInquiries.mockResolvedValue(undefined);
  routes.applySheetRoute.mockResolvedValue({ assigned: 1, takenOver: 1, leftWithOwner: 0, failed: 0 });
  routes.getSheetRoutes.mockResolvedValue([]);
});

describe("ingestSheetLeads — tab rules", () => {
  it("routes the new lead and the re-enquired lead, not the already-known one", async () => {
    const res = await ingestSheetLeads({ sourceKey: "meta", campaign: TAB, rows, dateFloor: null, routes: [RULE] });
    expect(res).toMatchObject({ inserted: 1, reInquiries: 1, skippedAlreadyKnown: 1 });
    expect(routes.applySheetRoute).toHaveBeenCalledTimes(1);
    // The re-enquired lead carries the stage it had BEFORE the re-enquiry revived it.
    expect(routes.applySheetRoute).toHaveBeenCalledWith(
      RULE,
      [
        { leadId: "lead-new", fromStatusCode: null },
        { leadId: "lead-old", fromStatusCode: "not_eligible" },
      ],
      TAB,
    );
    expect(res.routing).toEqual({ assigned: 1, takenOver: 1, leftWithOwner: 0, failed: 0 });
  });

  it("reads the stored rules when none are passed in", async () => {
    routes.getSheetRoutes.mockResolvedValue([{ ...RULE, campaign: "gf | nursing | study abroad | plus two | aug 24" }]);
    await ingestSheetLeads({ sourceKey: "meta", campaign: TAB, rows, dateFloor: null });
    expect(routes.getSheetRoutes).toHaveBeenCalledTimes(1);
    expect(routes.applySheetRoute).toHaveBeenCalledTimes(1);
  });

  it("leaves other tabs' leads unassigned, as before", async () => {
    const res = await ingestSheetLeads({ sourceKey: "meta", campaign: "GF | EXP GCC NEW MAY 2026", rows, dateFloor: null, routes: [RULE] });
    expect(routes.applySheetRoute).not.toHaveBeenCalled();
    expect(res.routing).toBeUndefined();
  });

  it("does not apply a meta tab's rule to the website sheet", async () => {
    await ingestSheetLeads({ sourceKey: "website", campaign: TAB, rows, dateFloor: null, routes: [RULE] });
    expect(routes.applySheetRoute).not.toHaveBeenCalled();
  });
});
