/**
 * The automation engine end to end — discovery, download, archive, parse,
 * validation, import, retries, alerts — against an in-memory database. Only
 * the edges are faked: Gmail, the bank's web page, the Blob store, and the
 * PDF → text step (fed the same positioned-text fixtures the parser tests use).
 *
 * These are the acceptance scenarios: a new statement imports; re-running
 * creates nothing; a repeated backfill adds nothing; a wrong password, CAPTCHA
 * or changed page stops safely and alerts; suspicious data is held for review.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("./helpers/fake-prisma").createFakePrisma>,
  messages: [] as Array<{ id: string; subject: string; jobkey: string; receivedAt: Date }>,
  behaviour: {} as Record<string, string>,
  pdfFor: {} as Record<string, string>,
  items: {} as Record<string, unknown[]>,
  downloads: 0,
  alerts: [] as Array<{ title: string; body: string }>,
}));

vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("./helpers/fake-prisma");
  h.db = createFakePrisma();
  return { prisma: h.db };
});

vi.mock("@/lib/bank/gmail", () => ({
  gmailAccessToken: vi.fn(async () => "access-token"),
  gmailProfileEmail: vi.fn(async () => "accounts@example.in"),
  searchMessageIds: vi.fn(async () => h.messages.map((m) => m.id)),
  getMessage: vi.fn(async (_t: string, id: string) => {
    const m = h.messages.find((x) => x.id === id)!;
    return {
      id,
      receivedAt: m.receivedAt,
      from: "HDFC Bank <hdfcbanksmartstatement@hdfcbank.bank.in>",
      to: "accounts@example.in",
      subject: m.subject,
      bodies: [`<a href="https://smartstatements.hdfc.bank.in/HDFCRestFulService/GetStatement.jsp?jobkey=${m.jobkey}">View</a>`],
      attachment: null,
    };
  }),
  getAttachment: vi.fn(),
  SHEETS_SCOPE: "https://www.googleapis.com/auth/spreadsheets",
  bankGoogleOAuthConfig: () => ({ clientId: "x", clientSecret: "y" }),
}));

vi.mock("@/lib/bank/downloaders", async () => {
  const { BankAutomationError } = await import("@/lib/bank/errors");
  return {
    downloaderFor: () => ({
      download: async (url: string) => {
        h.downloads++;
        const jobkey = new URL(url).searchParams.get("jobkey")!;
        const b = h.behaviour[jobkey] ?? "ok";
        if (b === "badpw") throw new BankAutomationError("PASSWORD_REJECTED", "The bank rejected the statement password");
        if (b === "captcha") throw new BankAutomationError("CAPTCHA_OR_MFA", "The bank page is showing a CAPTCHA");
        if (b === "changed") throw new BankAutomationError("PAGE_CHANGED", "No password field on the statement page");
        if (b === "net-once") {
          h.behaviour[jobkey] = "ok";
          throw new BankAutomationError("NETWORK", "fetch failed");
        }
        return { pdf: new Uint8Array(Buffer.from(`%PDF-1.4 ${h.pdfFor[jobkey] ?? jobkey}`)), via: "download" as const };
      },
    }),
  };
});

vi.mock("@/lib/bank/pdf", async (orig) => {
  const real = await orig<typeof import("@/lib/bank/pdf")>();
  return {
    ...real,
    extractTextItems: vi.fn(async (buf: Uint8Array) => {
      const key = Buffer.from(buf).toString("latin1").replace("%PDF-1.4 ", "");
      return { items: h.items[key] ?? [], pages: 1, encrypted: false };
    }),
  };
});

vi.mock("@/lib/bank/storage", async (orig) => {
  const real = await orig<typeof import("@/lib/bank/storage")>();
  const store = new Map<string, Uint8Array>();
  return {
    ...real,
    isArchiveConfigured: () => true,
    archivePdf: vi.fn(async (p: string, b: Uint8Array) => void store.set(p, b)),
    readArchivedPdf: vi.fn(async (p: string) => store.get(p)!),
  };
});

vi.mock("@/lib/bank/notify", () => ({
  notifyBankAlert: vi.fn(async (a: { title: string; body: string }) => {
    h.alerts.push(a);
    return 1;
  }),
}));

import { advanceRun, createRun, importUploadedPdf, reviewStatement } from "@/lib/bank/engine";
import { seal } from "@/lib/bank/secrets";
import { generateRows, hdfcFixture, type FixtureRow } from "./fixtures/hdfc-statement";

const DEADLINE = () => Date.now() + 10 * 60_000;
let integrationId = "";

function subjectFor(d: string) {
  const [y, m, dd] = d.split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `Email Account Statement of your HDFC Bank Account ***1234 for the period ${dd}-${mon}-${y} TO ${dd}-${mon}-${y}`;
}

/** A statement e-mail for `day` (ISO) whose PDF parses to `rows`. */
function addStatement(day: string, rows: FixtureRow[], opts: { jobkey?: string; behaviour?: string; pdfKey?: string; summary?: Parameters<typeof hdfcFixture>[0]["summary"] } = {}) {
  const jobkey = opts.jobkey ?? `job-${day}`;
  const pdfKey = opts.pdfKey ?? `pdf-${day}`;
  const [y, m, d] = day.split("-");
  h.messages.push({ id: `msg-${jobkey}`, subject: subjectFor(day), jobkey, receivedAt: new Date(`${day}T22:00:00Z`) });
  h.pdfFor[jobkey] = pdfKey;
  if (opts.behaviour) h.behaviour[jobkey] = opts.behaviour;
  const slash = `${d}/${m}/${y}`;
  h.items[pdfKey] = hdfcFixture({ rows, from: slash, to: slash, summary: opts.summary });
}

