/**
 * Leads from Voxbay calls: how a new caller's lead is created, and when it is
 * handed to the BDE who answered. Prisma and the CRM's assignment are mocked;
 * the rules in src/lib/voxbay-webhook-ingest.ts run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  lead: { createMany: vi.fn(), findUnique: vi.fn() },
  leadActivity: { create: vi.fn(), count: vi.fn() },
  leadPulseSource: { upsert: vi.fn() },
}));
const assignLeadTo = vi.hoisted(() => vi.fn());
const roster = vi.hoisted(() => [{ userId: "bde1", displayName: "BDE One", username: "bde1", role: "l2" }]);

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/crm-assign", () => ({ assignLeadTo }));
vi.mock("@/lib/crm-leads", () => ({
  getAssignableBdes: vi.fn(async () => roster),
  resolveDefaultStatus: vi.fn(async () => ({ id: "st_new" })),
}));

import { assignVoxbayLead, createVoxbayLead, voxbayLeadExternalKey } from "@/lib/voxbay-webhook-ingest";
import { callRowToCdr, cdrToCallFields, parseVoxbayCdr, storedCallOutcome, voxbayCallActivity } from "@/lib/voxbay-webhook";

beforeEach(() => {
  vi.clearAllMocks();
  db.leadPulseSource.upsert.mockResolvedValue({ id: "src_voxbay" });
  db.lead.findUnique.mockResolvedValue({ id: "lead1" });
  db.lead.createMany.mockResolvedValue({ count: 1 });
  db.leadActivity.count.mockResolvedValue(0);
});

describe("createVoxbayLead", () => {
  it("creates a Voxbay-source lead keyed on the number, named by the caller or else the number", async () => {
    const res = await createVoxbayLead({ phoneE164: "+919000000001", phone: "9000000001", name: null, handledBy: "Missed call" });
    expect(res).toEqual({ id: "lead1", created: true });
    const data = db.lead.createMany.mock.calls[0][0].data[0];
    expect(data).toMatchObject({
      candidateName: "+919000000001",
      phone: "9000000001",
      phoneE164: "+919000000001",
      dedupeKey: "+919000000001",
      externalKey: voxbayLeadExternalKey("+919000000001"),
      statusId: "st_new",
      sourceId: "src_voxbay",
      campaign: "Voxbay call",
      extra: { "Voxbay caller": "9000000001", "Voxbay handled by": "Missed call" },
    });
    expect(db.lead.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(db.leadActivity.create.mock.calls[0][0].data).toMatchObject({ type: "LEAD_CREATED", leadId: "lead1" });

    await createVoxbayLead({ phoneE164: "+919000000001", phone: null, name: "  Sample Caller ", handledBy: "x" });
    expect(db.lead.createMany.mock.calls[1][0].data[0].candidateName).toBe("Sample Caller");
  });

  it("writes no second 'Created' entry when a racing delivery already made the lead", async () => {
    db.lead.createMany.mockResolvedValue({ count: 0 });
    expect(await createVoxbayLead({ phoneE164: "+919000000001", phone: null, name: null, handledBy: "x" })).toEqual({
      id: "lead1",
      created: false,
    });
    expect(db.leadActivity.create).not.toHaveBeenCalled();
  });
});

describe("assignVoxbayLead", () => {
  const voxbayLead = { assignedToId: null, externalKey: "voxbay:+919000000001" };

  it("hands a never-assigned Voxbay lead to the BDE who answered, through the CRM's assignment", async () => {
    db.lead.findUnique.mockResolvedValue(voxbayLead);
    expect(await assignVoxbayLead("lead1", "bde1")).toBe(true);
    expect(assignLeadTo).toHaveBeenCalledWith("lead1", "bde1", "bde1");
  });

  it("leaves alone a lead that's owned, was ever assigned, or didn't come from Voxbay", async () => {
    db.lead.findUnique.mockResolvedValue({ ...voxbayLead, assignedToId: "someone" });
    expect(await assignVoxbayLead("lead1", "bde1")).toBe(false);

    db.lead.findUnique.mockResolvedValue({ ...voxbayLead, externalKey: "wa:+919000000001" });
    expect(await assignVoxbayLead("lead1", "bde1")).toBe(false);

    db.lead.findUnique.mockResolvedValue(voxbayLead);
    db.leadActivity.count.mockResolvedValue(1); // a manager unassigned it once
    expect(await assignVoxbayLead("lead1", "bde1")).toBe(false);
    expect(assignLeadTo).not.toHaveBeenCalled();
  });

  it("assigns only to an active BDE, and never throws", async () => {
    db.lead.findUnique.mockResolvedValue(voxbayLead);
    expect(await assignVoxbayLead("lead1", "not_a_bde")).toBe(false);
    assignLeadTo.mockRejectedValue(new Error("boom"));
    expect(await assignVoxbayLead("lead1", "bde1")).toBe(false);
  });
});

describe("callRowToCdr", () => {
  it("gives a stored call the same Timeline entry as the live delivery did", () => {
    const parsed = parseVoxbayCdr(
      {
        call_id: "c1",
        direction: "incoming",
        phone: "9000000001",
        call_status: "ANSWERED",
        conversation_duration: "65",
        agent_name: "Agent One",
        recording_url: "https://rec.example.com/c1.mp3",
        call_start_time: "2026-11-09T10:00:00+05:30",
      },
      "cdr.incoming",
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const f = cdrToCallFields(parsed.cdr);
    const row = {
      id: "row1",
      voxbayCallId: f.voxbayCallId,
      direction: f.direction,
      sourceNumber: f.sourceNumber,
      contactName: f.contactName,
      callStatus: f.callStatus,
      didNumber: f.didNumber,
      totalDurationSec: f.totalDurationSec,
      answeredDurationSec: f.answeredDurationSec,
      callRecordFile: f.callRecordFile,
      callStartTime: f.callStartTime,
      callConnectedTime: f.callConnectedTime,
      callEndTime: f.callEndTime,
      agentName: f.agentName,
      agentEmail: f.agentEmail,
      extNumber: f.extNumber,
      agentPhone: f.agentPhone,
      deptName: f.deptName,
      userStatus: f.userStatus,
    };
    expect(voxbayCallActivity(callRowToCdr(row), null, storedCallOutcome(row))).toEqual(voxbayCallActivity(parsed.cdr, null));
    expect(voxbayCallActivity(parsed.cdr, "bde1").summary).toBe("Incoming Voxbay call · Answered · 1m 5s");

    // A report row: call_status ANSWERED (the IVR picked up), but Voxbay's own
    // user_status says nobody did — that verdict wins.
    const reportRow = { ...row, answeredDurationSec: 0, userStatus: "FAILED" };
    expect(storedCallOutcome(reportRow)).toBe("failed");
    expect(storedCallOutcome({ ...reportRow, userStatus: "NOANSWER" })).toBe("missed");
    expect(storedCallOutcome({ ...reportRow, userStatus: null })).toBe("answered");
  });
});
