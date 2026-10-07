import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { addDays, fromPrismaDate, toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import { BankAutomationError, ERROR_LABEL, retryDecision, toBankError, type BankErrorCode } from "./errors";
import { logEvent } from "./events";
import { notifyBankAlert } from "./notify";
import { redact, seal, unseal } from "./secrets";
import {
  extractStatementUrl,
  gmailQuery,
  matchesIntegration,
  parseSubjectPeriod,
  resolveSubjectPattern,
} from "./email-parse";
import { getAttachment, getMessage, gmailAccessToken, gmailProfileEmail, searchMessageIds, type StatementMessage } from "./gmail";
import { downloaderFor } from "./downloaders";
import { assertLooksLikePdf, extractTextItems } from "./pdf";
import { parserFor } from "./parsers";
import type { ParsedRow, ParsedStatement } from "./parsers/base";
import { validateStatement } from "./validate";
import { sha256Hex } from "./hash";
import { importRows } from "./import";
import { archivePdf, isArchiveConfigured, readArchivedPdf, statementBlobPath, statementFileName } from "./storage";
import { getStatementPassword, maskedAccount } from "./integration";
import { isScheduledRunDue, missedBusinessDays } from "./schedule";
import { syncIntegrationToSheet } from "./sheets";
import { fromDecimal, paiseToRupees, toDecimalString } from "./money";
import { BANK_PAGE } from "./constants";

/**
 * Bank Statement Automation's job runner.
 *
 * There is no Redis/queue in this deployment, so the database is the queue:
 * a BankStatementRun is the job, its BankStatement rows are the work items,
 * and both carry a `lockedUntil` lease so two workers (the 5-minute cron and a
 * "Run Now" continuing in the background) can never process the same thing.
 * Every step is idempotent — re-running any of it converges on the same rows.
 *
 * One statement is processed at a time inside a time budget; whatever does not
 * fit stays queued and the next worker picks it up. That is what lets a
 * month-long backfill run inside 300-second serverless functions.
 */

const LEASE_MS = 6 * 60_000;
/** Don't start a statement with less than this left — a browser download can take ~2 minutes. */
const STATEMENT_BUDGET_MS = 140_000;

export const RUN_ACTIVE = ["QUEUED", "RUNNING"] as const;
const PENDING_STATUSES = ["NEW", "EMAIL_FOUND", "PDF_DOWNLOADED"];
const IN_FLIGHT_STATUSES = ["DOWNLOADING", "PARSING"];
const OPEN_STATUSES = [...PENDING_STATUSES, ...IN_FLIGHT_STATUSES];
/** Statement states that mean "this e-mail is dealt with" — the Level-1 duplicate guard. */
const SETTLED_STATUSES = ["PROCESSED", "NO_TRANSACTIONS", "DUPLICATE", "REVIEW_REQUIRED"];
const FAILURE_STATUSES = ["FAILED", "MANUAL_ACTION_REQUIRED", "REVIEW_REQUIRED"];

export type RunTrigger = "SCHEDULED" | "MANUAL" | "BACKFILL" | "RETRY" | "TEST";

type Integration = Prisma.BankIntegrationGetPayload<{ include: { mailbox: true } }>;

function label(i: { bankName: string; accountLastFour: string }): string {
  return `${i.bankName.replace(/ Bank$/i, "")} ${maskedAccount(i.accountLastFour)}`;
}

function istDay(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

function fmtDay(iso: string | null): string {
  if (!iso) return "undated";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}-${y}`;
}

// ─── Runs ───────────────────────────────────────────────────────────────────

export async function createRun(opts: {
  integrationId: string;
  trigger: RunTrigger;
  userId?: string | null;
  fromDate?: string;
  toDate?: string;
}): Promise<{ runId: string; existing: boolean }> {
  if (opts.trigger !== "TEST") {
    const active = await prisma.bankStatementRun.findFirst({
      where: { integrationId: opts.integrationId, status: { in: [...RUN_ACTIVE] }, trigger: { not: "TEST" } },
      select: { id: true },
    });
    if (active) return { runId: active.id, existing: true };
  }
  const run = await prisma.bankStatementRun.create({
    data: {
      integrationId: opts.integrationId,
      trigger: opts.trigger,
      status: "QUEUED",
      phase: "Queued",
      fromDate: opts.fromDate ? toPrismaDate(opts.fromDate) : null,
      toDate: opts.toDate ? toPrismaDate(opts.toDate) : null,
      initiatedById: opts.userId ?? null,
    },
  });
  await logEvent({
    integrationId: opts.integrationId,
    runId: run.id,
    step: "run",
    message:
      opts.trigger === "BACKFILL"
        ? `Backfill queued for ${fmtDay(opts.fromDate ?? null)} → ${fmtDay(opts.toDate ?? null)}`
        : `${opts.trigger.toLowerCase()} run queued`,
    userId: opts.userId,
  });
  return { runId: run.id, existing: false };
}

/** Lease a run for this worker. Null when another worker holds it or it is finished. */
async function claimRun(runId: string) {
  const now = new Date();
  const { count } = await prisma.bankStatementRun.updateMany({
    where: {
      id: runId,
      status: { in: [...RUN_ACTIVE] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { status: "RUNNING", lockedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (!count) return null;
  const run = await prisma.bankStatementRun.findUniqueOrThrow({ where: { id: runId } });
  if (!run.startedAt) await prisma.bankStatementRun.update({ where: { id: runId }, data: { startedAt: now } });
  return run;
}

async function setPhase(runId: string, phase: string) {
  await prisma.bankStatementRun.update({
    where: { id: runId },
    data: { phase, lockedUntil: new Date(Date.now() + LEASE_MS) },
  });
}

/**
 * Advance one run as far as the deadline allows. Safe to call from anywhere,
 * any number of times — a run already leased elsewhere is left alone.
 */
export async function advanceRun(runId: string, deadline: number): Promise<void> {
  const run = await claimRun(runId);
  if (!run) return;
  const integration = await prisma.bankIntegration.findUnique({ where: { id: run.integrationId }, include: { mailbox: true } });
  if (!integration) {
    await prisma.bankStatementRun.update({
      where: { id: runId },
      data: { status: "FAILED", errorSummary: "Integration deleted", completedAt: new Date(), lockedUntil: null },
    });
    return;
  }
  try {
    if (run.trigger === "TEST") {
      await runTest(run.id, integration);
      return;
    }
    if (!run.discoveredAt) {
      await setPhase(run.id, "Checking Gmail…");
      await discover(run, integration);
    }
    const seen = new Set<string>();
    while (Date.now() + STATEMENT_BUDGET_MS < deadline) {
      const next = await nextPendingStatement(run.id, seen);
      if (!next) break;
      seen.add(next.id);
      await processStatement(next.id, integration, run.id);
    }
    await finalizeRun(run.id, integration);
  } catch (e) {
    const err = toBankError(e);
    const message = redact(err.message);
    await logEvent({ integrationId: integration.id, runId: run.id, level: "error", step: "run", message });
    await prisma.bankStatementRun.update({
      where: { id: run.id },
      data: { status: "FAILED", phase: ERROR_LABEL[err.code], errorSummary: message, completedAt: new Date() },
    });
    if (err.code === "GMAIL_AUTH") {
      if (integration.mailboxConnectionId) {
        await prisma.bankMailboxConnection
          .update({ where: { id: integration.mailboxConnectionId }, data: { lastError: message } })
          .catch(() => undefined);
      }
      await notifyBankAlert({
        title: `${label(integration)}: Gmail disconnected`,
        body: "The statement mailbox can no longer be read. Reconnect Gmail on the Automation tab.",
        link: `${BANK_PAGE}?tab=automation`,
      });
    } else if (run.trigger === "SCHEDULED") {
      await notifyBankAlert({
        title: `${label(integration)} statement check failed`,
        body: `Reason: ${ERROR_LABEL[err.code]}.`,
        link: `${BANK_PAGE}?tab=automation`,
      });
    }
  } finally {
    await prisma.bankStatementRun.updateMany({ where: { id: runId }, data: { lockedUntil: null } });
  }
}

async function nextPendingStatement(runId: string, skip: Set<string>) {
  const now = new Date();
  return prisma.bankStatement.findFirst({
    where: {
      runId,
      id: { notIn: Array.from(skip) },
      OR: [
        {
          status: { in: PENDING_STATUSES },
          AND: [
            { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
            { OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
          ],
        },
        // A worker died mid-statement: its lease has lapsed, pick it up again.
        { status: { in: IN_FLIGHT_STATUSES }, lockedUntil: { lt: now } },
      ],
    },
    orderBy: [{ periodStart: "asc" }, { gmailReceivedAt: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
}

async function finalizeRun(runId: string, integration: Integration) {
  const stmts = await prisma.bankStatement.findMany({
    where: { runId },
    select: { status: true, insertedCount: true, duplicateCount: true, transactionCount: true, nextAttemptAt: true },
  });
  const open = stmts.filter((s) => OPEN_STATUSES.includes(s.status));
  if (open.length) {
    const waiting = open.every((s) => s.nextAttemptAt && s.nextAttemptAt > new Date());
    await prisma.bankStatementRun.update({
      where: { id: runId },
      data: {
        status: "RUNNING",
        phase: waiting ? "Waiting to retry…" : `${open.length} statement${open.length === 1 ? "" : "s"} still to process`,
      },
    });
    return;
  }
  const processed = stmts.filter((s) => s.status === "PROCESSED" || s.status === "NO_TRANSACTIONS").length;
  const failed = stmts.filter((s) => FAILURE_STATUSES.includes(s.status)).length;
  const created = stmts.reduce((n, s) => n + (s.insertedCount ?? 0), 0);
  const skipped = stmts.reduce((n, s) => n + (s.duplicateCount ?? 0), 0);
  const held = stmts
    .filter((s) => s.status === "REVIEW_REQUIRED")
    .reduce((n, s) => n + (s.transactionCount ?? 0), 0);
  const run = await prisma.bankStatementRun.findUniqueOrThrow({ where: { id: runId } });

  const status = stmts.length === 0 ? "NO_NEW" : failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  const phase =
    stmts.length === 0
      ? run.transactionsSkipped || run.gmailMessagesFound
        ? "No new statement found (already imported)"
        : "No new statement found"
      : `Imported ${created} transaction${created === 1 ? "" : "s"}${skipped ? `, ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped` : ""}${failed ? ` · ${failed} statement${failed === 1 ? "" : "s"} need attention` : ""}`;
  await prisma.bankStatementRun.update({
    where: { id: runId },
    data: {
      status,
      phase,
      completedAt: new Date(),
      statementsProcessed: processed,
      statementsFailed: failed,
      transactionsCreated: created,
      transactionsSkipped: skipped,
      transactionsFailed: held,
      errorSummary: failed ? `${failed} statement(s) failed or need review` : null,
    },
  });
  await logEvent({ integrationId: integration.id, runId, step: "run", message: `Run finished — ${phase}` });
}

// ─── Discovery ──────────────────────────────────────────────────────────────

async function mailboxToken(integration: Integration): Promise<string> {
  if (!integration.mailbox) throw new BankAutomationError("CONFIG", "No Gmail mailbox is connected");
  let refresh: string;
  try {
    refresh = unseal(integration.mailbox.refreshTokenEnc, "gmail-refresh-token");
  } catch {
    throw new BankAutomationError("GMAIL_AUTH", "The stored Gmail credential can no longer be decrypted — reconnect");
  }
  return gmailAccessToken(refresh);
}

/** Matching messages in a window, oldest first. */
async function findStatementMessages(
  integration: Integration,
  token: string,
  window: { after: string; before: string },
): Promise<StatementMessage[]> {
  const subject = resolveSubjectPattern(integration.emailSubjectPattern, integration.accountLastFour);
  const q = gmailQuery({ sender: integration.emailSender, subject, afterIso: window.after, beforeIso: window.before });
  const ids = await searchMessageIds(token, q);
  const out: StatementMessage[] = [];
  for (const id of ids) {
    const m = await getMessage(token, id);
    if (
      matchesIntegration(
        { from: m.from, subject: m.subject },
        { sender: integration.emailSender, subjectPattern: integration.emailSubjectPattern, last4: integration.accountLastFour },
      )
    ) {
      out.push(m);
    }
  }
  return out.sort((a, b) => {
    const pa = parseSubjectPeriod(a.subject)?.start ?? "";
    const pb = parseSubjectPeriod(b.subject)?.start ?? "";
    return pa.localeCompare(pb) || a.receivedAt.getTime() - b.receivedAt.getTime();
  });
}

async function discover(run: { id: string; trigger: string; fromDate: Date | null; toDate: Date | null }, integration: Integration) {
  const today = todayIst();
  const token = await mailboxToken(integration);
  await logEvent({ integrationId: integration.id, runId: run.id, step: "gmail", message: "Connected to Gmail" });

  const from = run.fromDate ? fromPrismaDate(run.fromDate) : null;
  const to = run.toDate ? fromPrismaDate(run.toDate) : null;
  // Gmail's after/before are day-granular in the mailbox's zone: pad a day
  // each side and let the subject period make the exact call. A statement for
  // day D arrives on D or D+1 (later if the bank is slow), hence +3 on a backfill.
  const window =
    run.trigger === "BACKFILL" && from && to
      ? { after: addDays(from, -1), before: addDays(to, 4) }
      : { after: addDays(today, -Math.max(1, integration.lookbackDays)), before: addDays(today, 1) };

  let messages = await findStatementMessages(integration, token, window);
  if (run.trigger === "BACKFILL" && from && to) {
    messages = messages.filter((m) => {
      const p = parseSubjectPeriod(m.subject);
      const start = p?.start ?? istDay(m.receivedAt);
      const end = p?.end ?? start;
      return end >= from && start <= to;
    });
  }

  let created = 0;
  let alreadyDone = 0;
  let latestReceived: Date | null = null;
  for (const m of messages) {
    if (!latestReceived || m.receivedAt > latestReceived) latestReceived = m.receivedAt;
    const existing = await prisma.bankStatement.findUnique({
      where: { integrationId_gmailMessageId: { integrationId: integration.id, gmailMessageId: m.id } },
      select: { id: true, status: true, runId: true, run: { select: { status: true } } },
    });
    if (existing) {
      // Level 1 duplicate guard: this Gmail message id has been seen before.
      if (SETTLED_STATUSES.includes(existing.status)) {
        alreadyDone++;
      } else if (OPEN_STATUSES.includes(existing.status) && (!existing.run || !RUN_ACTIVE.includes(existing.run.status as never))) {
        // Orphaned by a run that ended abnormally — adopt it.
        await prisma.bankStatement.update({ where: { id: existing.id }, data: { runId: run.id } });
        created++;
      }
      continue;
    }

    const period = parseSubjectPeriod(m.subject);
    const url = extractStatementUrl(m.bodies, integration.bankCode);
    const noSource = !url && !m.attachment;
    try {
      const stmt = await prisma.bankStatement.create({
        data: {
          integrationId: integration.id,
          runId: run.id,
          source: "gmail",
          gmailMessageId: m.id,
          gmailReceivedAt: m.receivedAt,
          sourceSubject: m.subject.slice(0, 500),
          statementUrlEnc: url ? seal(url, "statement-url") : null,
          attachmentId: m.attachment?.attachmentId ?? null,
          periodStart: period ? toPrismaDate(period.start) : null,
          periodEnd: period ? toPrismaDate(period.end) : null,
          status: noSource ? "FAILED" : "EMAIL_FOUND",
          lastErrorCode: noSource ? "PAGE_CHANGED" : null,
          lastError: noSource ? "The e-mail has neither a statement link nor a PDF attachment" : null,
        },
      });
      created++;
      await logEvent({
        integrationId: integration.id,
        runId: run.id,
        statementId: stmt.id,
        step: "email",
        message: `Email found — statement ${period ? `${fmtDay(period.start)} → ${fmtDay(period.end)}` : "(no period in subject)"}`,
      });
      await logEvent({
        integrationId: integration.id,
        runId: run.id,
        statementId: stmt.id,
        level: noSource ? "error" : "info",
        step: "email",
        message: url ? "SmartStatement URL extracted" : m.attachment ? "PDF attachment found" : "No statement link or attachment in the e-mail",
      });
      if (noSource) {
        await notifyBankAlert({
          title: `${label(integration)} statement e-mail changed`,
          body: `Statement: ${fmtDay(period?.end ?? null)}. Reason: the e-mail has no statement link or attachment.`,
        });
      }
    } catch (e) {
      // Unique (integration, message id): a concurrent worker created it first.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      alreadyDone++;
    }
  }

  await prisma.bankStatementRun.update({
    where: { id: run.id },
    data: {
      discoveredAt: new Date(),
      gmailMessagesFound: messages.length,
      transactionsSkipped: 0,
      phase: created ? `Statement${created === 1 ? "" : "s"} found (${created})` : "No new statement found",
    },
  });
  await prisma.bankIntegration.update({
    where: { id: integration.id },
    data: {
      lastEmailCheckedAt: new Date(),
      ...(latestReceived && (!integration.lastStatementReceivedAt || latestReceived > integration.lastStatementReceivedAt)
        ? { lastStatementReceivedAt: latestReceived }
        : {}),
    },
  });
  if (integration.mailboxConnectionId) {
    await prisma.bankMailboxConnection.update({
      where: { id: integration.mailboxConnectionId },
      data: { lastCheckedAt: new Date(), lastError: null },
    });
  }
  await logEvent({
    integrationId: integration.id,
    runId: run.id,
    step: "gmail",
    message: `${messages.length} matching e-mail${messages.length === 1 ? "" : "s"} · ${created} new · ${alreadyDone} already processed`,
  });
}

// ─── One statement ──────────────────────────────────────────────────────────

/** Fetch, archive, parse, validate and import one statement. Never throws. */
export async function processStatement(statementId: string, integration: Integration, runId: string | null): Promise<void> {
  const now = new Date();
  const { count } = await prisma.bankStatement.updateMany({
    where: { id: statementId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  });
  if (!count) return;
  const s = await prisma.bankStatement.findUniqueOrThrow({ where: { id: statementId } });
  const periodStart = s.periodStart ? fromPrismaDate(s.periodStart) : null;
  const periodEnd = s.periodEnd ? fromPrismaDate(s.periodEnd) : null;
  const ev = (step: string, message: string, level: "info" | "warn" | "error" = "info") =>
    logEvent({ integrationId: integration.id, runId, statementId, step, message, level, secrets: [password] });
  const phase = (p: string) => (runId ? setPhase(runId, `${fmtDay(periodEnd)}: ${p}`) : Promise.resolve());

  let password: string | null = null;
  try {
    password = await getStatementPassword(integration);
    let pdf: Uint8Array;

    if (s.blobPathname) {
      pdf = await readArchivedPdf(s.blobPathname);
      await ev("pdf", "Re-using the archived PDF");
    } else {
      await prisma.bankStatement.update({ where: { id: s.id }, data: { status: "DOWNLOADING" } });
      if (s.attachmentId && s.gmailMessageId) {
        await phase("Downloading PDF attachment…");
        pdf = await getAttachment(await mailboxToken(integration), s.gmailMessageId, s.attachmentId);
        await ev("download", "PDF attachment downloaded from Gmail");
      } else if (s.statementUrlEnc) {
        if (!integration.browserAutomationEnabled) {
          throw new BankAutomationError("CONFIG", "Browser automation is switched off — upload this statement's PDF by hand");
        }
        if (!password) throw new BankAutomationError("CONFIG", "The statement password is not configured");
        await phase(`Opening ${integration.bankName} statement…`);
        const url = unseal(s.statementUrlEnc, "statement-url");
        const result = await downloaderFor(integration.bankCode).download(url, password, {
          log: (step, message) => void ev(step, message),
          screenshot: integration.failureScreenshots && isArchiveConfigured()
            ? async (png) => {
                const { put } = await import("@vercel/blob");
                const path = `bank-statements/_diagnostics/${s.id}-${Date.now()}.png`;
                await put(path, Buffer.from(png), { access: "private", contentType: "image/png", addRandomSuffix: false });
                await ev("diagnostics", `Failure screenshot saved privately (${path})`, "warn");
              }
            : undefined,
        });
        pdf = result.pdf;
      } else {
        throw new BankAutomationError("PAGE_CHANGED", "The e-mail has neither a statement link nor a PDF attachment");
      }

      await phase("Validating PDF…");
      assertLooksLikePdf(pdf);
      const sha = sha256Hex(pdf);
      const dup = await prisma.bankStatement.findFirst({
        where: { integrationId: integration.id, fileSha256: sha, id: { not: s.id } },
        select: { id: true, periodEnd: true },
      });
      if (dup) {
        // Level 2 duplicate guard: byte-identical PDF already imported.
        await prisma.bankStatement.update({
          where: { id: s.id },
          data: {
            status: "DUPLICATE",
            duplicateOfId: dup.id,
            lastErrorCode: null,
            lastError: `Same PDF as the statement for ${fmtDay(dup.periodEnd ? fromPrismaDate(dup.periodEnd) : null)}`,
            processedAt: new Date(),
          },
        });
        await ev("dedupe", "Duplicate statement — this exact PDF was already imported; nothing written", "warn");
        await notifyBankAlert({
          title: `${label(integration)}: duplicate statement`,
          body: `Statement ${fmtDay(periodEnd)} is the same PDF as one already imported. Nothing was imported twice.`,
        });
        return;
      }

      const fileName = statementFileName(integration.bankCode, integration.accountLastFour, periodEnd);
      let blobPathname: string | null = null;
      if (integration.pdfArchiveEnabled) {
        blobPathname = statementBlobPath({
          bankCode: integration.bankCode,
          last4: integration.accountLastFour,
          statementDate: periodEnd,
          sha256: sha,
        });
        await archivePdf(blobPathname, pdf);
      }
      try {
        await prisma.bankStatement.update({
          where: { id: s.id },
          data: { status: "PDF_DOWNLOADED", fileSha256: sha, fileName, fileSize: pdf.byteLength, blobPathname },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          await prisma.bankStatement.update({
            where: { id: s.id },
            data: { status: "DUPLICATE", lastError: "Same PDF as another statement", processedAt: new Date() },
          });
          await ev("dedupe", "Duplicate statement (concurrent import) — nothing written", "warn");
          return;
        }
        throw e;
      }
      await ev("pdf", `PDF downloaded and validated (${Math.round(pdf.byteLength / 1024)} KB)${blobPathname ? ", archived" : ", archive off"}`);
    }

    await prisma.bankStatement.update({ where: { id: s.id }, data: { status: "PARSING" } });
    await phase("Extracting transactions…");
    const { parsed, rows } = await parsePdf(pdf, password, integration.bankCode);
    await ev("parse", `${rows.length} transaction row${rows.length === 1 ? "" : "s"} identified (${parsed.strategy} parser)`);

    await phase("Validating…");
    const v = validateStatement(parsed, {
      last4: integration.accountLastFour,
      periodStart,
      periodEnd,
      today: todayIst(),
    });
    const totals = summarize(parsed, rows);
    const statementDate = periodEnd ?? parsed.periodEnd;
    const common = {
      ...totals,
      validation: { errors: v.errors, warnings: v.warnings, strategy: parsed.strategy } as Prisma.InputJsonValue,
      periodStart: s.periodStart ?? (parsed.periodStart ? toPrismaDate(parsed.periodStart) : null),
      periodEnd: s.periodEnd ?? (parsed.periodEnd ? toPrismaDate(parsed.periodEnd) : null),
      lastErrorCode: null,
      lastError: null,
      nextAttemptAt: null,
    };

    if (v.errors.length) {
      await prisma.bankStatement.update({
        where: { id: s.id },
        data: { ...common, status: "REVIEW_REQUIRED", reviewPayload: rows as unknown as Prisma.InputJsonValue, processedAt: new Date() },
      });
      await ev("validate", `Validation failed — held for review: ${v.errors.slice(0, 3).join("; ")}`, "warn");
      await notifyBankAlert({
        title: `${label(integration)} statement needs review`,
        body: `Statement: ${fmtDay(statementDate)}. Reason: ${v.errors[0]}. Nothing was imported — review and approve or reject it.`,
      });
      return;
    }
    await ev("validate", v.warnings.length ? `Validated with ${v.warnings.length} warning(s)` : "Balances and totals validated");

    const { inserted, duplicates } = await importRows(rows, {
      integrationId: integration.id,
      statementId: s.id,
      currency: integration.currency,
      statementDate,
      gmailMessageId: s.gmailMessageId,
      sourceSubject: s.sourceSubject,
    });
    await prisma.bankStatement.update({
      where: { id: s.id },
      data: {
        ...common,
        status: rows.length ? "PROCESSED" : "NO_TRANSACTIONS",
        insertedCount: inserted,
        duplicateCount: duplicates,
        reviewPayload: Prisma.DbNull,
        processedAt: new Date(),
      },
    });
    await ev("import", `${inserted} new transaction${inserted === 1 ? "" : "s"} inserted`);
    if (duplicates) await ev("import", `${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped`);
    await ev("done", "Completed");
    await afterImport(integration, statementDate);
  } catch (e) {
    await recordFailure(s.id, integration, runId, toBankError(e), password, periodEnd);
  } finally {
    await prisma.bankStatement.updateMany({ where: { id: statementId }, data: { lockedUntil: null } });
  }
}

async function parsePdf(pdf: Uint8Array, password: string | null, bankCode: string): Promise<{ parsed: ParsedStatement; rows: ParsedRow[] }> {
  const { items } = await extractTextItems(pdf, password);
  const parsed = parserFor(bankCode).parse(items);
  return { parsed, rows: parsed.rows };
}

function summarize(parsed: ParsedStatement, rows: ParsedRow[]) {
  const debit = rows.reduce((n, r) => n + r.debit, 0);
  const credit = rows.reduce((n, r) => n + r.credit, 0);
  return {
    openingBalance: parsed.openingBalance === null ? null : toDecimalString(parsed.openingBalance),
    closingBalance: parsed.closingBalance === null ? null : toDecimalString(parsed.closingBalance),
    totalDebit: toDecimalString(debit),
    totalCredit: toDecimalString(credit),
    debitCount: rows.filter((r) => r.debit > 0).length,
    creditCount: rows.filter((r) => r.credit > 0).length,
    transactionCount: rows.length,
  };
}

async function afterImport(integration: Integration, statementDate: string | null) {
  const latest = statementDate && (!integration.lastStatementDate || statementDate > fromPrismaDate(integration.lastStatementDate));
  await prisma.bankIntegration.update({
    where: { id: integration.id },
    data: {
      lastSuccessfulSyncAt: new Date(),
      ...(latest ? { lastStatementDate: toPrismaDate(statementDate!) } : {}),
    },
  });
  if (integration.sheetSyncEnabled) {
    try {
      const r = await syncIntegrationToSheet(integration.id);
      await logEvent({ integrationId: integration.id, step: "sheets", message: `Google Sheet synced — ${r.appended} row(s) appended` });
    } catch (e) {
      await logEvent({
        integrationId: integration.id,
        level: "warn",
        step: "sheets",
        message: `Google Sheet sync failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function recordFailure(
  statementId: string,
  integration: Integration,
  runId: string | null,
  err: BankAutomationError,
  password: string | null,
  periodEnd: string | null,
) {
  const s = await prisma.bankStatement.findUniqueOrThrow({ where: { id: statementId }, select: { attempts: true, blobPathname: true } });
  const message = redact(err.message, [password]);
  const decision = retryDecision(err.code, s.attempts);
  const base = { lastErrorCode: err.code, lastError: message };
  if (decision.kind === "retry") {
    const at = new Date(Date.now() + decision.delayMs);
    await prisma.bankStatement.update({
      where: { id: statementId },
      data: { ...base, status: s.blobPathname ? "PDF_DOWNLOADED" : "EMAIL_FOUND", nextAttemptAt: at },
    });
    await logEvent({
      integrationId: integration.id,
      runId,
      statementId,
      level: "warn",
      step: "retry",
      message: `${ERROR_LABEL[err.code]} — attempt ${s.attempts} failed, retrying in ${Math.round(decision.delayMs / 60_000)} min (${message})`,
    });
    return;
  }
  const status = decision.kind === "manual" ? "MANUAL_ACTION_REQUIRED" : "FAILED";
  await prisma.bankStatement.update({ where: { id: statementId }, data: { ...base, status, nextAttemptAt: null } });
  await logEvent({ integrationId: integration.id, runId, statementId, level: "error", step: "failed", message: `${status}: ${message}` });
  await notifyBankAlert({
    title: `${label(integration)} statement import ${status === "FAILED" ? "failed" : "needs action"}`,
    body: `Statement: ${fmtDay(periodEnd)}. Reason: ${ERROR_LABEL[err.code]}. Action: review the statement.`,
  });
}

// ─── Manual actions ─────────────────────────────────────────────────────────

/**
 * Put failed / held statements back in the queue under a fresh RETRY run.
 * Attempts reset, so the retry policy starts over; a statement whose PDF is
 * already archived is re-parsed from the archive rather than re-downloaded.
 */
export async function retryStatements(integrationId: string, statementIds: string[] | "failed", userId: string) {
  const where: Prisma.BankStatementWhereInput =
    statementIds === "failed"
      ? { integrationId, status: { in: ["FAILED", "MANUAL_ACTION_REQUIRED"] } }
      : { integrationId, id: { in: statementIds }, status: { in: ["FAILED", "MANUAL_ACTION_REQUIRED", "REVIEW_REQUIRED"] } };
  const targets = await prisma.bankStatement.findMany({ where, select: { id: true, blobPathname: true } });
  if (targets.length === 0) return { runId: null, count: 0 };
  const active = await prisma.bankStatementRun.findFirst({
    where: { integrationId, status: { in: [...RUN_ACTIVE] }, trigger: { not: "TEST" } },
    select: { id: true },
  });
  const runId =
    active?.id ??
    (
      await prisma.bankStatementRun.create({
        data: { integrationId, trigger: "RETRY", status: "QUEUED", phase: "Queued", discoveredAt: new Date(), initiatedById: userId },
      })
    ).id;
  for (const t of targets) {
    await prisma.bankStatement.update({
      where: { id: t.id },
      data: {
        runId,
        status: t.blobPathname ? "PDF_DOWNLOADED" : "EMAIL_FOUND",
        attempts: 0,
        nextAttemptAt: null,
        lockedUntil: null,
        reviewPayload: Prisma.DbNull,
      },
    });
    await logEvent({ integrationId, runId, statementId: t.id, step: "retry", message: "Queued for retry", userId });
  }
  return { runId, count: targets.length };
}

/** Approve (import the held rows) or reject a REVIEW_REQUIRED statement. */
export async function reviewStatement(statementId: string, action: "approve" | "reject", userId: string, note: string | null) {
  const s = await prisma.bankStatement.findUnique({ where: { id: statementId }, include: { integration: true } });
  if (!s || s.status !== "REVIEW_REQUIRED") throw new BankAutomationError("CONFIG", "This statement is not awaiting review");
  if (action === "reject") {
    await prisma.bankStatement.update({
      where: { id: s.id },
      data: { status: "FAILED", lastErrorCode: "PARSE_FAILED", lastError: `Rejected on review${note ? `: ${note}` : ""}`, reviewPayload: Prisma.DbNull, reviewedById: userId, reviewedAt: new Date() },
    });
    await logEvent({ integrationId: s.integrationId, statementId, step: "review", message: `Rejected on review${note ? `: ${note}` : ""}`, userId });
    return { inserted: 0, duplicates: 0 };
  }
  const rows = (s.reviewPayload ?? []) as unknown as ParsedRow[];
  const statementDate = s.periodEnd ? fromPrismaDate(s.periodEnd) : null;
  const res = await importRows(rows, {
    integrationId: s.integrationId,
    statementId: s.id,
    currency: s.integration.currency,
    statementDate,
    gmailMessageId: s.gmailMessageId,
    sourceSubject: s.sourceSubject,
  });
  await prisma.bankStatement.update({
    where: { id: s.id },
    data: {
      status: rows.length ? "PROCESSED" : "NO_TRANSACTIONS",
      insertedCount: res.inserted,
      duplicateCount: res.duplicates,
      reviewPayload: Prisma.DbNull,
      reviewedById: userId,
      reviewedAt: new Date(),
    },
  });
  await logEvent({
    integrationId: s.integrationId,
    statementId,
    step: "review",
    message: `Approved on review — ${res.inserted} imported, ${res.duplicates} duplicate(s) skipped${note ? ` (${note})` : ""}`,
    userId,
  });
  const integration = await prisma.bankIntegration.findUniqueOrThrow({ where: { id: s.integrationId }, include: { mailbox: true } });
  await afterImport(integration, statementDate);
  return res;
}

/**
 * A PDF uploaded by hand (e.g. downloaded from net banking when the link
 * expired). Archived, then queued like any other statement.
 */
export async function ingestUploadedPdf(integrationId: string, pdf: Uint8Array, userId: string) {
  const integration = await prisma.bankIntegration.findUniqueOrThrow({ where: { id: integrationId } });
  assertLooksLikePdf(pdf);
  const sha = sha256Hex(pdf);
  const dup = await prisma.bankStatement.findFirst({ where: { integrationId, fileSha256: sha }, select: { id: true } });
  if (dup) return { duplicate: true as const, statementId: dup.id, runId: null };

  // Read the period off the PDF so the file is named and dated properly.
  let period: { start: string | null; end: string | null } = { start: null, end: null };
  try {
    const password = await getStatementPassword(integration);
    const { items } = await extractTextItems(pdf, password);
    const p = parserFor(integration.bankCode).parse(items);
    period = { start: p.periodStart, end: p.periodEnd };
  } catch {
    /* processing will surface the real error */
  }
  const blobPathname = statementBlobPath({ bankCode: integration.bankCode, last4: integration.accountLastFour, statementDate: period.end, sha256: sha });
  await archivePdf(blobPathname, pdf);
  const active = await prisma.bankStatementRun.findFirst({
    where: { integrationId, status: { in: [...RUN_ACTIVE] }, trigger: { not: "TEST" } },
    select: { id: true },
  });
  const runId =
    active?.id ??
    (await prisma.bankStatementRun.create({
      data: { integrationId, trigger: "MANUAL", status: "QUEUED", phase: "Queued", discoveredAt: new Date(), initiatedById: userId },
    })).id;
  const stmt = await prisma.bankStatement.create({
    data: {
      integrationId,
      runId,
      source: "upload",
      status: "PDF_DOWNLOADED",
      fileSha256: sha,
      fileSize: pdf.byteLength,
      fileName: statementFileName(integration.bankCode, integration.accountLastFour, period.end),
      blobPathname,
      periodStart: period.start ? toPrismaDate(period.start) : null,
      periodEnd: period.end ? toPrismaDate(period.end) : null,
      createdById: userId,
    },
  });
  await logEvent({ integrationId, runId, statementId: stmt.id, step: "upload", message: "Statement PDF uploaded by hand", userId });
  return { duplicate: false as const, statementId: stmt.id, runId };
}

// ─── Test mode ──────────────────────────────────────────────────────────────

type TestStep = { step: string; ok: boolean; message: string };

/**
 * Connection test: Gmail → latest statement e-mail → link → bank access →
 * PDF → parse → preview. Writes NOTHING but the run record: no statement, no
 * transactions, no archived PDF.
 */
async function runTest(runId: string, integration: Integration) {
  const steps: TestStep[] = [];
  let preview: Record<string, unknown> | null = null;
  const save = async (status?: string) => {
    await prisma.bankStatementRun.update({
      where: { id: runId },
      data: {
        testResult: { steps, preview } as Prisma.InputJsonValue,
        phase: steps[steps.length - 1]?.message ?? "Testing…",
        lockedUntil: new Date(Date.now() + LEASE_MS),
        ...(status ? { status, completedAt: new Date() } : {}),
      },
    });
  };
  const step = async (name: string, ok: boolean, message: string) => {
    steps.push({ step: name, ok, message: redact(message, [password]) });
    await logEvent({ integrationId: integration.id, runId, step: `test:${name}`, level: ok ? "info" : "error", message, secrets: [password] });
    await save(ok ? undefined : "FAILED");
    return ok;
  };
  let password: string | null = null;

  try {
    const token = await mailboxToken(integration);
    const email = await gmailProfileEmail(token);
    await step("gmail", true, `Gmail connected (${email ?? "mailbox"})`);

    const today = todayIst();
    const messages = await findStatementMessages(integration, token, { after: addDays(today, -30), before: addDays(today, 1) });
    const latest = messages[messages.length - 1];
    if (!latest) return void (await step("locate", false, "No matching statement e-mail in the last 30 days"));
    const period = parseSubjectPeriod(latest.subject);
    await step("locate", true, `Latest statement e-mail: ${period ? fmtDay(period.end) : latest.subject}`);

    const url = extractStatementUrl(latest.bodies, integration.bankCode);
    if (!url && !latest.attachment) return void (await step("link", false, "The e-mail has no statement link or attachment"));
    await step("link", true, url ? "SmartStatement URL extracted" : "PDF attachment found");

    password = await getStatementPassword(integration);
    let pdf: Uint8Array;
    if (url) {
      if (!password) return void (await step("access", false, "The statement password is not configured"));
      const r = await downloaderFor(integration.bankCode).download(url, password, { log: () => undefined });
      pdf = r.pdf;
      await step("access", true, "Statement page opened and password accepted");
    } else {
      pdf = await getAttachment(token, latest.id, latest.attachment!.attachmentId);
    }
    assertLooksLikePdf(pdf);
    await step("download", true, `PDF downloaded (${Math.round(pdf.byteLength / 1024)} KB)`);

    const { parsed, rows } = await parsePdf(pdf, password, integration.bankCode);
    const v = validateStatement(parsed, {
      last4: integration.accountLastFour,
      periodStart: period?.start ?? null,
      periodEnd: period?.end ?? null,
      today,
    });
    await step("parse", true, `${rows.length} transaction(s) parsed`);

    const t = summarize(parsed, rows);
    preview = {
      statementDate: period?.end ?? parsed.periodEnd,
      transactions: rows.length,
      totalDebit: paiseToRupees(fromDecimal(t.totalDebit) ?? 0),
      totalCredit: paiseToRupees(fromDecimal(t.totalCredit) ?? 0),
      openingBalance: parsed.openingBalance === null ? null : paiseToRupees(parsed.openingBalance),
      closingBalance: parsed.closingBalance === null ? null : paiseToRupees(parsed.closingBalance),
      errors: v.errors,
      warnings: v.warnings,
      alreadyImported: await prisma.bankStatement.count({
        where: { integrationId: integration.id, gmailMessageId: latest.id, status: { in: SETTLED_STATUSES } },
      }) > 0,
      sample: rows.slice(0, 20).map((r) => ({
        date: r.txnDate,
        description: r.description.slice(0, 80),
        debit: paiseToRupees(r.debit),
        credit: paiseToRupees(r.credit),
        balance: r.balance === null ? null : paiseToRupees(r.balance),
      })),
    };
    await step(
      "preview",
      v.errors.length === 0,
      v.errors.length === 0 ? "Test successful — preview only, nothing imported" : `Parsed, but validation would hold it for review: ${v.errors[0]}`,
    );
    await save("COMPLETED");
  } catch (e) {
    const err = toBankError(e);
    const name = ["gmail", "locate", "link", "access", "download", "parse", "preview"][steps.length] ?? "test";
    await step(name, false, `${ERROR_LABEL[err.code]} — ${err.message}`);
  }
}

// ─── Scheduler / drain ──────────────────────────────────────────────────────

/** Queue today's scheduled run for every integration that is due. */
export async function queueDueRuns(now = new Date()): Promise<string[]> {
  const integrations = await prisma.bankIntegration.findMany({ where: { automationEnabled: true } });
  const queued: string[] = [];
  for (const i of integrations) {
    const due = isScheduledRunDue({
      now,
      enabled: i.automationEnabled,
      runTime: i.runTime,
      timeZone: i.timezone,
      lastScheduledRunOn: i.lastScheduledRunOn ? fromPrismaDate(i.lastScheduledRunOn) : null,
    });
    if (!due) continue;
    // Claim the day first so two overlapping crons queue one run, not two.
    const today = todayIst();
    const { count } = await prisma.bankIntegration.updateMany({
      where: {
        id: i.id,
        OR: [{ lastScheduledRunOn: null }, { lastScheduledRunOn: { not: toPrismaDate(today) } }],
      },
      data: { lastScheduledRunOn: toPrismaDate(today) },
    });
    if (!count) continue;
    const { runId } = await createRun({ integrationId: i.id, trigger: "SCHEDULED" });
    queued.push(runId);
  }
  return queued;
}

/** Once a day: alert when no statement has arrived for N business days. */
export async function checkMissingStatements(): Promise<number> {
  const today = todayIst();
  const integrations = await prisma.bankIntegration.findMany({ where: { automationEnabled: true } });
  let alerts = 0;
  for (const i of integrations) {
    if (!i.lastStatementDate) continue;
    if (i.lastMissingAlertOn && fromPrismaDate(i.lastMissingAlertOn) === today) continue;
    const missed = missedBusinessDays(fromPrismaDate(i.lastStatementDate), today);
    if (missed < i.alertAfterBusinessDays) continue;
    await prisma.bankIntegration.update({ where: { id: i.id }, data: { lastMissingAlertOn: toPrismaDate(today) } });
    await notifyBankAlert({
      title: `${label(i)}: no statement received`,
      body: `No statement has arrived for ${missed} business day${missed === 1 ? "" : "s"} since ${fmtDay(fromPrismaDate(i.lastStatementDate))}. Check the mailbox or run a backfill.`,
      link: `${BANK_PAGE}?tab=automation`,
    });
    alerts++;
  }
  return alerts;
}

/** Advance every runnable run until the deadline. The cron's main loop. */
export async function drainRuns(deadline: number): Promise<{ advanced: number }> {
  const visited = new Set<string>();
  let advanced = 0;
  while (Date.now() + 20_000 < deadline) {
    const now = new Date();
    const run = await prisma.bankStatementRun.findFirst({
      where: {
        id: { notIn: Array.from(visited) },
        status: { in: [...RUN_ACTIVE] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!run) break;
    visited.add(run.id);
    try {
      await advanceRun(run.id, deadline);
      advanced++;
    } catch (e) {
      logger.error("bank_drain_run_failed", { runId: run.id, message: redact(e instanceof Error ? e.message : String(e)) });
    }
  }
  return { advanced };
}

export type { BankErrorCode };
