import { prisma } from "@/lib/prisma";
import { fromPrismaDate } from "@/lib/lead-pulse-dates";
import { BankAutomationError } from "./errors";
import { SHEETS_SCOPE, gmailAccessToken } from "./gmail";
import { redact, unseal } from "./secrets";

/**
 * Optional one-way export of imported transactions to a Google Sheet. The
 * DesGro database stays the source of truth; the sheet is a reporting copy.
 *
 * Idempotent twice over: before appending, every Transaction Hash already in
 * the sheet's hash column is read, so a row is never appended twice — even if
 * `sheetSyncedAt` was lost or someone re-pasted the sheet — and rows that do
 * go in are stamped `sheetSyncedAt`.
 */

export const SHEET_HEADER = [
  "Txn Date",
  "Value Date",
  "Description",
  "Reference / Cheque No.",
  "Debit",
  "Credit",
  "Balance",
  "Statement Date",
  "Gmail Message ID",
  "Source Subject",
  "DESGRO Transaction ID",
  "Transaction Hash",
];
const HASH_COL = "L";
const BATCH = 500;

async function sheetsFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch (e) {
    throw new BankAutomationError("NETWORK", `Sheets API unreachable: ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new BankAutomationError(
      res.status === 401 || res.status === 403 ? "GMAIL_AUTH" : "GMAIL_ERROR",
      json.error?.message || `Sheets API returned ${res.status}`,
    );
  }
  return json;
}

function q(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

export type SheetSyncResult = { appended: number; alreadyPresent: number };

export async function syncIntegrationToSheet(integrationId: string): Promise<SheetSyncResult> {
  const integration = await prisma.bankIntegration.findUnique({
    where: { id: integrationId },
    select: {
      id: true,
      sheetSyncEnabled: true,
      sheetId: true,
      sheetTab: true,
      mailbox: { select: { refreshTokenEnc: true, scope: true } },
    },
  });
  if (!integration?.sheetSyncEnabled) return { appended: 0, alreadyPresent: 0 };
  try {
    if (!integration.sheetId) throw new BankAutomationError("CONFIG", "No Google Sheet ID configured");
    if (!integration.mailbox) throw new BankAutomationError("CONFIG", "Connect the Google account first");
    if (!(integration.mailbox.scope ?? "").includes(SHEETS_SCOPE)) {
      throw new BankAutomationError("CONFIG", "The Google connection has no Sheets access — reconnect with Sheets sync ticked");
    }
    const token = await gmailAccessToken(unseal(integration.mailbox.refreshTokenEnc, "gmail-refresh-token"));
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(integration.sheetId)}`;
    const tab = integration.sheetTab || "Bank Transactions";

    // Make sure the tab exists, with the header row.
    const meta = await sheetsFetch<{ sheets?: Array<{ properties?: { title?: string } }> }>(
      `${base}?fields=sheets.properties.title`,
      token,
    );
    if (!meta.sheets?.some((s) => s.properties?.title === tab)) {
      await sheetsFetch(`${base}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
      });
    }
    const head = await sheetsFetch<{ values?: string[][] }>(`${base}/values/${encodeURIComponent(`${q(tab)}!A1:L1`)}`, token);
    if (!head.values?.[0]?.length) {
      await sheetsFetch(`${base}/values/${encodeURIComponent(`${q(tab)}!A1:L1`)}?valueInputOption=RAW`, token, {
        method: "PUT",
        body: JSON.stringify({ values: [SHEET_HEADER] }),
      });
    }

    const col = await sheetsFetch<{ values?: string[][] }>(
      `${base}/values/${encodeURIComponent(`${q(tab)}!${HASH_COL}:${HASH_COL}`)}`,
      token,
    );
    const present = new Set((col.values ?? []).map((r) => r[0]).filter(Boolean));

    let appended = 0;
    let alreadyPresent = 0;
    for (;;) {
      const rows = await prisma.bankTransaction.findMany({
        where: { integrationId, sheetSyncedAt: null },
        orderBy: [{ txnDate: "asc" }, { rowIndex: "asc" }],
        take: BATCH,
        select: {
          id: true,
          txnDate: true,
          valueDate: true,
          description: true,
          referenceNumber: true,
          chequeNumber: true,
          debitAmount: true,
          creditAmount: true,
          runningBalance: true,
          statementDate: true,
          gmailMessageId: true,
          sourceSubject: true,
          transactionHash: true,
        },
      });
      if (rows.length === 0) break;
      const fresh = rows.filter((r) => !present.has(r.transactionHash));
      alreadyPresent += rows.length - fresh.length;
      if (fresh.length) {
        await sheetsFetch(
          `${base}/values/${encodeURIComponent(`${q(tab)}!A:L`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          token,
          {
            method: "POST",
            body: JSON.stringify({
              values: fresh.map((r) => [
                fromPrismaDate(r.txnDate),
                r.valueDate ? fromPrismaDate(r.valueDate) : "",
                r.description,
                r.chequeNumber ?? r.referenceNumber ?? "",
                Number(r.debitAmount.toString()) || "",
                Number(r.creditAmount.toString()) || "",
                r.runningBalance === null ? "" : Number(r.runningBalance.toString()),
                r.statementDate ? fromPrismaDate(r.statementDate) : "",
                r.gmailMessageId ?? "",
                r.sourceSubject ?? "",
                r.id,
                r.transactionHash,
              ]),
            }),
          },
        );
        fresh.forEach((r) => present.add(r.transactionHash));
        appended += fresh.length;
      }
      await prisma.bankTransaction.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { sheetSyncedAt: new Date() },
      });
      if (rows.length < BATCH) break;
    }
    await prisma.bankIntegration.update({
      where: { id: integrationId },
      data: { lastSheetSyncAt: new Date(), lastSheetSyncError: null },
    });
    return { appended, alreadyPresent };
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e));
    await prisma.bankIntegration.update({ where: { id: integrationId }, data: { lastSheetSyncError: msg } }).catch(() => undefined);
    throw e;
  }
}