function rowsOn(day: string, n: number, opening: number) {
  const [y, m, d] = day.split("-");
  return generateRows(n, opening, `${d}/${m}/${y.slice(2)}`);
}

const table = (name: string) => (h.db._tables[name] ?? []) as Array<Record<string, unknown>>;

async function run(trigger: "MANUAL" | "BACKFILL" | "SCHEDULED" | "TEST", from?: string, to?: string) {
  const { runId } = await createRun({ integrationId, trigger, fromDate: from, toDate: to });
  await advanceRun(runId, DEADLINE());
  return table("bankStatementRun").find((r) => r.id === runId)!;
}

beforeEach(async () => {
  for (const k of Object.keys(h.db._tables)) delete h.db._tables[k];
  h.messages = [];
  h.behaviour = {};
  h.pdfFor = {};
  h.items = {};
  h.downloads = 0;
  h.alerts = [];
  process.env.NEXTAUTH_SECRET = "engine-test-secret";
  process.env.HDFC_STATEMENT_PASSWORD = "Test@1234";
  const mailbox = await h.db.bankMailboxConnection.create({
    data: { emailAddress: "accounts@example.in", refreshTokenEnc: seal("refresh", "gmail-refresh-token"), scope: "gmail.readonly", lastError: null },
  });
  const i = await h.db.bankIntegration.create({
    data: {
      bankCode: "HDFC",
      bankName: "HDFC Bank",
      accountName: "Current",
      accountLastFour: "1234",
      currency: "INR",
      emailSender: "hdfcbanksmartstatement@hdfcbank.bank.in",
      emailRecipient: "accounts@example.in",
      emailSubjectPattern: "Email Account Statement of your HDFC Bank Account ***{last4} for the period",
      mailboxConnectionId: mailbox.id,
      passwordSecretRef: "env:HDFC_STATEMENT_PASSWORD",
      automationEnabled: true,
      runTime: "09:30",
      timezone: "Asia/Kolkata",
      lookbackDays: 3,
      browserAutomationEnabled: true,
      pdfArchiveEnabled: true,
      failureScreenshots: false,
      sheetSyncEnabled: false,
      alertAfterBusinessDays: 2,
      lastStatementDate: null,
      lastStatementReceivedAt: null,
      lastScheduledRunOn: null,
    },
  });
  integrationId = i.id;
});

