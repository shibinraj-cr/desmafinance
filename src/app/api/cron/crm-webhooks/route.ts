import { NextResponse } from "next/server";
import { drainWebhookQueue } from "@/lib/crm-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A backlog is drained one request at a time. 60s is the Hobby-plan ceiling; the
// drain's own row limit keeps a slow sink from needing more.
export const maxDuration = 60;

/**
 * Retry outbound CRM webhooks that the inline attempt didn't land (Vercel Cron →
 * see vercel.json). Each lead assignment is POSTed to Wabis inside the assign
 * request; this is the safety net for the cases that can't be handled there —
 * Wabis briefly down, a network blip, or the serverless instance being killed
 * before the retry could run.
 *
 * Scheduled daily, not every few minutes, because the project is on Vercel's
 * Hobby plan, where a cron may only fire once per day — a `* / 5` schedule is
 * rejected at deploy time. So this is a long-stop, not the timely retry path:
 * the inline attempt covers the normal case, and an admin can flush the queue on
 * demand from CRM → Settings. On Pro, tightening the schedule in vercel.json is
 * the only change needed.
 *
 * Auth mirrors /api/cron/etime-sync: Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`, and `?key=$CRON_SECRET` is accepted for
 * manual triggering. With CRON_SECRET unset the endpoint refuses to run (fail
 * closed) so it can't be hit anonymously.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — webhook drain disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await drainWebhookQueue();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
