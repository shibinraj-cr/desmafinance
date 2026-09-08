import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { getMetaPixelId, setMetaPixelId, isValidPixelId, META_PIXEL_KEY } from "@/lib/hiring/pixel";

export const dynamic = "force-dynamic";

const schema = z.object({ pixelId: z.string().trim().max(64) });

/**
 * PUT /api/hiring/meta-pixel — set or clear the careers-site pixel.
 *
 * Audited like the publish switch: "when did we start sending careers traffic
 * to Meta, and who turned it on" is a question worth being able to answer.
 */
export const PUT = withApiHandler(async (req: Request) => {
  const access = await requireHiring("team:manage");
  const { pixelId } = schema.parse(await req.json());

  // Marketing pastes the whole <script> block more often than not; say what is
  // wanted rather than silently storing something that will never fire.
  if (pixelId && !isValidPixelId(pixelId)) {
    throw badRequest(
      "That does not look like a pixel ID. Paste just the number from fbq('init', '…') — digits only.",
      "bad_pixel_id",
    );
  }

  const before = await getMetaPixelId();
  await setMetaPixelId(pixelId || null, access.userId);

  await recordHiringAudit({
    actorId: access.userId,
    action: pixelId ? "careers.pixel_set" : "careers.pixel_cleared",
    entityType: "AppSetting",
    entityId: META_PIXEL_KEY,
    before: { pixelId: before },
    after: { pixelId: pixelId || null },
  });

  return NextResponse.json({ pixelId: pixelId || null });
});
