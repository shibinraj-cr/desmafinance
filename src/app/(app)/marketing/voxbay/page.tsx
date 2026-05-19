import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import { VoxbayClient } from "./client";

export const dynamic = "force-dynamic";

export default async function VoxbayPage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  // Anyone with Marketing access can view; only supervisors can upload.
  const canUpload = access.canSupervise;

  const [latestUpload, calls] = await Promise.all([
    prisma.voxbayUpload.findFirst({
      orderBy: { uploadedAt: "desc" },
      include: { uploadedBy: { select: { username: true } } },
    }),
    prisma.voxbayCall.findMany({
      orderBy: { callStartTime: "desc" },
      take: 5000,
    }),
  ]);

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
    />
  );
}
