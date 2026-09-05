import { describe, it, expect } from "vitest";
import {
  buildFunnel,
  reachedPositionsByApplication,
  timeToHire,
  timeInStage,
  offerOutcomes,
  reportToCsv,
  type AnalyticsEvent,
  type StageKey,
} from "@/lib/hiring/analytics";

const STAGES: StageKey[] = [
  { position: 0, kind: "open", label: "Applied" },
  { position: 1, kind: "open", label: "Screening" },
  { position: 2, kind: "open", label: "Interview" },
  { position: 3, kind: "won", label: "Hired" },
  { position: 4, kind: "lost", label: "Rejected" },
];

function ev(
  applicationId: string,
  type: string,
  toStage: string | null,
  day: number,
  fromStage: string | null = null,
): AnalyticsEvent {
  return {
    applicationId,
    type,
    fromStage,
    toStage,
    occurredAt: new Date(`2026-09-${String(day).padStart(2, "0")}T00:00:00Z`),
  };
}

describe("the funnel is counted from events, not from where people are now", () => {
  const events = [
    // A: applied → screening → interview → hired
    ev("A", "created", "Applied", 1),
    ev("A", "stage_moved", "Screening", 2, "Applied"),
    ev("A", "stage_moved", "Interview", 3, "Screening"),
    ev("A", "stage_moved", "Hired", 5, "Interview"),
    // B: applied → screening → rejected
    ev("B", "created", "Applied", 1),
    ev("B", "stage_moved", "Screening", 2, "Applied"),
    ev("B", "rejected", "Rejected", 4, "Screening"),
    // C: applied only
    ev("C", "created", "Applied", 1),
  ];

  it("counts everyone who EVER reached a stage, including those since rejected", () => {
    const funnel = buildFunnel(events, STAGES);
    expect(funnel.map((f) => [f.label, f.reached])).toEqual([
      ["Applied", 3],
      ["Screening", 2],
      ["Interview", 1],
    ]);
  });

  it("reports conversion from each step to the next", () => {
    const funnel = buildFunnel(events, STAGES);
    // 2 of 3 reached Screening; 1 of 2 reached Interview.
    expect(funnel[0]!.conversionPct).toBe(67);
    expect(funnel[1]!.conversionPct).toBe(50);
  });

  it("excludes won, lost and hold stages from the funnel steps", () => {
    expect(buildFunnel(events, STAGES).map((f) => f.label)).not.toContain("Hired");
    expect(buildFunnel(events, STAGES).map((f) => f.label)).not.toContain("Rejected");
  });

  it("counts an application that arrived and was never touched", () => {
    // The most common real case, and the one a state-based count loses.
    const funnel = buildFunnel([ev("Z", "created", "Applied", 1)], STAGES);
    expect(funnel[0]!.reached).toBe(1);
  });

  it("treats a `created` event with no stage as the top of the funnel", () => {
    const funnel = buildFunnel([ev("Z", "created", null, 1)], STAGES);
    expect(funnel[0]!.reached).toBe(1);
  });

  it("does not double-count an application that re-entered a stage", () => {
    const repeat = [
      ev("A", "created", "Applied", 1),
      ev("A", "stage_moved", "Screening", 2),
      ev("A", "stage_moved", "Applied", 3),
      ev("A", "stage_moved", "Screening", 4),
    ];
    expect(buildFunnel(repeat, STAGES)[1]!.reached).toBe(1);
  });

  it("ignores events that are not stage movements", () => {
    const noise = [
      ev("A", "created", "Applied", 1),
      ev("A", "note", null, 2),
      ev("A", "email_sent", null, 2),
      ev("A", "scored", null, 2),
    ];
    expect(buildFunnel(noise, STAGES)[0]!.reached).toBe(1);
    expect(buildFunnel(noise, STAGES)[1]!.reached).toBe(0);
  });

  it("says nothing rather than 0% when nobody reached a step", () => {
    expect(buildFunnel([ev("A", "created", "Applied", 1)], STAGES)[1]!.conversionPct).toBeNull();
  });

  it("matches stage names case-insensitively, since they are per-job strings", () => {
    const reached = reachedPositionsByApplication(
      [ev("A", "stage_moved", "  screening ", 2)],
      new Map(STAGES.map((s) => [s.label.toLowerCase(), s])),
    );
    expect(reached.get("A")!.has(1)).toBe(true);
  });

  it("is empty for an empty range rather than throwing", () => {
    expect(buildFunnel([], STAGES).every((f) => f.reached === 0)).toBe(true);
  });
});

