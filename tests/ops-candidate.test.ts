/**
 * Candidate-detail edits from an Operations project.
 *
 * The documentation team corrects a candidate's name / contact / profile on the
 * project page, and the fix has to land on the Finance Party AND every CRM lead
 * of that candidate, with history on both sides. These tests pin what protects
 * data: only changed fields are written, a rename can never merge two
 * candidates, the "Others" qualification rule holds, and every change is logged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    opsProject: { findUnique: vi.fn() },
    party: { findUnique: vi.fn() },
    crmQualification: { findUnique: vi.fn(), findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/ops-activity", () => ({ recordOpsActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import { prisma } from "@/lib/prisma";
import { recordLeadActivity } from "@/lib/crm-activity";
import { recordOpsActivity } from "@/lib/ops-activity";
import { recordAudit } from "@/lib/audit";
import { normalizeCandidatePatch, planLeadUpdate, updateCandidateFromOps } from "@/lib/ops-candidate";

const fn = (f: unknown) => f as unknown as ReturnType<typeof vi.fn>;

const QUALS = new Map([
  ["q-bsn", "BSN"],
  ["q-other", "Others"],
]);

function lead(over: Partial<Parameters<typeof planLeadUpdate>[0]> = {}) {
  return {
    id: "lead-1",
    candidateName: "Anu Mathew",
    email: "anu@example.com",
    phone: "9876543210",
    altPhone: null,
    dob: new Date("1998-04-02T00:00:00.000Z"),
    country: "India",
    qualificationId: "q-bsn",
    qualificationOther: null,
    pipelineId: "pipe-1",
    ...over,
  };
}

describe("normalizeCandidatePatch", () => {
  it("trims values, turns blanks into null and drops untouched fields", () => {
    expect(normalizeCandidatePatch({ candidateName: "  Anu M  ", email: "", country: undefined, phone: null })).toEqual({
      candidateName: "Anu M",
      email: null,
      phone: null,
    });
  });
});

describe("planLeadUpdate", () => {
  it("writes only the fields that differ", () => {
    const { data, diff } = planLeadUpdate(lead(), { candidateName: "Anu Mathew", country: "Australia" }, QUALS);
    expect(data).toEqual({ country: "Australia" });
    expect(diff).toEqual({ country: { from: "India", to: "Australia" } });
  });

  it("re-derives the dedupe keys when email or phone changes", () => {
    const { data } = planLeadUpdate(lead(), { phone: "9123456780" }, QUALS);
    expect(data).toMatchObject({
      phone: "9123456780",
      phoneE164: "+919123456780",
      emailKey: "anu@example.com",
      dedupeKey: "anu@example.com",
    });
  });

  it("normalises a new alternative number", () => {
    const { data } = planLeadUpdate(lead(), { altPhone: "9000000001" }, QUALS);
    expect(data).toMatchObject({ altPhone: "9000000001", altPhoneE164: "+919000000001" });
  });

  it("compares DOB as a date and stores a date-only value", () => {
    expect(planLeadUpdate(lead(), { dob: "1998-04-02" }, QUALS).diff).toEqual({});
    const { data, diff } = planLeadUpdate(lead(), { dob: "1998-02-04" }, QUALS);
    expect((data.dob as Date).toISOString()).toBe("1998-02-04T00:00:00.000Z");
    expect(diff.dob).toEqual({ from: "1998-04-02", to: "1998-02-04" });
  });

  it("keeps the free-text detail only while the qualification is Others", () => {
    const toOther = planLeadUpdate(lead(), { qualificationId: "q-other", qualificationOther: "MBA" }, QUALS);
    expect(toOther.data).toEqual({ qualificationId: "q-other", qualificationOther: "MBA" });
    expect(toOther.diff.qualification).toEqual({ from: "BSN", to: "Others (MBA)" });

    const offOther = planLeadUpdate(
      lead({ qualificationId: "q-other", qualificationOther: "MBA" }),
      { qualificationId: "q-bsn" },
      QUALS,
    );
    expect(offOther.data).toEqual({ qualificationId: "q-bsn", qualificationOther: null });
  });
});

describe("updateCandidateFromOps", () => {
  let tx: {
    party: { update: ReturnType<typeof vi.fn> };
    lead: { update: ReturnType<typeof vi.fn> };
    leadPulsePipeline: { updateMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tx = { party: { update: vi.fn() }, lead: { update: vi.fn() }, leadPulsePipeline: { updateMany: vi.fn() } };
    fn(prisma.$transaction).mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    fn(prisma.opsProject.findUnique).mockResolvedValue({
      id: "proj-1",
      leadId: "lead-1",
      party: { id: "party-1", name: "Anu Mathew", group: "Candidate", email: "anu@example.com", phone: "9876543210" },
    });
    fn(prisma.party.findUnique).mockResolvedValue(null);
    fn(prisma.crmQualification.findMany).mockResolvedValue([...QUALS].map(([id, label]) => ({ id, label })));
    // The project's lead plus a re-enrollment lead with a different DOB.
    fn(prisma.lead.findMany).mockResolvedValue([
      lead(),
      lead({ id: "lead-2", dob: new Date("1998-04-20T00:00:00.000Z"), pipelineId: "pipe-2" }),
    ]);
  });

  it("refuses a rename onto another candidate's name instead of merging", async () => {
    fn(prisma.party.findUnique).mockResolvedValue({ id: "party-other" });
    await expect(
      updateCandidateFromOps({ projectId: "proj-1", actorId: "u-ops", patch: { candidateName: "Anu M" } }),
    ).rejects.toMatchObject({ status: 409, code: "name_taken" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("renames the Party, every CRM lead and the pipeline rows — and leaves other fields alone", async () => {
    const res = await updateCandidateFromOps({
      projectId: "proj-1",
      actorId: "u-ops",
      patch: { candidateName: "Anu Mary Mathew" },
    });

    expect(tx.party.update).toHaveBeenCalledWith({ where: { id: "party-1" }, data: { name: "Anu Mary Mathew" } });
    expect(tx.lead.update).toHaveBeenCalledTimes(2);
    for (const call of tx.lead.update.mock.calls) expect(call[0].data).toEqual({ candidateName: "Anu Mary Mathew" });
    expect(tx.leadPulsePipeline.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ partyId: "party-1" }, { id: { in: ["pipe-1", "pipe-2"] } }] },
      data: { candidateName: "Anu Mary Mathew" },
    });
    expect(res).toMatchObject({ partyUpdated: true, leadsUpdated: 2 });
    expect(res.changes).toEqual([{ field: "candidateName", label: "Name", from: "Anu Mathew", to: "Anu Mary Mathew" }]);
  });

  it("records the change on the project, on each lead and in the Party audit", async () => {
    await updateCandidateFromOps({ projectId: "proj-1", actorId: "u-ops", patch: { candidateName: "Anu Mary Mathew" } });

    expect(recordOpsActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        actorId: "u-ops",
        type: "CANDIDATE_UPDATED",
        summary: "Candidate details updated: Name",
        metadata: expect.objectContaining({
          changes: [{ field: "candidateName", label: "Name", from: "Anu Mathew", to: "Anu Mary Mathew" }],
        }),
      }),
    );
    expect(recordLeadActivity).toHaveBeenCalledTimes(2);
    expect(recordLeadActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: "lead-2",
        actorId: "u-ops",
        type: "FIELD_UPDATED",
        summary: "Updated Name (from Operations)",
        metadata: expect.objectContaining({ via: "operations", opsProjectId: "proj-1" }),
        bumpLastActivity: false,
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Party", entityId: "party-1", action: "UPDATE", userId: "u-ops" }),
    );
  });

  it("writes a lead-only field to the leads that differ, without touching the Party", async () => {
    const res = await updateCandidateFromOps({ projectId: "proj-1", actorId: "u-ops", patch: { dob: "1998-04-20" } });

    expect(tx.party.update).not.toHaveBeenCalled();
    expect(tx.leadPulsePipeline.updateMany).not.toHaveBeenCalled();
    // lead-2 already has 20 Apr, so only the project's lead is written.
    expect(tx.lead.update).toHaveBeenCalledTimes(1);
    expect(tx.lead.update.mock.calls[0][0].where).toEqual({ id: "lead-1" });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(res.leadsUpdated).toBe(1);
  });

  it("does nothing when nothing actually changed", async () => {
    const res = await updateCandidateFromOps({
      projectId: "proj-1",
      actorId: "u-ops",
      patch: { candidateName: "Anu Mathew", country: "India" },
    });
    expect(res).toEqual({ changes: [], partyUpdated: false, leadsUpdated: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(recordOpsActivity).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    await expect(
      updateCandidateFromOps({ projectId: "proj-1", actorId: "u-ops", patch: { candidateName: "  " } }),
    ).rejects.toMatchObject({ status: 400, code: "name_required" });
  });
});
