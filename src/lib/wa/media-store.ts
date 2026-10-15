/**
 * Our own copy of a WhatsApp attachment, in PRIVATE blob storage.
 *
 * The archive used to go through `ops-blob.ts`, which uploads with
 * `access: "public"`. This Blob store is configured private, and Vercel refuses
 * a public upload to it outright ("Cannot use public access on a private
 * store") — so every copy the archiver attempted was downloaded from Meta and
 * then thrown away at the last step. Nothing was ever kept, and once Meta's
 * window closed a candidate's CV simply stopped opening.
 *
 * Private is also the right answer regardless of the store's setting: these are
 * candidates' CVs, passports and voice notes, and an unguessable-but-public URL
 * is still a public URL. They are readable only through
 * `/api/crm/wa/media/<messageId>`, which checks the conversation first.
 *
 * What `mediaStoredUrl` holds is the blob PATHNAME, not a URL — a private blob's
 * URL cannot be fetched without our token anyway. A value that does start with
 * http(s) is a copy from before this change and is still read as one.
 */
import { put, get } from "@vercel/blob";
import { logger } from "../logger";
import type { WaMediaStream } from "./provider";

/** A stored reference that is a plain URL rather than one of our private pathnames. */
function isUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

/** Store the bytes privately and return the pathname to keep on the message. */
export async function storeWaMedia(messageId: string, bytes: ArrayBuffer, mime: string | null): Promise<string> {
  const blob = await put(
    // Namespaced by message so two attachments can never collide, and so a
    // stray blob can be traced back to the conversation it belongs to.
    `wa-media/${messageId}${extensionFor(mime)}`,
    bytes,
    { access: "private", contentType: mime || "application/octet-stream", addRandomSuffix: true },
  );
  return blob.pathname;
}

/**
 * Open our copy for streaming, or null when it is not there.
 *
 * The browser's byte range is passed through, so scrubbing a voice note or
 * paging through a long PDF costs a slice rather than the whole file again.
 */
export async function openStoredWaMedia(ref: string, range: string | null): Promise<WaMediaStream | null> {
  if (isUrl(ref)) return null;

  let result: Awaited<ReturnType<typeof get>>;
  try {
    result = await get(ref, { access: "private", ...(range ? { headers: { range } } : {}) });
  } catch (e) {
    // Not fatal to the caller: the provider may still hold the original.
    logger.warn("wa_media_store_read_failed", { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
  if (!result || !result.stream) return null;

  const contentRange = result.headers.get("content-range");
  return {
    body: result.stream,
    mime: result.blob.contentType,
    fileName: null,
    contentLength: result.headers.get("content-length"),
    contentRange,
    // get() reports any success as 200; the 206 is only visible in the headers.
    status: contentRange ? 206 : 200,
  };
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
  if (m.includes("wordprocessingml")) return ".docx";
  if (m.includes("msword")) return ".doc";
  return "";
}