describe("time to hire", () => {
  const won = new Set(["Hired"]);

  it("measures from the application arriving to the hire", () => {
    const events = [ev("A", "created", "Applied", 1), ev("A", "stage_moved", "Hired", 11)];
    expect(timeToHire(events, won)).toEqual({ count: 1, medianDays: 10, averageDays: 10 });
  });

  it("takes the median as well as the mean, because one slow hire skews a mean", () => {
    const events = [
      ev("A", "created", "Applied", 1), ev("A", "stage_moved", "Hired", 3),
      ev("B", "created", "Applied", 1), ev("B", "stage_moved", "Hired", 5),
      ev("C", "created", "Applied", 1), ev("C", "stage_moved", "Hired", 25),
    ];
    const result = timeToHire(events, won);
    expect(result.medianDays).toBe(4);
    expect(result.averageDays).toBe(10);
  });

  it("ignores an application that was never hired", () => {
    expect(timeToHire([ev("A", "created", "Applied", 1)], won).count).toBe(0);
  });

  it("respects a job that renamed its won stage", () => {
    const events = [ev("A", "created", "Applied", 1), ev("A", "stage_moved", "Joined", 6)];
    expect(timeToHire(events, new Set(["Joined"])).count).toBe(1);
  });

  it("is null, not zero, when nobody has been hired", () => {
    expect(timeToHire([], won)).toEqual({ count: 0, medianDays: null, averageDays: null });
  });
});

describe("time in stage", () => {
  it("measures each stage from entering it to leaving it", () => {
    const events = [
      ev("A", "created", "Applied", 1),
      ev("A", "stage_moved", "Screening", 4),
      ev("A", "stage_moved", "Interview", 6),
    ];
    const dwell = timeInStage(events);
    expect(dwell.find((d) => d.label === "Applied")!.averageDays).toBe(3);
    expect(dwell.find((d) => d.label === "Screening")!.averageDays).toBe(2);
  });

  it("does not count the stage somebody is still sitting in", () => {
    // Interview has no exit event, so it contributes nothing rather than a
    // number that grows every time the page is refreshed.
    const events = [ev("A", "created", "Applied", 1), ev("A", "stage_moved", "Interview", 4)];
    expect(timeInStage(events).find((d) => d.label === "Interview")).toBeUndefined();
  });

  it("orders the slowest stage first — that is the one worth fixing", () => {
    const events = [
      ev("A", "created", "Applied", 1),
      ev("A", "stage_moved", "Screening", 2),
      ev("A", "stage_moved", "Interview", 12),
    ];
    expect(timeInStage(events)[0]!.label).toBe("Screening");
  });
});

describe("offer outcomes", () => {
  it("reports the accept rate over offers sent", () => {
    const events = [
      ev("A", "offer_sent", null, 1), ev("A", "offer_signed", null, 3),
      ev("B", "offer_sent", null, 1),
    ];
    expect(offerOutcomes(events)).toEqual({ sent: 2, signed: 1, acceptRatePct: 50 });
  });

  it("cannot exceed 100% when a signature lands from an earlier window", () => {
    const events = [ev("A", "offer_signed", null, 3), ev("B", "offer_sent", null, 1)];
    const result = offerOutcomes(events);
    expect(result.acceptRatePct).toBe(0);
  });

  it("is null rather than 0% with no offers out", () => {
    expect(offerOutcomes([]).acceptRatePct).toBeNull();
  });
});

describe("report CSV", () => {
  it("writes headers and rows", () => {
    expect(reportToCsv(["Source", "Applications"], [["Careers page", 12]])).toBe(
      "Source,Applications\r\nCareers page,12",
    );
  });

  it("defuses a formula and quotes a comma", () => {
    const csv = reportToCsv(["A"], [["=1+1"], ["a,b"]]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain('"a,b"');
  });

  it("writes an empty cell for null rather than the word null", () => {
    expect(reportToCsv(["A"], [[null]])).toBe("A\r\n");
  });
});
