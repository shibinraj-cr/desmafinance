import { describe, it, expect, vi } from "vitest";
import {
  buildSnapshotTasks,
  createProjectForEnrollment,
  type SnapshotStep,
} from "@/lib/ops-projects";

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
