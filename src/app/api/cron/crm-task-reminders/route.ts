import { NextResponse } from "next/server";
import { drainTaskReminders } from "@/lib/crm-task-reminders-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // nodemailer (SMTP) on the email branch
export const maxDuration = 60;

/**
 * Send the candidate-facing reminders that have come due.
 *
 * The safety net behind an overdue CRM task: a task still open the morning after
 * its due date gets an approved WhatsApp template and an email sent to the
 * candidate, whether or not the consultant remembered.
 *
 * Honest about the granularity. Vercel's Hobby plan only accepts daily cron
 * entries, so vercel.json lists this path several times across the working day
 * and the real resolution is a few hours, not minutes — the same compromise
 * etime-sync and hiring-nudges already make. The drain enforces its own IST send
 * window regardless of when it is triggered, so adding or moving an entry can
 * never put a message on a candidate's phone at 3am.
 *
 * Auth matches the other crons: Vercel sends `Authorization: Bearer $CRON_SECRET`,
 * and `?key=` is accepted for manual or external triggering. Fail-closed when
 * the secret is unset rather than running anonymously.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — task reminders disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const summary = await drainTaskReminders();
  return NextResponse.json({ ok: true, ...summary });
}

export const GET = handle;
export const POST = handle;
