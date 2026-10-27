import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { siteBaseUrl } from "@/lib/site-url";
import {
  getSetting,
  setSetting,
  WA_CLOUD_APP_SECRET_KEY,
  WA_ES_CONFIG_ID_KEY,
  WA_META_APP_ID_KEY,
} from "@/lib/app-settings";
import { isCloudConfigured } from "@/lib/wa/cloud-provider";
import { completeCoexistenceOnboarding, listCoexistenceNumbers } from "@/lib/wa/coexistence";
import { CONNECT_PAGE_PATH } from "@/lib/wa/embedded-signup";

export const dynamic = "force-dynamic";

/**
 * Embedded Signup for a WhatsApp Business app number (Coexistence) — see
 * src/lib/wa/coexistence.ts. Same gate as the rest of the WhatsApp settings.
 */

async function requireSettingsAccess(): Promise<string> {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();
  return userId;
}

export const GET = withApiHandler(async (req: Request) => {
  await requireSettingsAccess();
  const [appId, configId, appSecret, cloudConfigured, numbers] = await Promise.all([
    getSetting(WA_META_APP_ID_KEY),
    getSetting(WA_ES_CONFIG_ID_KEY),
    getSetting(WA_CLOUD_APP_SECRET_KEY),
    isCloudConfigured(),
    listCoexistenceNumbers(),
  ]);
  return NextResponse.json({
    appId: appId?.trim() ?? "",
    configId: configId?.trim() ?? "",
    hasAppSecret: !!appSecret?.trim(),
    cloudConfigured,
    // What Meta's "Valid OAuth Redirect URIs" must contain, built from the live
    // host so nobody types it by hand.
    redirectUri: `${siteBaseUrl(req)}${CONNECT_PAGE_PATH}`,
    numbers,
  });
});

/** Meta ids are numeric; anything else would be spliced into a Graph path. */
const metaId = z.string().trim().regex(/^\d{5,30}$/, "Must be a numeric Meta ID");

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_config"), appId: metaId, configId: metaId }),
  z.object({
    action: z.literal("complete"),
    /** The popup's exchangeable code. Absent on a manual re-run. */
    code: z.string().trim().min(1).max(2000).optional(),
    wabaId: metaId,
    phoneNumberId: metaId,
    event: z.string().trim().max(80).optional(),
  }),
]);

export const POST = withApiHandler(async (req: Request) => {
  const userId = await requireSettingsAccess();
  const data = BodySchema.parse(await req.json().catch(() => null));

  if (data.action === "save_config") {
    await Promise.all([
      setSetting(WA_META_APP_ID_KEY, data.appId, userId),
      setSetting(WA_ES_CONFIG_ID_KEY, data.configId, userId),
    ]);
    return NextResponse.json({ ok: true });
  }

  const number = await completeCoexistenceOnboarding({
    code: data.code ?? null,
    wabaId: data.wabaId,
    phoneNumberId: data.phoneNumberId,
    event: data.event ?? null,
    userId,
  });
  // `subscribe` is the step that decides whether messages arrive at all.
  const subscribed = number.steps.find((s) => s.key === "subscribe")?.ok ?? false;
  return NextResponse.json({ ok: subscribed, number });
});
