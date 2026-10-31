import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import {
  ceoHeadline,
  ceoProfit,
  fyMonthlySeries,
  forecastFromSeries,
  orgHealth,
} from "@/lib/ceo-dashboard";

export const dynamic = "force-dynamic";

/**
 * GET /api/executive/dashboard — the CEO dashboard payload (admin only).
 * Reuses the exact lib functions the /executive/dashboard server page calls.
 */
export async function GET() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [headline, series, profit] = await Promise.all([
    ceoHeadline(),
    fyMonthlySeries(),
    ceoProfit(),
  ]);
  const forecast = forecastFromSeries(series);
  const health = await orgHealth(series);

  return NextResponse.json({ headline, series, forecast, health, profit });
}
