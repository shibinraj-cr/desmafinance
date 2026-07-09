import { describe, it, expect, vi } from "vitest";
import {
  buildSnapshotTasks,
  createProjectForEnrollment,
  rollForwardDueDates,
  recomputeSchedule,
  type SnapshotStep,
  type ScheduleTask,
} from "@/lib/ops-projects";
import { addBusinessDays } from "@/lib/ops-dates";

const STEPS: SnapshotStep[] = [
  { id: "s1", seq: 1, name: "Collect documents", description: "checklist", phase: "Initial", isRequired: true, slaDays: 5 },
  { id: "s2", seq: 2, name: "Create AHPRA account", description: null, phase: "Mid", isRequired: false, slaDays: null },
];

describe("buildSnapshotTasks", () => {
  it("snapshots each step's fields onto the task", () => {
    const tasks = buildSnapshotTasks(STEPS, "2026-06-22", new Set());
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      templateStepId: "s1",
      seq: 1,
      name: "Collect documents",
      description: "checklist",
      phase: "Initial",
      isRequired: true,
      slaDays: 5,
    });
  });

  it("computes a business-day due date from slaDays", () => {
    const tasks = buildSnapshotTasks(STEPS, "2026-06-22", new Set());
    // Mon 22 + 5 business days = Sat 27 (Mon–Sat week).
    expect(tasks[0].dueAt?.toISOString().slice(0, 10)).toBe("2026-06-27");
  });

  it("leaves dueAt null when the step has no SLA", () => {
    const tasks = buildSnapshotTasks(STEPS, "2026-06-22", new Set());
    expect(tasks[1].dueAt).toBeNull();
  });

  it("chains consecutive turnarounds (each step from the previous one's date)", () => {
    // Two 1-day steps from Mon 22 → Tue 23 then Wed 24 (NOT both Tue 23).
    const steps: SnapshotStep[] = [
      { id: "a", seq: 1, name: "A", description: null, phase: null, isRequired: true, slaDays: 1 },
      { id: "b", seq: 2, name: "B", description: null, phase: null, isRequired: true, slaDays: 1 },
    ];
    const tasks = buildSnapshotTasks(steps, "2026-06-22", new Set());
    expect(tasks[0].dueAt?.toISOString().slice(0, 10)).toBe("2026-06-23");
    expect(tasks[1].dueAt?.toISOString().slice(0, 10)).toBe("2026-06-24");
  });

  it("is a copy — later mutation of the source step does not change the snapshot", () => {
    const steps: SnapshotStep[] = [{ ...STEPS[0] }];
    const tasks = buildSnapshotTasks(steps, "2026-06-22", new Set());
    steps[0].name = "MUTATED";
    expect(tasks[0].name).toBe("Collect documents");
  });
});

// Fake transaction client exercising only the OpsProject methods the hook uses.
type ProjectCreateArgs = {
  data: {
    templateId: string;
    partyServiceId: string;
    tasks: { create: Array<Record<string, unknown>> };
  };
};

function fakeTx(existing: { id: string } | null) {
  let captured: ProjectCreateArgs | null = null;
  const create = vi.fn(async (args: ProjectCreateArgs) => {
    captured = args;
    return { id: "proj-new" };
  });
  const findUnique = vi.fn(async () => existing);
  const tx = { opsProject: { findUnique, create } } as unknown as Parameters<typeof createProjectForEnrollment>[0];
  return { tx, create, findUnique, captured: () => captured };
}

const TEMPLATE = { id: "tmpl-1", steps: STEPS };
const baseArgs = {
  partyServiceId: "ps-1",
  partyId: "party-1",
  serviceId: "svc-1",
  leadId: "lead-1",
  actorId: "user-1",
  holidays: new Set<string>(),
  assigneeId: null,
};

