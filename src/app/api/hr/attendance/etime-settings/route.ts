import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { getSetting, setSetting } from "@/lib/app-settings";
import {
  getEtimeConfig,
  fetchInOutPunchData,
  ETIME_CFG_KEYS as K,
  type EtimeConfig,
} from "@/lib/etimeoffice";
import { ATTENDANCE_API_CUTOVER } from "@/lib/hr-attendance-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // outbound fetch + Buffer (auth encoding)

const DEFAULT_BASE_URL = "https://api.etimeoffice.com/api/";

async function requireHrApprover() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canApproveHr(perms)) throw forbidden();
  return userId;
}

// GET — current config for the settings screen. NEVER returns the password.
export const GET = withApiHandler(async () => {
  await requireHrApprover();
  const [baseUrl, corpId, username, empcode, authMode, password] = await Promise.all([
    getSetting(K.baseUrl),
    getSetting(K.corpId),
    getSetting(K.username),
    getSetting(K.empcode),
    getSetting(K.authMode),
    getSetting(K.password),
  ]);
  const cfg = await getEtimeConfig();

  return NextResponse.json({
    configured: !!cfg,
    cutover: ATTENDANCE_API_CUTOVER.toISOString().slice(0, 10),
    baseUrl: baseUrl ?? "",
    corpId: corpId ?? "",
    username: username ?? "",
    empcode: empcode ?? "",
    authMode: authMode ?? "corp-user-pass",
    passwordSet: !!password || !!process.env.ETIMEOFFICE_PASSWORD,
    // Env-only escape hatches (informational; not editable in-app).
    envAuthHeader: !!process.env.ETIMEOFFICE_AUTH_HEADER,
    envAuthRaw: !!process.env.ETIMEOFFICE_AUTH_RAW,
    envFallback:
      !!process.env.ETIMEOFFICE_CORP_ID && !corpId && !username && !password,
    cronConfigured: !!process.env.CRON_SECRET,
    defaultBaseUrl: DEFAULT_BASE_URL,
  });
});

const PostSchema = z.object({
  action: z.enum(["save", "test", "clear"]),
  baseUrl: z.string().trim().max(300).optional(),
  corpId: z.string().trim().max(120).optional(),
  username: z.string().trim().max(120).optional(),
  password: z.string().max(200).optional(), // not trimmed — passwords may contain spaces
  empcode: z.string().trim().max(120).optional(),
  authMode: z.enum(["corp-user-pass", "user-pass"]).optional(),
});

// POST — save / test / clear the eTimeOffice credentials (HR approver only).
export const POST = withApiHandler(async (req: Request) => {
  const userId = await requireHrApprover();
  const body = PostSchema.parse(await req.json().catch(() => null));

  if (body.action === "clear") {
    await prisma.appSetting.deleteMany({ where: { key: { in: Object.values(K) } } });
    return NextResponse.json({ ok: true, configured: false });
  }

  if (body.action === "save") {
    let base = (body.baseUrl ?? "").trim() || DEFAULT_BASE_URL;
    if (!/^https?:\/\//i.test(base)) throw badRequest("Base URL must start with http(s)://", "bad_base_url");
    if (!base.endsWith("/")) base += "/";
    await setSetting(K.baseUrl, base, userId);
    await setSetting(K.corpId, (body.corpId ?? "").trim(), userId);
    await setSetting(K.username, (body.username ?? "").trim(), userId);
    await setSetting(K.empcode, (body.empcode ?? "").trim() || "ALL", userId);
    await setSetting(K.authMode, body.authMode ?? "corp-user-pass", userId);
    // Only overwrite the password when a new one is supplied (so editing other
    // fields doesn't wipe a stored password).
    if (body.password && body.password.length > 0) {
      await setSetting(K.password, body.password, userId);
    }
    const cfg = await getEtimeConfig();
    return NextResponse.json({ ok: true, configured: !!cfg });
  }

  // action === "test": build a config from the submitted values (falling back to
  // stored ones), then do a tiny 1-day fetch and report what came back. Does NOT
  // ingest — read-only probe of the credentials + endpoint.
  const stored = await getEtimeConfig();
  const password = body.password && body.password.length > 0
    ? body.password
    : (await getSetting(K.password)) || process.env.ETIMEOFFICE_PASSWORD || stored?.password || "";
  let base = (body.baseUrl ?? stored?.baseUrl ?? DEFAULT_BASE_URL).trim();
  if (!base.endsWith("/")) base += "/";

  const cfg: EtimeConfig = {
    baseUrl: base,
    corpId: (body.corpId ?? stored?.corpId ?? "").trim(),
    username: (body.username ?? stored?.username ?? "").trim(),
    password,
    empcode: (body.empcode ?? stored?.empcode ?? "ALL").trim() || "ALL",
    authMode: body.authMode ?? stored?.authMode ?? "corp-user-pass",
    authRaw: process.env.ETIMEOFFICE_AUTH_RAW || null,
    authHeader: process.env.ETIMEOFFICE_AUTH_HEADER || null,
  };
  if (!cfg.authHeader && !cfg.authRaw && (!cfg.username || !password)) {
    throw badRequest("Enter a Corporate ID, Username and Password first", "not_configured");
  }

  // Probe a 1-day window at the cutover (any valid date works; we only care that
  // auth + endpoint respond). Keep it read-only.
  try {
    const probe = await fetchInOutPunchData({
      fromDate: ATTENDANCE_API_CUTOVER,
      toDate: ATTENDANCE_API_CUTOVER,
      cfg,
    });
    return NextResponse.json({
      ok: true,
      reachable: true,
      recordsForProbeDay: probe.fetched,
      message: `Connected. eTimeOffice returned ${probe.fetched} record(s) for ${probe.rangeStart}.`,
    });
  } catch (e) {
    throw badRequest(
      `Test failed: ${e instanceof Error ? e.message : "could not reach eTimeOffice"}`,
      "etime_test_failed",
    );
  }
});
