import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { siteBaseUrl } from "@/lib/site-url";
import {
  getSetting,
  setSetting,
  WA_BROADCAST_BATCH_KEY,
  WA_BROADCAST_ENABLED_KEY,
  WA_CLOUD_API_VERSION_KEY,
  WA_CLOUD_APP_SECRET_KEY,
  WA_CLOUD_PHONE_NUMBER_ID_KEY,
  WA_CLOUD_TOKEN_KEY,
  WA_CLOUD_WABA_ID_KEY,
  WA_MIRROR_AUTOCREATE_KEY,
  WA_MIRROR_ENABLED_KEY,
  WA_MIRROR_SECRET_KEY,
  WA_PROVIDER_KEY,
  WABIS_API_TOKEN_KEY,
} from "@/lib/app-settings";
import { getWaProvider } from "@/lib/wa/registry";
import {
  cloudProvider,
  isCloudConfigured,
  listSubscribedApps,
  subscribeAppToWaba,
} from "@/lib/wa/cloud-provider";
import { normalizePhone } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto

/**
 * Settings for the WhatsApp module (CRM → Settings → WhatsApp Inbox).
 *
 * Without this the wa_* keys could only be set by writing AppSetting rows by
 * hand, which is not a thing to ask of an admin mid-cutover.
 *
 * Secrets are never returned in full. The access token and app secret are the
 * two credentials here that can send WhatsApp as the business, and a settings
 * page that echoes them back turns every screen-share into a leak. They come
 * back as a masked hint plus a `hasToken` flag, and an empty string on save
 * means "leave what is stored", so re-saving the form cannot silently blank a
 * credential the admin could not see.
 */