describe("bank automation engine — acceptance", () => {
  it("TEST 1 + 4: a new statement e-mail is found, downloaded, parsed and imported (20 rows, directions right)", async () => {
    addStatement("2026-10-06", rowsOn("2026-10-06", 20, 5_00_000_00));
    const r = await run("MANUAL");
    expect(r.status).toBe("COMPLETED");
    const [s] = table("bankStatement");
    expect(s.status).toBe("PROCESSED");
    expect(s.insertedCount).toBe(20);
    expect(s.blobPathname).toMatch(/^bank-statements\/hdfc\/1234\/2026\/10\/HDFC_1234_2026-10-06_[0-9a-f]{8}\.pdf$/);
    const txns = table("bankTransaction");
    expect(txns).toHaveLength(20);
    expect(txns.filter((t) => t.direction === "DEBIT").length).toBe(13);
    expect(r.transactionsCreated).toBe(20);
    // The sealed statement link never appears in plain text anywhere.
    expect(JSON.stringify(h.db._tables)).not.toContain("jobkey=job-");
  });

  it("TEST 2: the scheduler running again against the same e-mail creates nothing", async () => {
    addStatement("2026-10-06", rowsOn("2026-10-06", 5, 1_00_000_00));
    await run("SCHEDULED");
    const downloads = h.downloads;
    const again = await run("SCHEDULED");
    expect(again.status).toBe("NO_NEW");
    expect(h.downloads).toBe(downloads); // not even re-downloaded
    expect(table("bankStatement")).toHaveLength(1);
    expect(table("bankTransaction")).toHaveLength(5);
  });

  it("TEST 3: the same backfill run twice imports zero duplicates the second time", async () => {
    ["2026-10-01", "2026-10-02", "2026-10-03"].forEach((d, k) => addStatement(d, rowsOn(d, 4 + k, 1_00_000_00)));
    const first = await run("BACKFILL", "2026-10-01", "2026-10-03");
    expect(first.status).toBe("COMPLETED");
    expect(table("bankTransaction")).toHaveLength(15);
    // Processed oldest → newest.
    const order = table("bankStatement").map((s) => (s.periodEnd as Date).toISOString().slice(0, 10));
    expect(order).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    const second = await run("BACKFILL", "2026-10-01", "2026-10-03");
    expect(second.transactionsCreated).toBe(0);
    expect(table("bankTransaction")).toHaveLength(15);
  });

  it("a re-sent statement (same PDF, new e-mail) is a DUPLICATE and imports nothing", async () => {
    addStatement("2026-10-06", rowsOn("2026-10-06", 3, 1_00_000_00), { jobkey: "a", pdfKey: "same" });
    await run("MANUAL");
    h.messages.push({ id: "msg-b", subject: subjectFor("2026-10-06"), jobkey: "b", receivedAt: new Date() });
    h.pdfFor.b = "same";
    await run("MANUAL");
    const statuses = table("bankStatement").map((s) => s.status);
    expect(statuses).toEqual(["PROCESSED", "DUPLICATE"]);
    expect(table("bankTransaction")).toHaveLength(3);
  });

  it("one failing day does not stop the rest of a backfill", async () => {
    addStatement("2026-10-01", rowsOn("2026-10-01", 2, 1_00_000_00));
    addStatement("2026-10-02", rowsOn("2026-10-02", 2, 1_00_000_00), { behaviour: "changed" });
    addStatement("2026-10-03", rowsOn("2026-10-03", 2, 1_00_000_00));
    const r = await run("BACKFILL", "2026-10-01", "2026-10-03");
    expect(r.status).toBe("COMPLETED_WITH_ERRORS");
    expect(table("bankStatement").map((s) => s.status)).toEqual(["PROCESSED", "FAILED", "PROCESSED"]);
    expect(table("bankTransaction")).toHaveLength(4);
  });

  it("TEST 5: a wrong password stops at MANUAL_ACTION_REQUIRED, alerts, and is never retried on its own", async () => {
    addStatement("2026-10-06", rowsOn("2026-10-06", 3, 1_00_000_00), { behaviour: "badpw" });
    await run("MANUAL");
    const [s] = table("bankStatement");
    expect(s.status).toBe("MANUAL_ACTION_REQUIRED");
    expect(s.lastErrorCode).toBe("PASSWORD_REJECTED");
    expect(s.nextAttemptAt).toBeNull();
    expect(h.alerts.some((a) => /needs action/.test(a.title))).toBe(true);
    expect(JSON.stringify(h.alerts)).not.toContain("Test@1234");
    await run("SCHEDULED");
    expect(h.downloads).toBe(1); // no retry loop
  });

  it("TEST 6: a changed bank page fails safely — nothing imported, failure logged, admin alerted", async () => {
    addStatement("2026-10-06", rowsOn("2026-10-06", 3, 1_00_000_00), { behaviour: "changed" });
    await run("MANUAL");
    expect(table("bankStatement")[0].status).toBe("FAILED");
    expect(table("bankTransaction")).toHaveLength(0);
    expect(table("bankAutomationEvent").some((e) => e.level === "error")).toBe(true);
    expect(h.alerts.some((a) => /failed/.test(a.title))).toBe(true);
  });

  it("TEST 7: CAPTCHA / MFA is never bypassed — MANUAL_ACTION_REQUIRED", async () => {
    addStatement("2026-10-06", rowsOn("2026-10-06", 3, 1_00_000_00), { behaviour: "captcha" });
    await run("MANUAL");
    expect(table("bankStatement")[0]).toMatchObject({ status: "MANUAL_ACTION_REQUIRED", lastErrorCode: "CAPTCHA_OR_MFA" });
  });

  it("TEST 8: suspicious extraction is held for REVIEW_REQUIRED, not imported — until approved", async () => {
    const rows: FixtureRow[] = [
      { date: "06/10/26", narration: ["UPI-A"], debit: "100.00", balance: "99,900.00" },
      { date: "06/10/26", narration: ["UPI-B"], debit: "100.00", balance: "99,700.00" }, // balance does not chain
    ];
    addStatement("2026-10-06", rows);
    const r = await run("MANUAL");
    const [s] = table("bankStatement");
    expect(s.status).toBe("REVIEW_REQUIRED");
    expect(table("bankTransaction")).toHaveLength(0);
    expect(r.status).toBe("COMPLETED_WITH_ERRORS");
    expect(h.alerts.some((a) => /needs review/.test(a.title))).toBe(true);

    const res = await reviewStatement(s.id as string, "approve", "user-1", "checked against net banking");
    expect(res.inserted).toBe(2);
    expect(table("bankStatement")[0].status).toBe("PROCESSED");
  });

  it("a network error backs off and retries, then completes", async () => {
    addStatement("2026-10-06", rowsOn("2026-10-06", 3, 1_00_000_00), { behaviour: "net-once" });
    const r1 = await run("MANUAL");
    const [s] = table("bankStatement");
    expect(s.status).toBe("EMAIL_FOUND");
    expect(s.nextAttemptAt).toBeInstanceOf(Date);
    expect(r1.status).toBe("RUNNING"); // waiting out the backoff
    s.nextAttemptAt = new Date(Date.now() - 1000); // time passes
    await advanceRun(r1.id as string, DEADLINE());
    expect(table("bankStatement")[0].status).toBe("PROCESSED");
    expect(table("bankStatementRun").find((x) => x.id === r1.id)!.status).toBe("COMPLETED");
  });

  it("test mode previews the statement and writes nothing", async () => {
    addStatement("2026-10-06", rowsOn("2026-10-06", 4, 1_00_000_00));
    const r = await run("TEST");
    expect(r.status).toBe("COMPLETED");
    const result = r.testResult as { steps: Array<{ ok: boolean }>; preview: { transactions: number } };
    expect(result.steps.every((x) => x.ok)).toBe(true);
    expect(result.preview.transactions).toBe(4);
    expect(table("bankStatement")).toHaveLength(0);
    expect(table("bankTransaction")).toHaveLength(0);
  });

  it("Run Now while a run is active returns the existing run instead of starting a second", async () => {
    const a = await createRun({ integrationId, trigger: "MANUAL" });
    const b = await createRun({ integrationId, trigger: "SCHEDULED" });
    expect(b).toEqual({ runId: a.runId, existing: true });
  });
});

