import { describe, it, expect } from "vitest";
import { applyTaskTransition, deriveProjectCompleted } from "@/lib/ops-tasks";

const NOW = new Date("2026-06-24T10:00:00.000Z");

describe("applyTaskTransition", () => {
  it("start stamps startedAt only when not already started", () => {
    expect(applyTaskTransition({ status: "pending", startedAt: null }, "start", { actorId: "u1", now: NOW })).toEqual({
      status: "in_progress",
      startedAt: NOW,
    });
    const earlier = new Date("2026-06-20T00:00:00.000Z");
    expect(applyTaskTransition({ status: "blocked", startedAt: earlier }, "start", { actorId: "u1", now: NOW })).toEqual({
      status: "in_progress",
      startedAt: earlier,
    });
  });

  it("complete stamps completedAt + completedBy and clears block", () => {
    const r = applyTaskTransition({ status: "in_progress", startedAt: null }, "complete", { actorId: "u7", now: NOW });
    expect(r).toEqual({ status: "completed", startedAt: NOW, completedAt: NOW, completedById: "u7", blockedReason: null });
  });

  it("block records the reason", () => {
    expect(applyTaskTransition({ status: "pending", startedAt: null }, "block", { actorId: "u1", now: NOW, blockedReason: "waiting on docs" })).toEqual({
      status: "blocked",
      blockedReason: "waiting on docs",
    });
  });

  it("skip and reopen clear completion fields", () => {
    expect(applyTaskTransition({ status: "in_progress", startedAt: NOW }, "skip", { actorId: "u1", now: NOW })).toMatchObject({ status: "skipped", completedAt: null, completedById: null });
    expect(applyTaskTransition({ status: "completed", startedAt: NOW }, "reopen", { actorId: "u1", now: NOW })).toMatchObject({ status: "pending", completedAt: null, completedById: null });
  });
});

describe("deriveProjectCompleted", () => {
  it("is false for an empty project", () => {
    expect(deriveProjectCompleted([])).toBe(false);
  });

  it("completes when all required tasks are done or skipped (optional ones ignored)", () => {
    expect(
      deriveProjectCompleted([
        { isRequired: true, status: "completed" },
        { isRequired: true, status: "skipped" },
        { isRequired: false, status: "pending" },
      ]),
    ).toBe(true);
  });

  it("is not complete while a required task is still open", () => {
    expect(
      deriveProjectCompleted([
        { isRequired: true, status: "completed" },
        { isRequired: true, status: "in_progress" },
      ]),
    ).toBe(false);
  });

  it("falls back to all-tasks when there are no required tasks", () => {
    expect(deriveProjectCompleted([{ isRequired: false, status: "completed" }])).toBe(true);
    expect(deriveProjectCompleted([{ isRequired: false, status: "pending" }])).toBe(false);
  });
});
