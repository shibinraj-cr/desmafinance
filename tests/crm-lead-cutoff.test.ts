import { describe, it, expect } from "vitest";
import {
  cutoffPhase,
  cutoffSummaryNotification,
  dueLabel,
  handoverAssignedNotification,
  handoverDuplicateNotification,
  handoverRejectedNotification,
  reminderNotification,
} from "@/lib/crm-lead-cutoff";

// 2026-11-16 is a Monday.
const ist = (dateTime: string) => new Date(`${dateTime.replace(" ", "T")}:00+05:30`);
const cutoff = ist("2026-11-16 17:00");

describe("cutoffPhase", () => {
  it("reminds in the hour before the cutoff, and summarises from it", () => {
    expect(cutoffPhase(cutoff, ist("2026-11-16 15:59"))).toEqual({ reminder: false, summary: false });
    expect(cutoffPhase(cutoff, ist("2026-11-16 16:00"))).toEqual({ reminder: true, summary: false });
    expect(cutoffPhase(cutoff, ist("2026-11-16 16:59"))).toEqual({ reminder: true, summary: false });
    expect(cutoffPhase(cutoff, ist("2026-11-16 17:00"))).toEqual({ reminder: false, summary: true });
    expect(cutoffPhase(cutoff, ist("2026-11-16 22:59"))).toEqual({ reminder: false, summary: true });
    expect(cutoffPhase(cutoff, ist("2026-11-16 23:00"))).toEqual({ reminder: false, summary: false });
  });

  it("does nothing on a day without a cutoff", () => {
    expect(cutoffPhase(null, ist("2026-11-15 16:30"))).toEqual({ reminder: false, summary: false });
  });
});

describe("wording", () => {
  it("names a deadline today or on its day", () => {
    expect(dueLabel(cutoff, ist("2026-11-16 10:00"))).toBe("5:00 pm today");
    expect(dueLabel(ist("2026-11-14 15:30"), ist("2026-11-13 18:00"))).toMatch(/^3:30 pm Sat,? 14 Nov$/);
  });

  it("reminder", () => {
    expect(reminderNotification(2, 1, cutoff)).toEqual({
      title: "Contact before 5:00 pm",
      body: "2 leads and 1 handover still waiting on you today. Anything not done by the cutoff counts as missed.",
    });
    expect(reminderNotification(1, 0, cutoff).body.startsWith("1 lead still")).toBe(true);
  });

  it("cutoff summary lists BDEs with something to report, worst first", () => {
    expect(
      cutoffSummaryNotification(
        [
          { name: "BDE A", missed: 1, overdue: 0 },
          { name: "BDE B", missed: 2, overdue: 1 },
          { name: "BDE C", missed: 0, overdue: 0 },
        ],
        cutoff,
      ),
    ).toEqual({
      title: "5:00 pm cutoff: 3 missed leads, 1 overdue handover",
      body: "BDE B — 2 missed, 1 handover overdue\nBDE A — 1 missed",
    });
  });

  it("handover assigned: one, or a list", () => {
    const now = ist("2026-11-16 10:00");
    expect(handoverAssignedNotification([{ leadName: "Asha", phone: "+919876543210" }], "Walk-in", cutoff, now)).toEqual({
      title: "New handover: Asha (+919876543210)",
      body: "Walk-in. Create the lead in the CRM by 5:00 pm today.",
    });
    const many = handoverAssignedNotification(
      [
        { leadName: null, phone: "+919000000001" },
        { leadName: "Binu", phone: "+919000000002" },
      ],
      "YouTube",
      cutoff,
      now,
    );
    expect(many.title).toBe("2 new handovers (YouTube)");
    expect(many.body).toBe("Create them in the CRM by 5:00 pm today:\n+919000000001\nBinu (+919000000002)");
  });

  it("duplicate says who it was handed to and who owns the lead", () => {
    expect(
      handoverDuplicateNotification([{ leadName: "Asha", phone: "+919876543210", bdeName: "BDE A", ownerName: "BDE B" }]),
    ).toEqual({
      title: "Handover is already a lead",
      body: "Asha (+919876543210) — handed to BDE A; already a lead, owned by BDE B",
    });
    expect(
      handoverDuplicateNotification([{ leadName: null, phone: "+919000000001", bdeName: "BDE A", ownerName: null }]).body,
    ).toBe("+919000000001 — handed to BDE A; already a lead, unassigned");
  });

  it("rejection carries the reason and note", () => {
    expect(
      handoverRejectedNotification({ leadName: "Asha", phone: "98765 43210", bdeName: "BDE A", reasonLabel: "Invalid number", note: "switched off" }),
    ).toEqual({ title: "Handover rejected: Asha", body: "BDE A — Invalid number · 98765 43210 · switched off" });
  });
});