describe("manual upload → consolidated statement", () => {
  const pdf = (key: string) => new Uint8Array(Buffer.from(`%PDF-1.4 ${key}`));
  /** 10 chained rows: 7 on 5 Oct, 3 on 6 Oct, account ending 5678. */
  function overlapping() {
    const all = generateRows(10, 2_00_000_00).map((r, i) => ({ ...r, date: i < 7 ? "05/10/26" : "06/10/26" }));
    h.items.month = hdfcFixture({ account: "50100000005678", rows: all, from: "05/10/2026", to: "06/10/2026" });
    h.items.day = hdfcFixture({ account: "50100000005678", rows: all.slice(7), from: "06/10/2026", to: "06/10/2026" });
  }

  it("reads the account off the PDF and creates it on first upload", async () => {
    overlapping();
    const r = await importUploadedPdf(pdf("month"), "user-1");
    expect(r).toMatchObject({ createdAccount: true, status: "PROCESSED", inserted: 10, duplicates: 0, periodStart: "2026-10-05", periodEnd: "2026-10-06" });
    const acct = table("bankIntegration").find((i) => i.accountLastFour === "5678")!;
    expect(acct.automationEnabled).toBe(false);
    expect(r.integrationId).toBe(acct.id);
  });

  it("uploading the same file again adds nothing", async () => {
    overlapping();
    await importUploadedPdf(pdf("month"), "user-1");
    const again = await importUploadedPdf(pdf("month"), "user-1");
    expect(again).toMatchObject({ duplicate: true, inserted: 0, createdAccount: false });
    expect(table("bankTransaction")).toHaveLength(10);
  });

  it("a daily statement inside an already-uploaded monthly one adds zero rows", async () => {
    overlapping();
    await importUploadedPdf(pdf("month"), "user-1");
    const daily = await importUploadedPdf(pdf("day"), "user-1");
    expect(daily).toMatchObject({ duplicate: false, status: "PROCESSED", inserted: 0, duplicates: 3 });
    expect(table("bankTransaction")).toHaveLength(10);
  });

  it("and the other way round: the monthly adds only the days the daily did not have", async () => {
    overlapping();
    expect((await importUploadedPdf(pdf("day"), "user-1")).inserted).toBe(3);
    expect(await importUploadedPdf(pdf("month"), "user-1")).toMatchObject({ inserted: 7, duplicates: 3 });
    expect(table("bankTransaction")).toHaveLength(10);
    expect(table("bankIntegration").filter((i) => i.accountLastFour === "5678")).toHaveLength(1);
  });

  it("refuses an unreadable PDF without creating anything", async () => {
    h.items.junk = [{ str: "Not a bank statement", x: 10, y: 10, w: 80, page: 1 }];
    await expect(importUploadedPdf(pdf("junk"), "user-1")).rejects.toMatchObject({ code: "PARSE_FAILED" });
    expect(table("bankStatement")).toHaveLength(0);
  });
});

