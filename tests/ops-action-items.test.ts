import { describe, it, expect } from "vitest";
import { applyActionItemStatus, bucketMyTask, myTasksWhere, ACTION_ITEM_ACTIVITY } from "@/lib/ops-action-items";

const NOW = new Date("2026-07-14T10:00:00.000Z");

describe("applyActionItemStatus", () => {
  it("complete stamps completedAt + completedById", () => {
    expect(applyActionItemStatus("complete", { actorId: "u7", now: NOW })).toEqual({
      status: "done",
      completedAt: NOW,
      completedById: "u7",
    });
  });

  it("complete with a null actor still stamps the time", () => {
    expect(applyActionItemStatus("complete", { actorId: null, now: NOW })).toEqual({
      status: "done",
      completedAt: NOW,
      completedById: null,
    });
  });

  it("reopen clears completion", () => {
    expect(applyActionItemStatus("reopen", { actorId: "u7", now: NOW })).toEqual({
      status: "open",
      completedAt: null,
      completedById: null,
    });
  });

  it("cancel clears completion", () => {
    expect(applyActionItemStatus("cancel", { actorId: "u7", now: NOW })).toEqual({
      status: "cancelled",
      completedAt: null,
      completedById: null,
    });
  });

  it("maps each action to its activity type", () => {
    expect(ACTION_ITEM_ACTIVITY).toEqual({
      complete: "TASK_COMPLETED",
      reopen: "TASK_REOPENED",
      cancel: "TASK_CANCELLED",
    });
  });
});

describe("bucketMyTask", () => {
  const today = "2026-07-14";

  it("done/cancelled always land in 'done' regardless of due date", () => {
    expect(bucketMyTask({ status: "done", dueAt: "2026-07-10T00:00:00.000Z" }, today)).toBe("done");
    expect(bucketMyTask({ status: "cancelled", dueAt: null }, today)).toBe("done");
  });

  it("open with no due date is 'no_due'", () => {
    expect(bucketMyTask({ status: "open", dueAt: null }, today)).toBe("no_due");
  });

  it("open due before today is 'overdue'", () => {
    expect(bucketMyTask({ status: "open", dueAt: "2026-07-13T00:00:00.000Z" }, today)).toBe("overdue");
  });

  it("open due today is 'today' (uses the date prefix, ignores time)", () => {
    expect(bucketMyTask({ status: "open", dueAt: "2026-07-14T23:59:00.000Z" }, today)).toBe("today");
  });

  it("open due after today is 'upcoming'", () => {
    expect(bucketMyTask({ status: "open", dueAt: "2026-07-20T00:00:00.000Z" }, today)).toBe("upcoming");
  });
});

describe("myTasksWhere", () => {
  it("covers tasks assigned to the user and their own unassigned ones", () => {
    expect(myTasksWhere("u1")).toEqual({
      OR: [{ assignedToId: "u1" }, { assignedToId: null, createdById: "u1" }],
    });
  });

  it("never matches an unassigned task somebody else raised", () => {
    const [mine, ownUnassigned] = myTasksWhere("u1").OR as { assignedToId: string | null; createdById?: string }[];
    expect(mine.assignedToId).toBe("u1");
    expect(ownUnassigned.createdById).toBe("u1");
  });
});
