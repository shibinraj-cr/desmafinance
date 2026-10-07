/**
 * TEST 9: Google Sheets sync appends each transaction exactly once — rows
 * already in the sheet (by Transaction Hash) are skipped even if DesGro lost
 * its own "synced" stamp, and a second sync appends nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("./helpers/fake-prisma");
  h.db = createFakePrisma();
  return { prisma: h.db };
});
vi.mock("@/lib/bank/gmail", () => ({
  SHEETS_SCOPE: "https://www.googleapis.com/auth/spreadsheets",
  gmailAccessToken: async () => "token",
}));

import { syncIntegrationToSheet } from "@/lib/bank/sheets";
import { seal } from "@/lib/bank/secrets";

/** A fake Sheets API holding one tab. */
function fakeSheets() {
  const sheet: string[][] = [];
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = decodeURIComponent(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes("fields=sheets.properties.title")) return json({ sheets: [{ properties: { title: "Bank Transactions" } }] });
    if (u.includes("!A1:L1") && (init?.method ?? "GET") === "GET") return json({ values: sheet.length ? [sheet[0]] : [] });
    if (u.includes("!A1:L1") && init?.method === "PUT") {
      sheet[0] = (JSON.parse(String(init.body)) as { values: string[][] }).values[0];
      return json({});
    }
    if (u.includes("!L:L")) return json({ values: sheet.map((r) => [r[11]]) });
    if (u.includes(":append")) {
      sheet.push(...(JSON.parse(String(init!.body)) as { values: string[][] }).values);
      return json({});
    }
    return new Response("{}", { status: 404 });
  });
  return { sheet, calls, fetchMock };
}

let integrationId = "";
beforeEach(async () => {
  for (const k of Object.keys(h.db._tables)) delete h.db._tables[k];
  process.env.NEXTAUTH_SECRET = "sheets-test";
  const mb = await h.db.bankMailboxConnection.create({
    data: { emailAddress: "a@x.in", refreshTokenEnc: seal("r", "gmail-refresh-token"), scope: "gmail.readonly https://www.googleapis.com/auth/spreadsheets" },
  });
  const i = await h.db.bankIntegration.create({
    data: { bankCode: "HDFC", accountLastFour: "1234", sheetSyncEnabled: true, sheetId: "sheet-id-0123456789abcdefghij", sheetTab: "Bank Transactions", mailboxConnectionId: mb.id },
  });
  integrationId = i.id;
  for (let k = 0; k < 3; k++) {
    await h.db.bankTransaction.create({
      data: {
        integrationId,
        statementId: "s1",
        rowIndex: k,
        txnDate: new Date(`2026-10-0${k + 1}T00:00:00Z`),
        valueDate: null,
        description: `UPI-${k}`,
        referenceNumber: null,
        chequeNumber: null,
        debitAmount: { toString: () => "10.00" },
        creditAmount: { toString: () => "0.00" },
        runningBalance: null,
        statementDate: null,
        gmailMessageId: "m1",
        sourceSubject: "subj",
        transactionHash: `hash-${k}`,
        sheetSyncedAt: null,
      },
    });
  }
});

describe("Google Sheets sync", () => {
  it("writes a header, appends each row once, and a second sync appends nothing", async () => {
    const s = fakeSheets();
    vi.stubGlobal("fetch", s.fetchMock);
    expect(await syncIntegrationToSheet(integrationId)).toEqual({ appended: 3, alreadyPresent: 0 });
    expect(s.sheet[0][11]).toBe("Transaction Hash");
    expect(s.sheet).toHaveLength(4);
    expect(await syncIntegrationToSheet(integrationId)).toEqual({ appended: 0, alreadyPresent: 0 });
    expect(s.sheet).toHaveLength(4);
  });

  it("skips rows the sheet already holds even when DesGro's synced stamp was lost", async () => {
    const s = fakeSheets();
    vi.stubGlobal("fetch", s.fetchMock);
    await syncIntegrationToSheet(integrationId);
    // Simulate a lost stamp: every row looks unsynced again.
    for (const t of h.db._tables.bankTransaction) t.sheetSyncedAt = null;
    expect(await syncIntegrationToSheet(integrationId)).toEqual({ appended: 0, alreadyPresent: 3 });
    expect(s.sheet).toHaveLength(4);
  });
});
