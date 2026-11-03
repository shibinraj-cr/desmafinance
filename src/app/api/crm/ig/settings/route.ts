import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { siteBaseUrl } from "@/lib/site-url";
import {
  getSetting,
  setSetting,
  IG_ACCESS_TOKEN_KEY,
  IG_ACCOUNT_ID_KEY,
  IG_API_VERSION_KEY,
  IG_AUTO_ASK_ENABLED_KEY,
  IG_AUTO_ASK_FOLLOWUP_KEY,
  IG_AUTO_ASK_INTRO_KEY,
  IG_AUTO_ASK_THANKS_KEY,
  IG_CAPTURE_ENABLED_KEY,
  IG_LAST_WEBHOOK_AT_KEY,
  IG_PAGE_ID_KEY,
  IG_PAGE_TOKEN_KEY,
  IG_USERNAME_KEY,
  IG_VERIFY_TOKEN_KEY,
  WA_CLOUD_APP_SECRET_KEY,
} from "@/lib/app-settings";
import {
  checkIgConnection,
  DEFAULT_IG_API_VERSION,
  getIgConfig,
  listPageSubscriptions,
  subscribePage,
} from "@/lib/ig/graph";
import { DEFAULT_IG_FOLLOWUP, DEFAULT_IG_INTRO, DEFAULT_IG_THANKS } from "@/lib/ig/auto-ask";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto

/**
 * Settings for Instagram DMs → leads (CRM → Settings → Instagram).
 *
 * Same conventions as the WhatsApp settings route: tokens never come back in
 * full (a masked hint and a `hasToken` flag instead), and a blank token on
 * save keeps what is stored, so re-saving the form cannot blank a credential
 * the admin could not see.
 */

function mask(value: string | null): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return v.length <= 8 ? "••••" : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

const RECENT_LIMIT = 25;

async function requireSettingsAccess() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();
  return userId;
}

