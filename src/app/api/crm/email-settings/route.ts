import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { setSetting, getSetting } from "@/lib/app-settings";
import {
  getEmailConfig,
  getDailyQuota,
  verifyEmailConfig,
  sendEmail,
  resetTransport,
  formatFrom,
  friendlySmtpError,
  type EmailConfig,
  EMAIL_USER_KEY,
  EMAIL_PASS_KEY,
  EMAIL_FROM_NAME_KEY,
  EMAIL_FROM_ADDR_KEY,
  EMAIL_REPLY_TO_KEY,
  EMAIL_DAILY_CAP_KEY,
  DEFAULT_DAILY_CAP,
} from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // nodemailer (SMTP)

async function requireAdmin() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();
  return userId;
}

// GET /api/crm/email-settings — current sender config (never returns the password).
export const GET = withApiHandler(async () => {
  await requireAdmin();
  const cfg = await getEmailConfig();
  const passSet = !!(await getSetting(EMAIL_PASS_KEY)) || !!process.env.EMAIL_SMTP_PASS;
  const quota = cfg ? await getDailyQuota(cfg) : null;
  return NextResponse.json({
    configured: !!cfg,
    user: cfg?.user ?? (await getSetting(EMAIL_USER_KEY)) ?? "",
    fromName: cfg?.fromName ?? "",
    fromAddress: cfg?.fromAddress ?? "",
    replyTo: cfg?.replyTo ?? "",
    dailyCap: cfg?.dailyCap ?? DEFAULT_DAILY_CAP,
    passSet,
    envFallback: !!process.env.EMAIL_SMTP_USER && !(await getSetting(EMAIL_USER_KEY)),
    from: cfg ? formatFrom(cfg) : null,
    quota,
  });
});

const emailOrEmpty = z.union([z.string().trim().email(), z.literal("")]);
const PostSchema = z.object({
  action: z.enum(["save", "test", "clear"]),
  user: z.string().trim().max(200).optional(),
  pass: z.string().max(200).optional(), // not trimmed: app passwords are 16 chars, sometimes pasted with spaces
  // No CR/LF (header-injection safe); must parse as an email when set.
  fromName: z.string().trim().max(120).regex(/^[^\r\n]*$/, "No line breaks").optional(),
  fromAddress: emailOrEmpty.optional(),
  replyTo: emailOrEmpty.optional(),
  dailyCap: z.number().int().min(1).max(2000).optional(),
  testTo: z.string().trim().email().optional(),
});

// POST /api/crm/email-settings — save / test / clear the Gmail sender (admin).
export const POST = withApiHandler(async (req: Request) => {
  const userId = await requireAdmin();
  const body = PostSchema.parse(await req.json().catch(() => null));

  if (body.action === "clear") {
    await prisma.appSetting.deleteMany({
      where: { key: { in: [EMAIL_USER_KEY, EMAIL_PASS_KEY, EMAIL_FROM_NAME_KEY, EMAIL_FROM_ADDR_KEY, EMAIL_REPLY_TO_KEY, EMAIL_DAILY_CAP_KEY] } },
    });
    resetTransport();
    return NextResponse.json({ ok: true, configured: false });
  }

  if (body.action === "save") {
    const user = (body.user ?? "").trim();
    if (!user) throw badRequest("A Gmail address is required", "missing_user");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) throw badRequest("That doesn't look like an email address", "bad_user");
    await setSetting(EMAIL_USER_KEY, user, userId);
    // Only overwrite the password when a new one is supplied (so other-field
    // edits don't wipe an existing app password).
    const pass = (body.pass ?? "").replace(/\s+/g, "");
    if (pass) await setSetting(EMAIL_PASS_KEY, pass, userId);
    await setSetting(EMAIL_FROM_NAME_KEY, body.fromName ?? "", userId);
    await setSetting(EMAIL_FROM_ADDR_KEY, body.fromAddress ?? "", userId);
    await setSetting(EMAIL_REPLY_TO_KEY, body.replyTo ?? "", userId);
    await setSetting(EMAIL_DAILY_CAP_KEY, String(body.dailyCap ?? DEFAULT_DAILY_CAP), userId);
    resetTransport();

    const cfg = await getEmailConfig();
    return NextResponse.json({ ok: true, configured: !!cfg, passSet: !!(cfg?.pass) });
  }

  // action === "test": verify the SMTP login, then send a self-addressed probe.
  // Use the just-submitted values if present so the admin can test before saving.
  const stored = await getEmailConfig();
  const user = (body.user ?? stored?.user ?? "").trim();
  const pass = (body.pass ?? "").replace(/\s+/g, "") || stored?.pass || "";
  if (!user || !pass) throw badRequest("Set a Gmail address and App Password first", "not_configured");
  const cfg: EmailConfig = {
    user,
    pass,
    fromName: (body.fromName ?? stored?.fromName) || null,
    fromAddress: (body.fromAddress ?? "").trim() || stored?.fromAddress || user,
    replyTo: (body.replyTo ?? stored?.replyTo) || null,
    dailyCap: body.dailyCap ?? stored?.dailyCap ?? DEFAULT_DAILY_CAP,
  };
  try {
    await verifyEmailConfig(cfg);
    const to = body.testTo || user;
    const { messageId } = await sendEmail(cfg, {
      to,
      subject: "DESMA CRM — test email",
      text: "This is a test email from your DESMA CRM email integration. If you can read this, sending works and a copy is in this account's Sent folder.",
    });
    return NextResponse.json({ ok: true, sentTo: to, messageId });
  } catch (e) {
    throw badRequest(`Test failed: ${friendlySmtpError(e)}`, "smtp_test_failed");
  }
});
