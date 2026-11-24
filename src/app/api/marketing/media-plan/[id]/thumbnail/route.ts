import { NextResponse } from "next/server";
import { del, get, put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import {
  MEDIA_THUMBNAIL_MAX_BYTES,
  MEDIA_THUMBNAIL_TYPES,
  canUseMediaPlanner,
  mediaItemInclude,
  serializeMediaItem,
} from "@/lib/media-plan";

export const dynamic = "force-dynamic";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function requirePlannerAccess() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canUseMediaPlanner(perms)) throw forbidden();
  return userId;
}

async function dropBlob(pathname: string | null) {
  if (!pathname) return;
  try {
    await del(pathname);
  } catch {
    /* already gone, or a storage hiccup — the row is what matters */
  }
}

/**
 * GET /api/marketing/media-plan/[id]/thumbnail — the uploaded cover frame.
 * The Blob store is private, so the image is streamed through here behind the
 * planner's access check. The URL carries ?v=<updatedAt>, so it can be cached.
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requirePlannerAccess();
  const item = await prisma.mediaPlanItem.findUnique({
    where: { id: params.id },
    select: { thumbnailPath: true },
  });
  if (!item?.thumbnailPath) throw notFound();
  const result = await get(item.thumbnailPath, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) throw notFound();
  return new Response(result.stream as ReadableStream, {
    headers: {
      "content-type": result.blob.contentType || "image/jpeg",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
});

/** POST multipart/form-data { file } — set or replace the item's thumbnail. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const userId = await requirePlannerAccess();
  const existing = await prisma.mediaPlanItem.findUnique({
    where: { id: params.id },
    select: { id: true, thumbnailPath: true },
  });
  if (!existing) throw notFound();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw badRequest("Attach an image as 'file'.", "no_file");
  if (!(MEDIA_THUMBNAIL_TYPES as readonly string[]).includes(file.type)) {
    throw badRequest("Thumbnail must be a JPEG, PNG or WebP image.", "bad_type");
  }
  if (file.size === 0 || file.size > MEDIA_THUMBNAIL_MAX_BYTES) {
    throw badRequest("Thumbnail must be under 2 MB.", "too_large");
  }

  const pathname = `media-plan/thumbnails/${existing.id}-${Date.now()}.${EXT[file.type]}`;
  await put(pathname, Buffer.from(await file.arrayBuffer()), {
    access: "private",
    contentType: file.type,
    addRandomSuffix: false,
  });

  const item = await prisma.mediaPlanItem.update({
    where: { id: existing.id },
    data: { thumbnailPath: pathname, thumbnailUpdatedAt: new Date() },
    include: mediaItemInclude,
  });
  await dropBlob(existing.thumbnailPath);

  await recordAudit({
    entityType: "MediaPlanItem",
    entityId: item.id,
    action: "UPDATE",
    userId,
    changes: { thumbnail: "uploaded" },
  });
  return NextResponse.json({ item: serializeMediaItem(item) });
});

/** DELETE — remove the uploaded thumbnail (a YouTube link still shows YouTube's). */
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const userId = await requirePlannerAccess();
  const existing = await prisma.mediaPlanItem.findUnique({
    where: { id: params.id },
    select: { id: true, thumbnailPath: true },
  });
  if (!existing) throw notFound();

  const item = await prisma.mediaPlanItem.update({
    where: { id: existing.id },
    data: { thumbnailPath: null, thumbnailUpdatedAt: null },
    include: mediaItemInclude,
  });
  await dropBlob(existing.thumbnailPath);

  await recordAudit({
    entityType: "MediaPlanItem",
    entityId: item.id,
    action: "UPDATE",
    userId,
    changes: { thumbnail: "removed" },
  });
  return NextResponse.json({ item: serializeMediaItem(item) });
});