export const GET = withApiHandler(async (req: Request) => {
  await requireSettingsAccess();

  const read = (k: string) => getSetting(k).catch(() => null);
  const [pageId, accessToken, pageToken, accountId, username, verifyToken, apiVersion, capture, autoAsk, intro, followUp, thanks, lastWebhookAt, appSecret] =
    await Promise.all([
      read(IG_PAGE_ID_KEY),
      read(IG_ACCESS_TOKEN_KEY),
      read(IG_PAGE_TOKEN_KEY),
      read(IG_ACCOUNT_ID_KEY),
      read(IG_USERNAME_KEY),
      read(IG_VERIFY_TOKEN_KEY),
      read(IG_API_VERSION_KEY),
      read(IG_CAPTURE_ENABLED_KEY),
      read(IG_AUTO_ASK_ENABLED_KEY),
      read(IG_AUTO_ASK_INTRO_KEY),
      read(IG_AUTO_ASK_FOLLOWUP_KEY),
      read(IG_AUTO_ASK_THANKS_KEY),
      read(IG_LAST_WEBHOOK_AT_KEY),
      read(WA_CLOUD_APP_SECRET_KEY),
    ]);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [contacts, leadsCreated, leadsLinked, inbound24h, autoSent, recent] = await Promise.all([
    prisma.igContact.count(),
    prisma.igContact.count({ where: { leadId: { not: null }, leadCreated: true } }),
    prisma.igContact.count({ where: { leadId: { not: null }, leadCreated: false } }),
    prisma.igMessage.count({ where: { direction: "in", occurredAt: { gte: dayAgo } } }),
    prisma.igMessage.count({ where: { direction: "out", sender: "auto", sendStatus: "sent" } }),
    prisma.igContact.findMany({
      orderBy: [{ lastInboundAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: RECENT_LIMIT,
      select: {
        id: true,
        username: true,
        name: true,
        typedName: true,
        email: true,
        phoneE164: true,
        qualification: { select: { label: true } },
        leadId: true,
        leadCreated: true,
        lead: { select: { candidateName: true } },
        askCount: true,
        thankedAt: true,
        humanRepliedAt: true,
        autoAskBlocked: true,
        lastInboundAt: true,
        messages: {
          where: { direction: "in" },
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { body: true, attachmentType: true },
        },
      },
    }),
  ]);

  const token = verifyToken?.trim() || null;
  return NextResponse.json({
    pageId: pageId?.trim() ?? "",
    apiVersion: apiVersion?.trim() ?? "",
    defaultApiVersion: DEFAULT_IG_API_VERSION,
    hasToken: !!accessToken?.trim(),
    tokenHint: mask(accessToken),
    hasPageToken: !!pageToken?.trim(),
    accountId: accountId?.trim() || null,
    username: username?.trim() || null,
    verifyToken: token,
    // Built here so nobody assembles the URL by hand and gets the host wrong.
    webhookUrl: `${siteBaseUrl(req)}/api/crm/ig/webhook`,
    appSecretConfigured: !!(appSecret?.trim() || process.env.WA_CLOUD_APP_SECRET),
    captureEnabled: capture === "1",
    autoAskEnabled: autoAsk === "1",
    texts: { intro: intro ?? "", followUp: followUp ?? "", thanks: thanks ?? "" },
    defaults: { intro: DEFAULT_IG_INTRO, followUp: DEFAULT_IG_FOLLOWUP, thanks: DEFAULT_IG_THANKS },
    lastWebhookAt: lastWebhookAt || null,
    stats: { contacts, leadsCreated, leadsLinked, inbound24h, autoSent },
    recent: recent.map((c) => ({
      id: c.id,
      username: c.username,
      name: c.typedName || c.name,
      email: c.email,
      phoneE164: c.phoneE164,
      qualification: c.qualification?.label ?? null,
      leadId: c.leadId,
      leadName: c.lead?.candidateName ?? null,
      leadCreated: c.leadCreated,
      askCount: c.askCount,
      thanked: !!c.thankedAt,
      humanReplied: !!c.humanRepliedAt,
      autoAskBlocked: c.autoAskBlocked,
      lastInboundAt: c.lastInboundAt,
      lastMessage: c.messages[0]?.body ?? (c.messages[0]?.attachmentType ? `[${c.messages[0].attachmentType}]` : null),
    })),
  });
});

const TEXT_MAX = 900;

const SaveSchema = z.object({
  action: z.literal("save"),
  pageId: z.string().max(64),
  /** Blank keeps the stored token — see the module note. */
  accessToken: z.string().max(1000),
  apiVersion: z.string().max(10),
  captureEnabled: z.boolean(),
  autoAskEnabled: z.boolean(),
  intro: z.string().max(TEXT_MAX),
  followUp: z.string().max(TEXT_MAX),
  thanks: z.string().max(TEXT_MAX),
});
const GenerateSchema = z.object({ action: z.literal("generate_verify_token") });
const CheckSchema = z.object({ action: z.literal("check_connection") });
// Two literals rather than one z.enum, so discriminatedUnion narrows each.
const ListSubsSchema = z.object({ action: z.literal("check_subscription") });
const SubscribeSchema = z.object({ action: z.literal("subscribe") });

const BodySchema = z.discriminatedUnion("action", [SaveSchema, GenerateSchema, CheckSchema, ListSubsSchema, SubscribeSchema]);

export const POST = withApiHandler(async (req: Request) => {
  const userId = await requireSettingsAccess();
  const data = BodySchema.parse(await req.json().catch(() => null));

  if (data.action === "generate_verify_token") {
    const token = randomBytes(24).toString("hex");
    await setSetting(IG_VERIFY_TOKEN_KEY, token, userId);
    return NextResponse.json({ ok: true, verifyToken: token });
  }

  if (data.action === "save") {
    const pageIdChanged = (await getSetting(IG_PAGE_ID_KEY).catch(() => null))?.trim() !== data.pageId.trim();
    const writes = [
      setSetting(IG_PAGE_ID_KEY, data.pageId.trim(), userId),
      setSetting(IG_API_VERSION_KEY, data.apiVersion.trim(), userId),
      setSetting(IG_CAPTURE_ENABLED_KEY, data.captureEnabled ? "1" : "0", userId),
      setSetting(IG_AUTO_ASK_ENABLED_KEY, data.autoAskEnabled ? "1" : "0", userId),
      setSetting(IG_AUTO_ASK_INTRO_KEY, data.intro.trim(), userId),
      setSetting(IG_AUTO_ASK_FOLLOWUP_KEY, data.followUp.trim(), userId),
      setSetting(IG_AUTO_ASK_THANKS_KEY, data.thanks.trim(), userId),
    ];
    if (data.accessToken.trim()) writes.push(setSetting(IG_ACCESS_TOKEN_KEY, data.accessToken.trim(), userId));
    // A new token or a different Page invalidates what "Check connection"
    // derived from the old one; leaving it would keep sending as the old Page.
    if (data.accessToken.trim() || pageIdChanged) {
      writes.push(
        setSetting(IG_PAGE_TOKEN_KEY, "", userId),
        setSetting(IG_ACCOUNT_ID_KEY, "", userId),
        setSetting(IG_USERNAME_KEY, "", userId),
      );
    }
    await Promise.all(writes);
    return NextResponse.json({ ok: true });
  }

  if (data.action === "check_connection") {
    const [pageId, accessToken, version] = await Promise.all([
      getSetting(IG_PAGE_ID_KEY),
      getSetting(IG_ACCESS_TOKEN_KEY),
      getSetting(IG_API_VERSION_KEY),
    ]);
    if (!pageId?.trim() || !accessToken?.trim()) {
      return NextResponse.json({ ok: false, detail: "Save the Page ID and access token first." });
    }
    const r = await checkIgConnection(pageId.trim(), accessToken.trim(), version?.trim() || DEFAULT_IG_API_VERSION);
    if (!r.ok) return NextResponse.json({ ok: false, detail: r.detail });
    await Promise.all([
      setSetting(IG_PAGE_TOKEN_KEY, r.pageToken ?? "", userId),
      setSetting(IG_ACCOUNT_ID_KEY, r.accountId, userId),
      setSetting(IG_USERNAME_KEY, r.username ?? "", userId),
    ]);
    return NextResponse.json({
      ok: true,
      pageName: r.pageName,
      accountId: r.accountId,
      username: r.username,
      // Whether sends will use a derived Page token or the pasted token as-is.
      pageTokenDerived: !!r.pageToken,
    });
  }

  // check_subscription / subscribe — always list AFTER subscribing, so the
  // answer shows the resulting state rather than just "the call returned 200".
  const cfg = await getIgConfig();
  const subscribed = data.action === "subscribe" ? await subscribePage(cfg) : { ok: true, detail: "" };
  const listed = await listPageSubscriptions(cfg);
  return NextResponse.json({
    ok: subscribed.ok && listed.ok,
    action: data.action,
    subscribeDetail: subscribed.detail,
    apps: listed.ok ? listed.apps : [],
    detail: listed.ok ? "" : listed.detail,
  });
});
