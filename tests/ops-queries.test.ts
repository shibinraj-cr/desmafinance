import { describe, it, expect } from "vitest";
import { buildOpsProjectWhere } from "@/lib/ops-queries";

describe("buildOpsProjectWhere", () => {
  it("is empty when no filters are given", () => {
    expect(buildOpsProjectWhere({ currentUserId: "u1" })).toEqual({});
  });

  it("filters by status and service", () => {
    expect(buildOpsProjectWhere({ currentUserId: "u1", status: "active", serviceId: "svc1" })).toEqual({
      status: "active",
      serviceId: "svc1",
    });
  });

  it("maps assignee=me to the current user", () => {
    expect(buildOpsProjectWhere({ currentUserId: "u1", assignee: "me" })).toEqual({ assignedToId: "u1" });
  });

  it("maps assignee=unassigned to null", () => {
    expect(buildOpsProjectWhere({ currentUserId: "u1", assignee: "unassigned" })).toEqual({ assignedToId: null });
  });

  it("maps a specific assignee id through", () => {
    expect(buildOpsProjectWhere({ currentUserId: "u1", assignee: "u9" })).toEqual({ assignedToId: "u9" });
  });
});
