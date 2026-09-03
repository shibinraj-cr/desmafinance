import { NextResponse } from "next/server";
import { syncAllSources } from "@/lib/news/sync";

export const dynamic = "force-dynamic";
// Each source is fetched over the network, one at a time.
export const maxDuration = 300;

/**
 * Daily News & Updates pull (Vercel Cron → see vercel.json).
 *
 * Auth mirrors /api/cron/etime-sync: Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`, and `?key=$CRON_SECRET` is accepted for
 * manual triggering. With CRON_SECRET unset the endpoint refuses to run, so it
 * can never be hit anonymously.
 *
 * The run is idempotent: every item carries a per-source guid, so re-running
 * files nothing twice.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — news sync disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const summary = await syncAllSources();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("[news-sync] run failed:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
