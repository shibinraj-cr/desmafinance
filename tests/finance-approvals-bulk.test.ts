import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentUserAndPermissions: vi.fn() }));
vi.mock("@/lib/permissions", () => auth);
const appr = vi.hoisted(() => ({ approvePending: vi.fn(), rejectPending: vi.fn() }));
vi.mock("@/lib/approval", () => appr);

import { POST, maxDuration } from "@/app/api/finance/approvals/bulk/route";
import { bulkFailure } from "@/lib/finance-bulk-errors";
import { txErrorMessage } from "@/lib/finance-tx-errors";

const MANAGER = {
  isAdmin: false,
  canApprove: true,
  needsApproval: false,
  draftFirst: false,
  pages: ["/finance/approvals"],
};

function req(items: unknown) {
  return new Request("http://x/api/finance/approvals/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/finance/approvals/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentUserAndPermissions.mockResolvedValue({ perms: MANAGER, userId: "u1" });
    appr.approvePending.mockResolvedValue({ applied: true, transactionId: "t" });
  });
  afterEach(() => vi.useRealTimers());

  it("may run for the Pro plan's full 300 s", () => {
    expect(maxDuration).toBe(300);
  });

  it("answers 503 db_unavailable when the user lookup throws, not a bare 500", async () => {
    auth.getCurrentUserAndPermissions.mockRejectedValue(new Error("Can't reach database server"));
    const res = await POST(req([{ id: "a", action: "approve" }]));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "db_unavailable" });
    expect(appr.approvePending).not.toHaveBeenCalled();
  });

  it("answers 401 when there is no session", async () => {
    auth.getCurrentUserAndPermissions.mockResolvedValue({ perms: null, userId: null });
    expect((await POST(req([{ id: "a", action: "approve" }]))).status).toBe(401);
  });

  it("processes every row and reports per-row failures inside a 200", async () => {
    appr.approvePending
      .mockResolvedValueOnce({ applied: true, transactionId: "t1" })
      .mockResolvedValueOnce({ error: "already_resolved" })
      .mockRejectedValueOnce(new Error("boom"));
    const res = await POST(
      req([
        { id: "a", action: "approve" },
        { id: "b", action: "approve" },
        { id: "c", action: "approve" },
      ]),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toEqual([
      { id: "b", error: "already_resolved" },
      { id: "c", error: "threw: boom" },
    ]);
  });

  it("stops starting rows once the time budget is spent and returns them as not_reached", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    appr.approvePending.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 130_000); // each row "takes" 130 s
      return { applied: true, transactionId: "t" };
    });
    const res = await POST(
      req([
        { id: "a", action: "approve" },
        { id: "b", action: "approve" },
        { id: "c", action: "approve" },
      ]),
    );
    const body = await res.json();
    // a (0→130 s) and b (130→260 s) start inside the 240 s budget; c does not.
    expect(body.processed).toBe(2);
    expect(body.errors).toEqual([{ id: "c", error: "not_reached" }]);
    expect(appr.approvePending).toHaveBeenCalledTimes(2);
  });
});

describe("bulkFailure", () => {
  it("expired login → sign-in link, no reload", () => {
    expect(bulkFailure(401, "unauthenticated")).toMatchObject({ signIn: true, refresh: false });
    expect(bulkFailure(401, "unauthorized").message).toMatch(/login has expired/);
  });

  it("forbidden keeps its own message", () => {
    expect(bulkFailure(403, "forbidden").message).toBe("You don't have permission to approve / reject.");
  });

  it("database not answering → wait and retry", () => {
    expect(bulkFailure(503, "db_unavailable")).toMatchObject({ signIn: false, refresh: false });
    expect(bulkFailure(503, "db_unavailable").message).toMatch(/database didn't answer/);
  });

  it("timeout / crash → names the status and reloads, since some rows may be through", () => {
    const f = bulkFailure(504);
    expect(f.refresh).toBe(true);
    expect(f.message).toContain("error 504");
  });

  it("no reply at all → reloads too", () => {
    expect(bulkFailure(0)).toMatchObject({ refresh: true, signIn: false });
  });
});

describe("per-row messages", () => {
  it("explains not_reached and already_resolved", () => {
    expect(txErrorMessage("not_reached")).toMatch(/Process selected again/);
    expect(txErrorMessage("already_resolved")).toMatch(/someone else/);
  });
});
