import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "healthy",
      database: "ok",
      latency_ms: Date.now() - t0,
      uptime_s: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: "unhealthy",
        database: "fail",
        latency_ms: Date.now() - t0,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
