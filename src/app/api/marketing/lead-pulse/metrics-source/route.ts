import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { setSetting } from "@/lib/app-settings";
import { METRICS_SOURCE_KEY, getMetricsSource } from "@/lib/lead-pulse-crm-metrics";

export const dynamic = "force-dynamic";

// Which data source the live Lead Pulse dashboards read from. Supervisor-only.
async function gate() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { userId };
}

export async function GET() {
  const g = await gate();
  if ("error" in g) return g.error;
  return NextResponse.json({ source: await getMetricsSource() });
}

const Schema = z.object({ source: z.enum(["daily_entry", "crm"]) });

export async function POST(req: NextRequest) {
  const g = await gate();
  if ("error" in g) return g.error;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  await setSetting(METRICS_SOURCE_KEY, parsed.data.source, g.userId);
  return NextResponse.json({ source: parsed.data.source });
}