describe("createProjectForEnrollment", () => {
  it("is idempotent — no-op when a project already exists for the PartyService", async () => {
    const { tx, create } = fakeTx({ id: "proj-existing" });
    const res = await createProjectForEnrollment(tx, { ...baseArgs, template: TEMPLATE });
    expect(res).toEqual({ projectId: "proj-existing", taskCount: 0, created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("is a soft no-op (returns null) when the service has no active template", async () => {
    const { tx, create } = fakeTx(null);
    const res = await createProjectForEnrollment(tx, { ...baseArgs, template: null });
    expect(res).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the project and snapshots one task per template step", async () => {
    const { tx, create, captured } = fakeTx(null);
    const res = await createProjectForEnrollment(tx, { ...baseArgs, template: TEMPLATE });
    expect(res).toEqual({ projectId: "proj-new", taskCount: 2, created: true });
    expect(create).toHaveBeenCalledTimes(1);
    const data = captured()!.data;
    expect(data.templateId).toBe("tmpl-1");
    expect(data.partyServiceId).toBe("ps-1");
    expect(data.tasks.create).toHaveLength(2);
    expect(data.tasks.create[0]).toMatchObject({ templateStepId: "s1", seq: 1, isRequired: true });
  });
});

describe("rollForwardDueDates", () => {
  it("chains each step from the running anchor; null SLA neither dates nor advances", () => {
    const keys = rollForwardDueDates(
      "2026-06-22", // Mon
      [{ slaDays: 1 }, { slaDays: 1 }, { slaDays: null }, { slaDays: 2 }],
      new Set(),
    );
    // Mon22 +1 = Tue23, +1 = Wed24, null (anchor stays Wed24), +2 = Fri26.
    expect(keys).toEqual(["2026-06-23", "2026-06-24", null, "2026-06-26"]);
  });

  it("treats a 0-day turnaround as same-day (no advance)", () => {
    const keys = rollForwardDueDates("2026-06-22", [{ slaDays: 0 }, { slaDays: 1 }], new Set());
    expect(keys).toEqual(["2026-06-22", "2026-06-23"]);
  });
});

describe("recomputeSchedule", () => {
  // A completedAt Date whose IST calendar date is `key`.
  const at = (key: string) => new Date(`${key}T12:00:00+05:30`);

  it("chains open tasks forward from the project start when none are done", () => {
    const tasks: ScheduleTask[] = [
      { id: "a", seq: 1, status: "pending", slaDays: 1, completedAt: null },
      { id: "b", seq: 2, status: "pending", slaDays: 2, completedAt: null },
    ];
    const { updates, projectDueAt } = recomputeSchedule(tasks, "2026-06-22", new Set());
    expect(updates[0]).toMatchObject({ id: "a" });
    expect(updates[0].dueAt?.toISOString().slice(0, 10)).toBe("2026-06-23"); // Mon+1
    expect(updates[1].dueAt?.toISOString().slice(0, 10)).toBe("2026-06-25"); // Tue+2 = Thu
    expect(projectDueAt?.toISOString().slice(0, 10)).toBe("2026-06-25");
  });

  it("re-anchors the open tail on the ACTUAL completion date — an early wait pulls it in", () => {
    // "Await Decision Letter" (180d estimate) actually completes on 2026-02-10;
    // the next step must be due 2026-02-10 + 1, NOT projectStart + 181.
    const tasks: ScheduleTask[] = [
      { id: "wait", seq: 1, status: "completed", slaDays: 180, completedAt: at("2026-02-10") },
      { id: "next", seq: 2, status: "pending", slaDays: 1, completedAt: null },
    ];
    const { updates } = recomputeSchedule(tasks, "2026-01-01", new Set());
    expect(updates).toHaveLength(1); // only the open task
    const expected = addBusinessDays("2026-02-10", 1, new Set()); // Tue 10 → Wed 11
    expect(updates[0]).toMatchObject({ id: "next" });
    expect(updates[0].dueAt?.toISOString().slice(0, 10)).toBe(expected);
  });

  it("passes over a skipped step (no turnaround contributed)", () => {
    const tasks: ScheduleTask[] = [
      { id: "skip", seq: 1, status: "skipped", slaDays: 5, completedAt: null },
      { id: "open", seq: 2, status: "pending", slaDays: 2, completedAt: null },
    ];
    const { updates } = recomputeSchedule(tasks, "2026-06-22", new Set());
    // Anchor stays at start (skip adds nothing): open due = Mon22 + 2 = Wed24.
    expect(updates).toEqual([
      { id: "open", dueAt: expect.anything() },
    ]);
    expect(updates[0].dueAt?.toISOString().slice(0, 10)).toBe("2026-06-24");
  });

  it("advances the anchor to the latest actual completion across out-of-order dones", () => {
    const tasks: ScheduleTask[] = [
      { id: "a", seq: 1, status: "completed", slaDays: 1, completedAt: at("2026-03-05") },
      { id: "b", seq: 2, status: "completed", slaDays: 1, completedAt: at("2026-03-02") },
      { id: "c", seq: 3, status: "pending", slaDays: 1, completedAt: null },
    ];
    const { updates } = recomputeSchedule(tasks, "2026-01-01", new Set());
    // Anchor = max(completedAt) = 2026-03-05; c due = +1 business day.
    const expected = addBusinessDays("2026-03-05", 1, new Set());
    expect(updates[0].dueAt?.toISOString().slice(0, 10)).toBe(expected);
  });
});
