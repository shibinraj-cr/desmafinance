import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { markAllRead } from "@/lib/news/read";

const Schema = z.object({ topic: z.string().max(60).nullish() });

/**
 * POST /api/news/read-all — mark every update currently visible to the signed-in
 * user as read; with `{ topic }`, only that topic. Bounded by the feed window,
 * so this never writes a receipt for something the user cannot see.
 */
export async function POST(req: Request) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Schema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  const count = await markAllRead(userId, parsed.data.topic ?? null);
  return NextResponse.json({ ok: true, count });
}
