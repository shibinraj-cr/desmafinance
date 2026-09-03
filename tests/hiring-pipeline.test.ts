import { describe, it, expect } from "vitest";
import { statusForStageKind, isSlaBreached, daysInStage } from "@/lib/hiring/pipeline";
import { buildBoardColumns, groupCardsByPosition, stageForJobAtPosition } from "@/lib/hiring/board";
import type { ApplicationRowDTO } from "@/lib/hiring/candidates";

describe("status follows the stage it is in", () => {
  it("maps each stage kind to the status it implies", () => {
    expect(statusForStageKind("won", "active")).toBe("hired");
    expect(statusForStageKind("lost", "active")).toBe("rejected");
    expect(statusForStageKind("hold", "active")).toBe("on_hold");
    expect(statusForStageKind("open", "active")).toBe("active");
  });

  it("reactivates a rejected application dragged back into the pipeline", () => {
    expect(statusForStageKind("open", "rejected")).toBe("active");
    expect(statusForStageKind("open", "on_hold")).toBe("active");
  });

  it("leaves a withdrawal alone — that was the candidate's decision, not ours", () => {
    expect(statusForStageKind("open", "withdrawn")).toBe("withdrawn");
  });
});

describe("stage SLA", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  const enteredDaysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it("breaches once past the stage's allowance", () => {
    const stage = { slaDays: 3, kind: "open" };
    expect(isSlaBreached({ stageEnteredAt: enteredDaysAgo(3), status: "active" }, stage, now)).toBe(false);
    expect(isSlaBreached({ stageEnteredAt: enteredDaysAgo(4), status: "active" }, stage, now)).toBe(true);
  });

  it("never breaches on a stage with no SLA", () => {
    expect(
      isSlaBreached({ stageEnteredAt: enteredDaysAgo(90), status: "active" }, { slaDays: null, kind: "open" }, now),
    ).toBe(false);
  });

  it("never breaches on a terminal stage — nobody is waiting on a rejection", () => {
    for (const kind of ["won", "lost", "hold"]) {
      expect(
        isSlaBreached({ stageEnteredAt: enteredDaysAgo(90), status: "active" }, { slaDays: 1, kind }, now),
      ).toBe(false);
    }
  });

  it("never breaches for an application that is not active", () => {
    expect(
      isSlaBreached({ stageEnteredAt: enteredDaysAgo(90), status: "rejected" }, { slaDays: 1, kind: "open" }, now),
    ).toBe(false);
  });

  it("counts whole days in stage, never negative", () => {
    expect(daysInStage({ stageEnteredAt: enteredDaysAgo(2) }, now)).toBe(2);
    expect(daysInStage({ stageEnteredAt: new Date(now.getTime() + 86_400_000) }, now)).toBe(0);
  });
});

describe("cross-requisition board columns", () => {
  const stages = [
    { id: "a0", jobId: "A", name: "Applied", kind: "open", position: 0 },
    { id: "a1", jobId: "A", name: "Screening", kind: "open", position: 1 },
    { id: "a2", jobId: "A", name: "Hired", kind: "won", position: 2 },
    { id: "b0", jobId: "B", name: "Applied", kind: "open", position: 0 },
    { id: "b1", jobId: "B", name: "Phone screen", kind: "open", position: 1 },
    { id: "b2", jobId: "B", name: "Hired", kind: "won", position: 2 },
  ];

  it("keys columns on position, not on stage id or name", () => {
    const columns = buildBoardColumns(stages);
    expect(columns.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(columns[0]!.stageIds.sort()).toEqual(["a0", "b0"]);
  });

  it("labels a column with the name most jobs use at that position", () => {
    const columns = buildBoardColumns([
      ...stages,
      { id: "c1", jobId: "C", name: "Screening", kind: "open", position: 1 },
    ]);
    expect(columns[1]!.label).toBe("Screening");
  });

  it("breaks a label tie alphabetically so the board is stable between reads", () => {
    // "Phone screen" vs "Screening", one each.
    expect(buildBoardColumns(stages)[1]!.label).toBe("Phone screen");
  });

  it("resolves a board position to THIS job's own stage", () => {
    expect(stageForJobAtPosition(stages, "B", 1)?.id).toBe("b1");
    expect(stageForJobAtPosition(stages, "A", 1)?.id).toBe("a1");
  });

  it("returns null when a job has no stage at that position", () => {
    expect(stageForJobAtPosition(stages, "A", 9)).toBeNull();
  });
});

describe("board card placement", () => {
  const columns = buildBoardColumns([
    { id: "a0", jobId: "A", name: "Applied", kind: "open", position: 0 },
    { id: "a1", jobId: "A", name: "Interview", kind: "open", position: 1 },
  ]);
  const card = (id: string, stagePosition: number | null) =>
    ({ id, stagePosition } as ApplicationRowDTO);

  it("buckets cards by their stage position", () => {
    const grouped = groupCardsByPosition([card("x", 0), card("y", 1), card("z", 0)], columns);
    expect(grouped.get(0)!.map((c) => c.id)).toEqual(["x", "z"]);
    expect(grouped.get(1)!.map((c) => c.id)).toEqual(["y"]);
  });

  it("keeps every column present even when empty", () => {
    const grouped = groupCardsByPosition([], columns);
    expect([...grouped.keys()]).toEqual([0, 1]);
  });

  it("puts a card from a longer pipeline in the last column rather than losing it", () => {
    const grouped = groupCardsByPosition([card("deep", 7)], columns);
    expect(grouped.get(1)!.map((c) => c.id)).toEqual(["deep"]);
  });

  it("skips a card with no stage at all", () => {
    const grouped = groupCardsByPosition([card("orphan", null)], columns);
    expect([...grouped.values()].flat()).toHaveLength(0);
  });
});
