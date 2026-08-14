/**
 * CRM is the source of truth for a deal; the Marketing (Lead Pulse) pipeline row
 * is a mirror of it. These tests pin both halves of that contract:
 *   - forward: a CRM lead's status change moves its pipeline row
 *   - reverse: Marketing refuses to edit / delete / re-status a CRM-owned row
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(),
}));

vi.mock("@/lib/lead-pulse-rbac", () => ({
  getLeadPulseAccess: vi.fn(async () => ({ canSupervise: true })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    leadPulsePipeline: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    leadPulseAuditLog: { create: vi.fn() },
  },
}));

import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { syncPipelineToLeadStatus } from "@/lib/crm-enroll";
import { PATCH as editPipeline, DELETE as deletePipeline } from "@/app/api/marketing/lead-pulse/pipeline/[id]/route";
import { PATCH as statusPipeline } from "@/app/api/marketing/lead-pulse/pipeline/[id]/status/route";

const getPerms = getCurrentUserAndPermissions as unknown as ReturnType<typeof vi.fn>;
const leadFindUnique = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const pipeFindUnique = prisma.leadPulsePipeline.findUnique as unknown as ReturnType<typeof vi.fn>;
const pipeUpdate = prisma.leadPulsePipeline.update as unknown as ReturnType<typeof vi.fn>;
const pipeDelete = prisma.leadPulsePipeline.delete as unknown as ReturnType<typeof vi.fn>;

const CRM_OWNED_ROW = {
  id: "pipe1",
  userId: "u1",
  status: "open",
  sourceId: "s1",
  serviceId: "svc1",
  notes: null,
  dailyCloseId: null,
  leadLink: { id: "lead1" },
};

const STANDALONE_ROW = { ...CRM_OWNED_ROW, leadLink: null };

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getPerms.mockResolvedValue({ userId: "u1", perms: {} });
});

describe("forward: CRM lead status → marketing pipeline", () => {
  it("drops a lost lead's open deal out of the forecast", async () => {
    leadFindUnique.mockResolvedValue({ pipeline: { id: "pipe1", status: "open" } });

    await syncPipelineToLeadStatus({ leadId: "lead1", toCode: "not_interested" });

    expect(pipeUpdate).toHaveBeenCalledTimes(1);
    const arg = pipeUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "pipe1" });
    expect(arg.data.status).toBe("lost");
    expect(arg.data.closedDate).toBeInstanceOf(Date);
  });

  it("puts a revived lead's deal back in the forecast", async () => {
    leadFindUnique.mockResolvedValue({ pipeline: { id: "pipe1", status: "lost" } });

    await syncPipelineToLeadStatus({ leadId: "lead1", toCode: "follow_up" });

    expect(pipeUpdate).toHaveBeenCalledWith({
      where: { id: "pipe1" },
      data: { status: "open", closedDate: null },
    });
  });

  it("never un-wins an enrolled deal via a status edit", async () => {
    leadFindUnique.mockResolvedValue({ pipeline: { id: "pipe1", status: "closed_won" } });

    await syncPipelineToLeadStatus({ leadId: "lead1", toCode: "not_interested" });

    expect(pipeUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op for a lead with no deal", async () => {
    leadFindUnique.mockResolvedValue({ pipeline: null });

    await syncPipelineToLeadStatus({ leadId: "lead1", toCode: "not_interested" });

    expect(pipeUpdate).not.toHaveBeenCalled();
  });

  it("swallows mirror failures so the lead's own status change stands", async () => {
    leadFindUnique.mockResolvedValue({ pipeline: { id: "pipe1", status: "open" } });
    pipeUpdate.mockRejectedValue(new Error("db down"));

    await expect(syncPipelineToLeadStatus({ leadId: "lead1", toCode: "not_interested" })).resolves.toBeUndefined();
  });
});

describe("reverse: marketing refuses to write a CRM-owned deal", () => {
  it("blocks editing and leaves the row untouched", async () => {
    pipeFindUnique.mockResolvedValue(CRM_OWNED_ROW);

    const res = await editPipeline(req({ expectedCloseDate: "2026-09-30" }), { params: { id: "pipe1" } });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "crm_owned", leadId: "lead1" });
    expect(pipeUpdate).not.toHaveBeenCalled();
  });

  it("blocks deleting, so a lead's deal is never stranded", async () => {
    pipeFindUnique.mockResolvedValue(CRM_OWNED_ROW);

    const res = await deletePipeline(req({}), { params: { id: "pipe1" } });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "crm_owned", leadId: "lead1" });
    expect(pipeDelete).not.toHaveBeenCalled();
  });

  it("blocks winning a deal here — enrollment must happen on the lead", async () => {
    pipeFindUnique.mockResolvedValue(CRM_OWNED_ROW);

    const res = await statusPipeline(req({ status: "closed_won", closedDate: "2026-08-14" }), {
      params: { id: "pipe1" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "crm_owned", leadId: "lead1" });
    expect(pipeUpdate).not.toHaveBeenCalled();
  });

  it("still allows editing a standalone row entered in Marketing", async () => {
    pipeFindUnique.mockResolvedValue(STANDALONE_ROW);
    pipeUpdate.mockResolvedValue({ id: "pipe1" });

    const res = await editPipeline(req({ expectedCloseDate: "2026-09-30" }), { params: { id: "pipe1" } });

    expect(res.status).toBe(200);
    expect(pipeUpdate).toHaveBeenCalledTimes(1);
  });
});
