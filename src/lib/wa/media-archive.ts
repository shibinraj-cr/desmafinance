/**
 * Keeping WhatsApp attachments after the provider stops holding them.
 *
 * Everything the CRM knows about an attachment today is BORROWED, on two clocks
 * that are both already running:
 *
 *   - A Cloud API `mediaId` resolves for SEVEN DAYS after Meta delivers the
 *     message, then never again. So a voice note nobody happened to open within
 *     the week is already gone, quietly, and the loss is only discovered by
 *     someone going back to look for a conversation that mattered.
 *   - An imported row's `mediaUrl` points at Wabis's own storage. That works
 *     exactly as long as the subscription does, which is a decision somebody is
 *     about to take for unrelated reasons.
 *
 * So the bytes are copied into our own blob storage. After that the attachment
 * outlives the provider it arrived through, which is the only arrangement under
 * which "read the history in the CRM" means anything a year from now.
 *
 * Deliberately a SWEEP rather than part of ingest. The webhook has to answer Meta
 * quickly or the message is redelivered, and downloading a file is exactly the
 * kind of work that turns a fast acknowledgement into a slow one — a media
 * download failing must never turn into a message we did not store. A daily pass
 * is ample against a seven-day window, and the same function drives an admin
 * button for the backfill, so there is one implementation and one place to be
 * wrong.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { logger } from "../logger";
import { getWaProvider } from "./registry";
import { isBlobConfigured, uploadProof } from "../ops-blob";

/** Stop well inside the platform's ceiling; the caller runs it again. */
const TIME_BUDGET_MS = 45_000;
/** Each item is a download plus an upload, so modest concurrency, not none. */
const CONCURRENCY = 4;
/**
 * Refuse anything implausible for a WhatsApp attachment.
 *
 * Meta's own ceiling is 16 MB for audio and 100 MB for video. This is a
 * guard against a pathological response, not a policy — the point is that a
 * runaway download cannot spend the whole budget on one row.
 */
const MAX_BYTES = 32 * 1024 * 1024;

export type MediaArchiveSummary = {
  considered: number;
  stored: number;
  /** Media the provider no longer has. Counted, because it is the loss we are racing. */
  expired: number;
  failed: number;
  stoppedEarly: boolean;
  remaining: number;
  errors: string[];
};

/**
 * Copy one message's attachment into our storage.
 *
 * Returns `expired` rather than `failed` when the provider simply no longer has
 * the file: nothing is wrong, we were too late, and a retry would only be
 * another way of being too late. Marking it stops the sweep reconsidering the
 * same dead rows on every run — it stamps `mediaStoredAt` with no URL, which
 * reads as "we looked, and there was nothing to take".
 */
async function archiveOne(message: {
  id: string;
  mediaId: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  fileName: string | null;
}): Promise<"stored" | "expired" | "failed"> {
  let bytes: ArrayBuffer | null = null;
  let mime = message.mediaMime;

  if (message.mediaId) {
    const provider = await getWaProvider();
    if (provider.supports("fetchMedia")) {
      const opened = await provider.downloadMedia(message.mediaId);
      if (opened) {
        bytes = await new Response(opened.body).arrayBuffer();
        mime = mime ?? opened.mime;
      }
    }
  }

  // Wabis's storage, for imported rows. Reached only when there is no media id
  // or Meta no longer has it — the provider's own copy is the better source
  // while it exists.
  if (!bytes && message.mediaUrl && /^https?:\/\//i.test(message.mediaUrl)) {
    try {
      const res = await fetch(message.mediaUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        bytes = await res.arrayBuffer();
        mime = mime ?? res.headers.get("content-type");
      }
    } catch {
      // Falls through to `expired` — a host that will not answer and a file that
      // is gone are the same outcome from here.
    }
  }

  if (!bytes) {
    await prisma.waMessage
      .update({ where: { id: message.id }, data: { mediaStoredAt: new Date() } })
      .catch(() => undefined);
    return "expired";
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    await prisma.waMessage
      .update({ where: { id: message.id }, data: { mediaStoredAt: new Date() } })
      .catch(() => undefined);
    return "expired";
  }

  try {
    const url = await uploadProof(
      // Namespaced by message so two attachments can never collide, and so a
      // stray blob can be traced back to the conversation it belongs to.
      `wa-media/${message.id}${extensionFor(mime)}`,
      bytes,
      mime || "application/octet-stream",
    );
    await prisma.waMessage.update({
      where: { id: message.id },
      data: { mediaStoredUrl: url, mediaStoredAt: new Date(), mediaMime: mime ?? undefined },
    });
    return "stored";
  } catch (e) {
    // NOT stamped: an upload that failed for our own reasons is worth retrying,
    // unlike a file the provider has deleted.
    logger.warn("wa_media_archive_failed", {
      messageId: message.id,
      message: e instanceof Error ? e.message : String(e),
    });
    return "failed";
  }
}

/** A sensible file extension, so a stored blob is recognisable when downloaded. */
function extensionFor(mime: string | null): string {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("aac")) return ".aac";
  if (m.includes("amr")) return ".amr";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("pdf")) return ".pdf";
  return "";
}

/**
 * Archive the next batch of attachments that have no copy of their own.
 *
 * NEWEST FIRST, which is the whole strategy in one `orderBy`. The seven-day
 * window means the youngest messages are the only ones still recoverable, so a
 * sweep that started at the beginning of history would spend its budget on rows
 * that are already lost while fresh ones expired behind it.
 */
export async function archivePendingMedia(opts: { limit?: number } = {}): Promise<MediaArchiveSummary> {
  const summary: MediaArchiveSummary = {
    considered: 0,
    stored: 0,
    expired: 0,
    failed: 0,
    stoppedEarly: false,
    remaining: 0,
    errors: [],
  };

  if (!isBlobConfigured()) {
    summary.errors.push("Blob storage is not configured — set BLOB_READ_WRITE_TOKEN.");
    return summary;
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  // Holds a media reference of some kind, and has no copy of its own yet.
  const pending: Prisma.WaMessageWhereInput = {
    mediaStoredAt: null,
    OR: [{ mediaId: { not: null } }, { mediaUrl: { not: null } }],
  };

  const queue = await prisma.waMessage.findMany({
    where: pending,
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: { id: true, mediaId: true, mediaUrl: true, mediaMime: true, fileName: true },
  });

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    if (Date.now() > deadline) {
      summary.stoppedEarly = true;
      break;
    }
    const slice = queue.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map((m) => archiveOne(m).catch(() => "failed" as const)));
    summary.considered += slice.length;
    for (const r of results) summary[r === "stored" ? "stored" : r === "expired" ? "expired" : "failed"]++;
  }

  summary.remaining = await prisma.waMessage.count({ where: pending }).catch(() => 0);
  return summary;
}