function mask(value: string | null): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return v.length <= 8 ? "••••" : `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const [
    provider,
    mirrorEnabled,
    mirrorSecret,
    autoCreate,
    phoneNumberId,
    wabaId,
    token,
    appSecret,
    apiVersion,
    broadcastEnabled,
    batchSize,
    wabisApiToken,
  ] = await Promise.all([
    getSetting(WA_PROVIDER_KEY),
    getSetting(WA_MIRROR_ENABLED_KEY),
    getSetting(WA_MIRROR_SECRET_KEY),
    getSetting(WA_MIRROR_AUTOCREATE_KEY),
    getSetting(WA_CLOUD_PHONE_NUMBER_ID_KEY),
    getSetting(WA_CLOUD_WABA_ID_KEY),
    getSetting(WA_CLOUD_TOKEN_KEY),
    getSetting(WA_CLOUD_APP_SECRET_KEY),
    getSetting(WA_CLOUD_API_VERSION_KEY),
    getSetting(WA_BROADCAST_ENABLED_KEY),
    getSetting(WA_BROADCAST_BATCH_KEY),
    getSetting(WABIS_API_TOKEN_KEY),
  ]);

  const active = await getWaProvider();
  const secret = mirrorSecret?.trim() ?? "";

  return NextResponse.json({
    provider: provider?.trim() || "wabis",
    // What is ACTUALLY live, which differs from the setting when "cloud" is
    // selected without credentials — the registry falls back rather than break
    // every send, and an admin needs to see that rather than assume.
    activeProvider: active.key,
    activeProviderLabel: active.label,
    cloudConfigured: await isCloudConfigured(),
    mirror: {
      enabled: mirrorEnabled === "1",
      autoCreateLeads: autoCreate !== "0",
      secret,
      // The URL to paste into Meta (or Wabis) — built here so nobody has to
      // assemble it by hand and get the host wrong.
      webhookUrl: secret ? `${siteBaseUrl(req)}/api/crm/wa/webhook` : null,
      verifyToken: secret || null,
    },
    cloud: {
      phoneNumberId: phoneNumberId?.trim() ?? "",
      wabaId: wabaId?.trim() ?? "",
      apiVersion: apiVersion?.trim() ?? "",
      hasToken: !!token?.trim(),
      tokenHint: mask(token),
      hasAppSecret: !!appSecret?.trim(),
      appSecretHint: mask(appSecret),
    },
    broadcasts: {
      enabled: broadcastEnabled === "1",
      batchSize: batchSize?.trim() ?? "",
    },
    wabisApi: {
      hasToken: !!wabisApiToken?.trim(),
      tokenHint: mask(wabisApiToken),
    },
  });
});

const SaveSchema = z.object({
  action: z.literal("save"),
  provider: z.enum(["wabis", "cloud"]),
  mirrorEnabled: z.boolean(),
  autoCreateLeads: z.boolean(),
  mirrorSecret: z.string().max(200),
  phoneNumberId: z.string().max(100),
  wabaId: z.string().max(100),
  apiVersion: z.string().max(20),
  /** Empty means "keep what is stored" — see the module note. */
  token: z.string().max(500),
  appSecret: z.string().max(500),
  broadcastEnabled: z.boolean(),
  batchSize: z.string().max(10),
  /** Wabis developer key, for the history import. Blank keeps what is stored. */
  wabisApiToken: z.string().max(500).default(""),
});

const TestSchema = z.object({
  action: z.literal("test_send"),
  phone: z.string().min(3).max(30),
  /** `name:language` for a template send; omit to send free text. */
  template: z.string().max(200).optional(),
  body: z.string().max(1000).optional(),
  /** Positional body params ("1", "2", …) for a template send that takes variables. */
  templateParams: z.record(z.string().max(1000)).optional(),
});

const GenerateSchema = z.object({ action: z.literal("generate_secret") });

/**
 * Save just the Wabis API key.
 *
 * Its own action because the key's field lives in the import card, well below
 * the main Save button — asking that card to submit the whole settings form
 * would make a key change silently re-save every other field on the page,
 * including ones the admin never looked at.
 */
const SaveWabisKeySchema = z.object({
  action: z.literal("save_wabis_key"),
  token: z.string().min(1).max(500),
});

/**
 * Read or create the WABA→app subscription — the object no Meta UI exposes, and
 * the reason a fully-verified webhook can still receive nothing.
 */
// Two literal members rather than one z.enum: discriminatedUnion narrows on a
// literal, and an enum leaves the remaining branches un-narrowed downstream.
const CheckWabaSchema = z.object({ action: z.literal("check_waba") });
const SubscribeWabaSchema = z.object({ action: z.literal("subscribe_waba") });

const BodySchema = z.discriminatedUnion("action", [
  SaveSchema,
  TestSchema,
  GenerateSchema,
  SaveWabisKeySchema,
  CheckWabaSchema,
  SubscribeWabaSchema,
]);

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const data = BodySchema.parse(await req.json().catch(() => null));

  if (data.action === "check_waba" || data.action === "subscribe_waba") {
    // Always list AFTER subscribing, so the response shows the resulting state
    // rather than just reporting that a call returned 200 — and so the other
    // partner's entry is visibly still there.
    const subscribed = data.action === "subscribe_waba" ? await subscribeAppToWaba() : { ok: true, detail: "" };
    const listed = await listSubscribedApps();
    return NextResponse.json({
      ok: subscribed.ok && listed.ok,
      action: data.action,
      subscribeDetail: subscribed.detail,
      apps: listed.apps,
      detail: listed.detail,
      listOk: listed.ok,
    });
  }

  if (data.action === "save_wabis_key") {
    await setSetting(WABIS_API_TOKEN_KEY, data.token.trim(), userId);
    return NextResponse.json({ ok: true });
  }

  if (data.action === "generate_secret") {
    const secret = randomBytes(24).toString("hex");
    await setSetting(WA_MIRROR_SECRET_KEY, secret, userId);
    return NextResponse.json({ ok: true, secret });
  }

  if (data.action === "save") {
    await Promise.all([
      setSetting(WA_PROVIDER_KEY, data.provider, userId),
      setSetting(WA_MIRROR_ENABLED_KEY, data.mirrorEnabled ? "1" : "0", userId),
      setSetting(WA_MIRROR_AUTOCREATE_KEY, data.autoCreateLeads ? "1" : "0", userId),
      setSetting(WA_MIRROR_SECRET_KEY, data.mirrorSecret.trim(), userId),
      setSetting(WA_CLOUD_PHONE_NUMBER_ID_KEY, data.phoneNumberId.trim(), userId),
      setSetting(WA_CLOUD_WABA_ID_KEY, data.wabaId.trim(), userId),
      setSetting(WA_CLOUD_API_VERSION_KEY, data.apiVersion.trim(), userId),
      setSetting(WA_BROADCAST_ENABLED_KEY, data.broadcastEnabled ? "1" : "0", userId),
      setSetting(WA_BROADCAST_BATCH_KEY, data.batchSize.trim(), userId),
    ]);

    // Blank means "unchanged" — the form never received the real value, so
    // treating blank as "clear it" would delete a credential on any re-save.
    if (data.token.trim()) await setSetting(WA_CLOUD_TOKEN_KEY, data.token.trim(), userId);
    if (data.appSecret.trim()) await setSetting(WA_CLOUD_APP_SECRET_KEY, data.appSecret.trim(), userId);
    if (data.wabisApiToken.trim()) await setSetting(WABIS_API_TOKEN_KEY, data.wabisApiToken.trim(), userId);

    return NextResponse.json({ ok: true });
  }

  // test_send — prove the transport works without a conversation, a webhook or
  // a subscription. This is the whole point: outbound needs only a token and a
  // phone number id, so the Cloud adapter can be verified end to end while
  // Wabis carries on untouched.
  const toE164 = normalizePhone(data.phone);
  if (!toE164) throw badRequest("That doesn't look like a sendable number", "bad_phone");

  // Prefer the Cloud API whenever it is configured, EVEN IF the live transport
  // is still Wabis.
  //
  // That is the whole point of this button: prove the Cloud credentials work
  // before making them live, with Wabis still carrying real traffic. Routing the
  // test through the live transport instead made it fail on a capability Wabis
  // does not have, which says nothing about the thing being tested and reads as
  // though the credentials were wrong.
  const provider = (await isCloudConfigured()) ? cloudProvider : await getWaProvider();
  const result = data.template
    ? await provider.sendTemplate({
        toE164,
        template: data.template,
        params: data.templateParams ?? {},
        endpointUrl: null,
      })
    : await provider.sendText({ toE164, body: data.body?.trim() || "DesGro CRM test message." });

  return NextResponse.json({
    ok: result.ok,
    provider: provider.key,
    providerLabel: provider.label,
    providerMessageId: result.providerMessageId,
    status: result.status,
    unsupported: !!result.unsupported,
    detail: result.body,
  });
});
