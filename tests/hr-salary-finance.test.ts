/**
 * The payroll → ledger hand-off: approving a salary run raises one Finance
 * draft per employee. The behaviour that matters most is that a salary can
 * never be booked twice, and that the rows reach only Finance — these are
 * everyone's pay.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  userId: "hr-1" as string | null,
  perms: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: async () => ({ userId: auth.userId, perms: auth.perms }),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    hrPfRule: { findMany: vi.fn() },
    hrSalaryRun: { findUnique: vi.fn(), upsert: vi.fn() },
    hrSalaryRunLine: { deleteMany: vi.fn() },
    hrAuditLog: { create: vi.fn() },
    employee: { findUnique: vi.fn() },
    transaction: { aggregate: vi.fn() },
    transactionDraft: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      aggregate: vi.fn(),
    },
    pendingApproval: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import {
  raiseSalaryDrafts,
  salaryAlreadyInFinance,
  salaryBookingDate,
  salaryDraftRows,
  salarySubItem,
} from "@/lib/hr-salary-finance";
import { computeSalaryRun, SalaryRunWithFinanceError } from "@/lib/hr-salary-engine";
import { discardDraft, draftScope, submitDraftToPending, updateDraft } from "@/lib/approval";
import { canWorkSalaryDrafts, type Permissions } from "@/lib/rbac";
import { validateCounterparty } from "@/lib/tx-counterparty";
import { POST as approveRun } from "@/app/api/hr/salary/[id]/route";
import { POST as compute } from "@/app/api/hr/salary/route";

const mock = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
  hrPfRule: { findMany: ReturnType<typeof vi.fn> };
  hrSalaryRun: { findUnique: ReturnType<typeof vi.fn> };
  hrSalaryRunLine: { deleteMany: ReturnType<typeof vi.fn> };
  hrAuditLog: { create: ReturnType<typeof vi.fn> };
  employee: { findUnique: ReturnType<typeof vi.fn> };
  transaction: { aggregate: ReturnType<typeof vi.fn> };
  transactionDraft: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
  };
  pendingApproval: { findMany: ReturnType<typeof vi.fn> };
};

const role = (p: Partial<Permissions>): Permissions => ({
  isAdmin: false,
  canApprove: false,
  needsApproval: true,
  draftFirst: false,
  pages: ["/finance/approvals"],
  roleName: "Custom",
  ...p,
});

const preparer = role({ draftFirst: true });
const financeManager = role({ canApprove: true, needsApproval: false });
const admin = role({ isAdmin: true, canApprove: true, needsApproval: false });
const submissionsOnly = role({});
const hrManager = role({ canApprove: true, needsApproval: false, pages: ["/hr/salary", "/hr/attendance"] });

const line = (employeeId: string, net: number, adj = 0, designation: string | null = "Executive") => ({
  employeeId,
  netSalary: net,
  adjustments: adj,
  designation,
});

const run = { id: "run-1", monthKey: "2026-10" };

beforeEach(() => vi.clearAllMocks());

describe("salaryBookingDate", () => {
  it("books on the 30th, as the Axis file does", () => {
    expect(salaryBookingDate("2026-10").toISOString().slice(0, 10)).toBe("2026-10-30");
  });

  it("falls back to the last day of a short month instead of rolling into the next", () => {
    expect(salaryBookingDate("2027-02").toISOString().slice(0, 10)).toBe("2027-02-28");
    expect(salaryBookingDate("2028-02").toISOString().slice(0, 10)).toBe("2028-02-29");
  });
});

describe("salarySubItem", () => {
  it("books owners under Directors even if they were last booked elsewhere", () => {
    expect(salarySubItem("Managing Director", "Senior Team")).toBe("Directors");
  });

  it("books trainees under Trainee Stipend", () => {
    expect(salarySubItem("Trainee")).toBe("Trainee Stipend");
  });

  it("keeps where Finance last booked this person", () => {
    expect(salarySubItem("Senior Consultant", "Sales Team")).toBe("Sales Team");
  });

  it("uses the fallback the first time someone is booked", () => {
    expect(salarySubItem("Senior Consultant")).toBe("Operational Team");
  });
});

describe("salaryDraftRows", () => {
  const rows = (lines: ReturnType<typeof line>[]) =>
    salaryDraftRows({ run, ownerId: "hr-1", lines, lastBooked: new Map() });

  it("raises a Salary expense for the amount the Axis file pays", () => {
    expect(rows([line("e1", 30000, -1500)])).toEqual([
      {
        submittedById: "hr-1",
        salaryRunId: "run-1",
        employeeId: "e1",
        date: new Date("2026-10-30T00:00:00.000Z"),
        month: "Oct-26",
        type: "Expense",
        category: "Salary",
        subItem: "Operational Team",
        description: "Salary 2026-10",
        paymentMode: "Axis Bank",
        amount: 28500,
        flow: "Outflow",
      },
    ]);
  });

  it("skips a line with nothing to pay", () => {
    expect(rows([line("e1", 0), line("e2", 1000, -1000), line("e3", 500, -900)])).toEqual([]);
  });

  it("keeps the amount to the paisa", () => {
    expect(rows([line("e1", 0.1, 0.2)])[0].amount).toBe(0.3);
  });
});

describe("raiseSalaryDrafts", () => {
  const tx = () => ({
    hrSalaryRunLine: {
      findMany: vi.fn().mockResolvedValue([
        {
          employeeId: "e1",
          netSalary: 20000,
          adjustments: 0,
          employee: { designation: "Executive", designationRef: null },
        },
        {
          employeeId: "e2",
          netSalary: 90000,
          adjustments: 0,
          employee: { designation: "Executive", designationRef: { name: "Director" } },
        },
      ]),
    },
    transaction: { findMany: vi.fn().mockResolvedValue([{ employeeId: "e1", subItem: "Sales Team" }]) },
    transactionDraft: { createMany: vi.fn() },
  });

  it("writes every draft through the approval's transaction", async () => {
    const client = tx();
    const result = await raiseSalaryDrafts(client as never, run, "hr-1");

    expect(result).toEqual({ count: 2, total: 110000 });
    const { data } = client.transactionDraft.createMany.mock.calls[0][0];
    expect(data.map((d: { employeeId: string; subItem: string }) => [d.employeeId, d.subItem])).toEqual([
      ["e1", "Sales Team"],
      ["e2", "Directors"],
    ]);
  });

  it("ignores incentives and retired sub-items when looking up past bookings", async () => {
    const client = tx();
    await raiseSalaryDrafts(client as never, run, "hr-1");

    const { where } = client.transaction.findMany.mock.calls[0][0];
    expect(where.subItem.in).toContain("Sales Team");
    expect(where.subItem.in).not.toContain("Incentive");
    expect(where.subItem.in).not.toContain("Salary");
    expect(where.deletedAt).toBeNull();
  });
});

describe("POST /api/hr/salary/[id] (approve)", () => {
  const request = () => new Request("http://x", { method: "POST", body: JSON.stringify({ action: "approve" }) });
  const client = (claimed: number) => ({
    hrSalaryRun: { updateMany: vi.fn().mockResolvedValue({ count: claimed }) },
    hrSalaryRunLine: {
      findMany: vi.fn().mockResolvedValue([
        {
          employeeId: "e1",
          netSalary: 20000,
          adjustments: 0,
          employee: { designation: "Executive", designationRef: null },
        },
      ]),
    },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    transactionDraft: { createMany: vi.fn() },
  });

  beforeEach(() => {
    auth.perms = hrManager;
    auth.userId = "hr-1";
    mock.hrSalaryRun.findUnique.mockResolvedValue({ ...run, status: "draft", totalNet: 20000 });
  });

  it("flips the run and raises its drafts in one transaction", async () => {
    const tx = client(1);
    mock.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await approveRun(request(), { params: { id: run.id } });

    expect(res.status).toBe(200);
    expect((await res.json()).financeDrafts).toBe(1);
    expect(tx.hrSalaryRun.updateMany.mock.calls[0][0].where).toEqual({ id: run.id, status: "draft" });
    expect(tx.transactionDraft.createMany).toHaveBeenCalledOnce();
  });

  it("raises nothing for the request that loses a double click", async () => {
    const tx = client(0);
    mock.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await approveRun(request(), { params: { id: run.id } });

    expect(res.status).toBe(400);
    expect(tx.transactionDraft.createMany).not.toHaveBeenCalled();
    expect(mock.hrAuditLog.create).not.toHaveBeenCalled();
  });

  it("refuses someone without HR approval rights", async () => {
    auth.perms = preparer;

    const res = await approveRun(request(), { params: { id: run.id } });

    expect(res.status).toBe(403);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/hr/salary/[id] (send to Finance)", () => {
  const request = () =>
    new Request("http://x", { method: "POST", body: JSON.stringify({ action: "send_to_finance" }) });
  const client = (current: { status: string; financeSubmittedAt: Date | null; drafts: number }) => ({
    hrSalaryRun: {
      findUnique: vi.fn().mockResolvedValue({
        status: current.status,
        financeSubmittedAt: current.financeSubmittedAt,
        _count: { financeDrafts: current.drafts },
      }),
    },
    hrSalaryRunLine: {
      findMany: vi.fn().mockResolvedValue([
        {
          employeeId: "e1",
          netSalary: 20000,
          adjustments: 0,
          employee: { designation: "Executive", designationRef: null },
        },
      ]),
    },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    transactionDraft: { createMany: vi.fn() },
  });
  const sendWith = async (tx: ReturnType<typeof client>) => {
    mock.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));
    return approveRun(request(), { params: { id: run.id } });
  };

  beforeEach(() => {
    auth.perms = hrManager;
    auth.userId = "hr-1";
    mock.hrSalaryRun.findUnique.mockResolvedValue({ ...run, status: "hr_approved", totalNet: 20000 });
  });

  it("raises the drafts a run approved before the hand-off never raised", async () => {
    const tx = client({ status: "hr_approved", financeSubmittedAt: null, drafts: 0 });

    const res = await sendWith(tx);

    expect(res.status).toBe(200);
    expect((await res.json()).financeDrafts).toBe(1);
    const { data } = tx.transactionDraft.createMany.mock.calls[0][0];
    expect(data[0]).toMatchObject({ salaryRunId: run.id, employeeId: "e1", submittedById: "hr-1", amount: 20000 });
    expect(mock.hrAuditLog.create.mock.calls[0][0].data.eventType).toBe("salary_run_sent_to_finance");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DRAFT_CREATE" }));
  });

  it("re-checks the run inside the transaction, not from the stale read", async () => {
    const tx = client({ status: "hr_approved", financeSubmittedAt: null, drafts: 0 });

    await sendWith(tx);

    expect(tx.hrSalaryRun.findUnique.mock.calls[0][0].where).toEqual({ id: run.id });
  });

  it.each([
    ["drafts are already waiting in Finance", { status: "hr_approved", financeSubmittedAt: null, drafts: 3 }],
    ["Finance has already submitted from it", { status: "hr_approved", financeSubmittedAt: new Date(), drafts: 0 }],
    ["the run is still a draft", { status: "draft", financeSubmittedAt: null, drafts: 0 }],
  ])("sends nothing when %s", async (_why, current) => {
    const tx = client(current);

    const res = await sendWith(tx);

    expect(res.status).toBe(409);
    expect(tx.transactionDraft.createMany).not.toHaveBeenCalled();
    expect(mock.hrAuditLog.create).not.toHaveBeenCalled();
  });

  it("turns the losing half of a double click into a conflict", async () => {
    const tx = client({ status: "hr_approved", financeSubmittedAt: null, drafts: 0 });
    tx.transactionDraft.createMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" }),
    );

    const res = await sendWith(tx);

    expect(res.status).toBe(409);
    expect(mock.hrAuditLog.create).not.toHaveBeenCalled();
  });

  it("lets any other database failure surface", async () => {
    const tx = client({ status: "hr_approved", financeSubmittedAt: null, drafts: 0 });
    tx.transactionDraft.createMany.mockRejectedValue(new Error("connection lost"));

    await expect(sendWith(tx)).rejects.toThrow("connection lost");
  });

  it("refuses someone without HR approval rights", async () => {
    auth.perms = financeManager;

    const res = await approveRun(request(), { params: { id: run.id } });

    expect(res.status).toBe(403);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });
});

describe("salaryAlreadyInFinance", () => {
  const sum = (count: number, amount: number | null) => ({ _count: count, _sum: { amount } });

  beforeEach(() => {
    mock.transaction.aggregate.mockResolvedValue(sum(2, 50000));
    mock.transactionDraft.aggregate.mockResolvedValue(sum(1, 20000));
    mock.pendingApproval.findMany.mockResolvedValue([
      { proposed: { type: "Expense", category: "Salary", subItem: "Sales Team", employeeId: "e1", date: "2026-10-31", amount: 15000 } },
      // Not counted: someone outside the run, another month, an incentive.
      { proposed: { type: "Expense", category: "Salary", subItem: "Sales Team", employeeId: "x9", date: "2026-10-31", amount: 1 } },
      { proposed: { type: "Expense", category: "Salary", subItem: "Sales Team", employeeId: "e1", date: "2026-11-01T00:00:00.000Z", amount: 1 } },
      { proposed: { type: "Expense", category: "Salary", subItem: "Incentive", employeeId: "e1", date: "2026-10-15", amount: 1 } },
    ]);
  });

  it("adds up hand-entered salary across the ledger, drafts and the approval queue", async () => {
    expect(await salaryAlreadyInFinance("2026-10", ["e1", "e2"])).toEqual({ count: 4, total: 85000 });
  });

  it("looks at the run's calendar month, leaving out deleted rows, incentives and the run's own drafts", async () => {
    await salaryAlreadyInFinance("2026-10", ["e1"]);

    const ledger = mock.transaction.aggregate.mock.calls[0][0].where;
    expect(ledger).toMatchObject({
      deletedAt: null,
      category: "Salary",
      subItem: { not: "Incentive" },
      employeeId: { in: ["e1"] },
      date: { gte: new Date("2026-10-01T00:00:00.000Z"), lt: new Date("2026-11-01T00:00:00.000Z") },
    });
    expect(mock.transactionDraft.aggregate.mock.calls[0][0].where.salaryRunId).toBeNull();
  });

  it("reports nothing when Finance holds nothing", async () => {
    mock.transaction.aggregate.mockResolvedValue(sum(0, null));
    mock.transactionDraft.aggregate.mockResolvedValue(sum(0, null));
    mock.pendingApproval.findMany.mockResolvedValue([]);

    expect(await salaryAlreadyInFinance("2026-10", ["e1"])).toEqual({ count: 0, total: 0 });
  });
});

describe("recomputing a run", () => {
  const request = () => new Request("http://x", { method: "POST", body: JSON.stringify({ monthKey: "2026-10" }) });

  beforeEach(() => {
    auth.perms = hrManager;
    auth.userId = "hr-1";
    mock.hrPfRule.findMany.mockResolvedValue([]);
  });

  it("is refused once Finance has submitted anything, before a single write", async () => {
    mock.hrSalaryRun.findUnique.mockResolvedValue({ financeSubmittedAt: new Date() });

    await expect(computeSalaryRun("2026-10", "hr-1")).rejects.toBeInstanceOf(SalaryRunWithFinanceError);

    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.hrSalaryRunLine.deleteMany).not.toHaveBeenCalled();
  });

  it("tells HR why, as a conflict", async () => {
    mock.hrSalaryRun.findUnique.mockResolvedValue({ financeSubmittedAt: new Date() });

    const res = await compute(request());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("2026-10");
  });

  it("takes back unsubmitted drafts in the same transaction that reopens the run", async () => {
    mock.hrSalaryRun.findUnique.mockResolvedValue({ financeSubmittedAt: null });
    mock.transactionDraft.deleteMany.mockReturnValue("delete-op");
    (prisma.hrSalaryRun.upsert as unknown as ReturnType<typeof vi.fn>).mockReturnValue("upsert-op");
    // Stop after the reopen: the rest of the compute isn't under test here.
    mock.$transaction.mockResolvedValue([{ count: 3 }, { id: "run-1" }]);
    mock.hrSalaryRunLine.deleteMany.mockRejectedValue(new Error("stop"));

    await expect(computeSalaryRun("2026-10", "hr-1")).rejects.toThrow("stop");

    expect(mock.transactionDraft.deleteMany).toHaveBeenCalledWith({
      where: { salaryRun: { monthKey: "2026-10" } },
    });
    expect(mock.$transaction).toHaveBeenCalledWith(["delete-op", "upsert-op"]);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DRAFT_DISCARD",
        changes: { monthKey: "2026-10", recalledDrafts: 3 },
      }),
    );
  });
});

describe("who works salary drafts", () => {
  it("is the preparer, Finance reviewers and admins", () => {
    expect(canWorkSalaryDrafts(preparer)).toBe(true);
    expect(canWorkSalaryDrafts(financeManager)).toBe(true);
    expect(canWorkSalaryDrafts(admin)).toBe(true);
  });

  it("is not everyone who can open the approvals page: this is everyone's pay", () => {
    expect(canWorkSalaryDrafts(submissionsOnly)).toBe(false);
  });

  it("is not an approver from outside Finance", () => {
    expect(canWorkSalaryDrafts(hrManager)).toBe(false);
  });

  it("is nobody signed out", () => {
    expect(canWorkSalaryDrafts(null)).toBe(false);
  });
});

describe("draftScope", () => {
  const salary = { OR: [{ submittedById: "u1" }, { salaryRunId: { not: null } }] };

  it("shows an oversight admin everything", () => {
    expect(draftScope(admin, "u1")).toEqual({});
  });

  it("adds salary drafts for Finance", () => {
    expect(draftScope(preparer, "u1")).toEqual(salary);
    expect(draftScope(financeManager, "u1")).toEqual(salary);
  });

  it("keeps a draft-first admin on their own queue plus salaries", () => {
    expect(draftScope({ ...admin, draftFirst: true }, "u1")).toEqual(salary);
  });

  it("shows anyone else only their own, never salaries", () => {
    expect(draftScope(submissionsOnly, "u1")).toEqual({ submittedById: "u1" });
  });
});

describe("acting on a draft", () => {
  const salaryDraft = {
    id: "d1",
    submittedById: "hr-1",
    salaryRunId: "run-1",
    employeeId: "e1",
    partyId: null,
    date: new Date("2026-10-30"),
    month: "Oct-26",
    type: "Expense",
    category: "Salary",
    subItem: "Sales Team",
    description: "Salary 2026-10",
    paymentMode: "Axis Bank",
    amount: 20000,
    flow: "Outflow",
    expDom: null,
  };
  const ordinaryDraft = { ...salaryDraft, submittedById: "owner", salaryRunId: null };
  const data = {
    date: "2026-10-30",
    month: "Oct-26",
    type: "Expense",
    category: "Salary",
    subItem: "Sales Team",
    paymentMode: "HDFC Bank",
    amount: 19000,
    flow: "Outflow",
    employeeId: "e1",
  };

  type Tx = {
    transaction: { create: ReturnType<typeof vi.fn> };
    pendingApproval: { create: ReturnType<typeof vi.fn> };
    transactionDraft: { delete: ReturnType<typeof vi.fn> };
    hrSalaryRun: { updateMany: ReturnType<typeof vi.fn> };
  };
  let tx: Tx;

  beforeEach(() => {
    tx = {
      transaction: { create: vi.fn().mockResolvedValue({ id: "t1" }) },
      pendingApproval: { create: vi.fn().mockResolvedValue({ id: "p1" }) },
      transactionDraft: { delete: vi.fn() },
      hrSalaryRun: { updateMany: vi.fn() },
    };
    mock.$transaction.mockImplementation((cb: (t: Tx) => unknown) => cb(tx));
    mock.transactionDraft.update.mockResolvedValue({ id: "d1" });
  });

  it("lets Finance edit a salary draft owned by the HR approver", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(salaryDraft);

    const result = await updateDraft({ draftId: "d1", userId: "fin-1", perms: preparer, data });

    expect(result).toEqual({ ok: true, draft: { id: "d1" } });
    expect(mock.transactionDraft.update.mock.calls[0][0].data.amount).toBe(19000);
  });

  it("refuses a page-only user, even with a guessed draft id", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(salaryDraft);

    const perms = submissionsOnly;
    expect(await updateDraft({ draftId: "d1", userId: "x", perms, data })).toEqual({ error: "forbidden" });
    expect(await discardDraft({ draftId: "d1", userId: "x", perms })).toEqual({ error: "forbidden" });
    expect(await submitDraftToPending({ draftId: "d1", userId: "x", perms })).toEqual({ error: "forbidden" });
  });

  it("gives the HR approver no hold over the row once it is Finance's", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(salaryDraft);

    const result = await updateDraft({ draftId: "d1", userId: "hr-1", perms: hrManager, data });

    expect(result).toEqual({ error: "forbidden" });
  });

  it("leaves ordinary drafts owner-only", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(ordinaryDraft);

    const result = await updateDraft({ draftId: "d1", userId: "fin-1", perms: financeManager, data });

    expect(result).toEqual({ error: "forbidden" });
  });

  it("queues a preparer's submission under their own name, so a rejection reaches them", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(salaryDraft);

    await submitDraftToPending({ draftId: "d1", userId: "fin-1", perms: preparer });

    expect(tx.pendingApproval.create.mock.calls[0][0].data.submittedById).toBe("fin-1");
  });

  it("stamps the run inside the submit transaction, closing it to recompute", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(salaryDraft);

    await submitDraftToPending({ draftId: "d1", userId: "fin-1", perms: preparer });

    expect(tx.hrSalaryRun.updateMany.mock.calls[0][0].where).toEqual({ id: "run-1", financeSubmittedAt: null });
  });

  it("stamps the run when a reviewer posts straight to the ledger too", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(salaryDraft);

    const result = await submitDraftToPending({ draftId: "d1", userId: "mgr", perms: financeManager });

    expect(result).toMatchObject({ applied: true });
    expect(tx.transaction.create.mock.calls[0][0].data.createdById).toBe("mgr");
    expect(tx.hrSalaryRun.updateMany).toHaveBeenCalledOnce();
  });

  it("leaves an ordinary draft's owner attribution alone and stamps nothing", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(ordinaryDraft);

    await submitDraftToPending({ draftId: "d1", userId: "owner", perms: preparer });

    expect(tx.pendingApproval.create.mock.calls[0][0].data.submittedById).toBe("owner");
    expect(tx.hrSalaryRun.updateMany).not.toHaveBeenCalled();
  });

  it("doesn't close the run when Finance discards a draft: nothing was booked", async () => {
    mock.transactionDraft.findUnique.mockResolvedValue(salaryDraft);

    const result = await discardDraft({ draftId: "d1", userId: "fin-1", perms: preparer });

    expect(result).toEqual({ ok: true });
    expect(tx.hrSalaryRun.updateMany).not.toHaveBeenCalled();
  });
});

describe("validateCounterparty for a leaver", () => {
  beforeEach(() => mock.employee.findUnique.mockResolvedValue({ id: "e1", active: false }));

  it("still refuses a deactivated employee by default", async () => {
    expect(await validateCounterparty({ type: "Expense", employeeId: "e1" })).toBe("employee_not_found");
  });

  it("excuses the employee the row already names", async () => {
    expect(
      await validateCounterparty({ type: "Expense", employeeId: "e1", allowInactiveEmployeeId: "e1" }),
    ).toBeNull();
  });

  it("doesn't excuse anyone else", async () => {
    expect(
      await validateCounterparty({ type: "Expense", employeeId: "e1", allowInactiveEmployeeId: "e2" }),
    ).toBe("employee_not_found");
  });
});
