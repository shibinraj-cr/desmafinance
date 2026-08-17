import { NextResponse } from "next/server";
import { archivePendingMedia } from "@/lib/wa/media-archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Copy WhatsApp attachments into our own storage before the provider drops them.
 *
 * Daily is enough, and that is not a compromise forced by the Hobby plan: Meta
 * holds inbound media for seven days, so a nightly pass has six days of slack on
 * every message. The imported Wabis attachments are the impatient half — those
 * last only as long as that subscription — and they are what the admin button on
 * the settings page is for.
 *
 * Auth matches the other crons: Vercel sends `Authorization: Bearer $CRON_SECRET`,
 * and `?key=` is accepted for manual triggering. Fail-closed when unset.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — media archiving disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const summary = await archivePendingMedia({ limit: 400 });
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
