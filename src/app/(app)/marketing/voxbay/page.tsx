import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import { todayIst, addDays } from "@/lib/lead-pulse-dates";
import { VoxbayClient } from "./client";

export const dynamic = "force-dynamic";

// IST = UTC+5:30. callStartTime is stored as the UTC instant of the
// IST wall-clock the CSV reported, so to filter by an IST calendar
// day we map the day's IST midnight bounds onto UTC instants.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function istDayStartUtc(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}
function istDayEndUtc(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - IST_OFFSET_MS);
}
function daysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

export default async function VoxbayPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  const canUpload = access.canSupervise;

  // Default range: MTD — 1st of current IST month through today IST.
  const today = todayIst();
  const monthFirst = today.slice(0, 8) + "01";
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const from = searchParams.from && dateRe.test(searchParams.from) ? searchParams.from : monthFirst;
  const toRaw = searchParams.to && dateRe.test(searchParams.to) ? searchParams.to : today;
  // Guard against to < from
  const to = toRaw < from ? from : toRaw;

  // Prior comparison window: the same number of days, ending the day
  // before `from`. e.g. May 1–14 vs Apr 17–30.
  const span = daysInclusive(from, to);
  const priorTo = addDays(from, -1);
  const priorFrom = addDays(priorTo, -(span - 1));

  const [latestUpload, calls, priorAgg] = await Promise.all([
    prisma.voxbayUpload.findFirst({
      orderBy: { uploadedAt: "desc" },
      include: { uploadedBy: { select: { username: true } } },
    }),
    prisma.voxbayCall.findMany({
      where: {
        callStartTime: { gte: istDayStartUtc(from), lte: istDayEndUtc(to) },
      },
      orderBy: { callStartTime: "desc" },
      take: 5000,
    }),
    prisma.voxbayCall.findMany({
      where: {
        callStartTime: { gte: istDayStartUtc(priorFrom), lte: istDayEndUtc(priorTo) },
      },
      select: {
        userStatus: true,
        callStatus: true,
        totalDurationSec: true,
        answeredDurationSec: true,
      },
    }),
  ]);

  // Aggregate the prior window into the same KPI shape as the current
  // period so the client can render delta pills without a second query.
  let priorAnswered = 0;
  let priorFailed = 0;
  let priorTotalSec = 0;
  let priorAnsSec = 0;
  let priorChannelLimitExceeded = 0;
  for (const c of priorAgg) {
    const u = (c.userStatus ?? "").toUpperCase();
    if (u === "ANSWERED") {
      priorAnswered += 1;
      priorAnsSec += c.answeredDurationSec;
    } else if (u === "FAILED" || u === "NOANSWER" || u === "TIMEOUT" || u === "BUSY") {
      priorFailed += 1;
    }
    priorTotalSec += c.totalDurationSec;
    if ((c.callStatus ?? "").toUpperCase() === "CHANNEL_LIMIT_EXCEEDED") {
      priorChannelLimitExceeded += 1;
    }
  }
  const priorTotal = priorAgg.length;
  const priorAvgSec = priorTotal > 0 ? priorTotalSec / priorTotal : 0;
  const priorAnsAvgSec = priorAnswered > 0 ? priorAnsSec / priorAnswered : 0;

  return (
    <VoxbayClient
      canUpload={canUpload}
      latestUpload={
        latestUpload
          ? {
              filename: latestUpload.filename,
              rowCount: latestUpload.rowCount,
              uploadedAt: latestUpload.uploadedAt.toISOString(),
              uploadedBy: latestUpload.uploadedBy?.username ?? null,
            }
          : null
      }
      calls={calls.map((c) => ({
        id: c.id,
        slNo: c.slNo,
        contactName: c.contactName,
        sourceNumber: c.sourceNumber,
        didNumber: c.didNumber,
        cost: c.cost,
        dtmfSeq: c.dtmfSeq,
        callStartTime: c.callStartTime?.toISOString() ?? null,
        callStatus: c.callStatus,
        userStatus: c.userStatus,
        agentName: c.agentName,
        lastTriedName: c.lastTriedName,
        firstTriedName: c.firstTriedName,
        totalDurationSec: c.totalDurationSec,
        totalDurationDisplay: c.totalDurationDisplay,
        answeredDurationSec: c.answeredDurationSec,
        answeredDurationDisplay: c.answeredDurationDisplay,
        deptName: c.deptName,
        disposition: c.disposition,
        callRecordFile: c.callRecordFile,
      }))}
      range={{ from, to }}
      priorRange={{ from: priorFrom, to: priorTo }}
      prior={{
        total: priorTotal,
        answered: priorAnswered,
        failed: priorFailed,
        avgSec: priorAvgSec,
        ansAvgSec: priorAnsAvgSec,
        channelLimitExceeded: priorChannelLimitExceeded,
      }}
    />
  );
}
