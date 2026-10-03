/**
 * Header media for WhatsApp broadcasts, uploaded straight into DesGro.
 *
 * Meta fetches a template's header media from a public https link on every
 * send, so a campaign used to need the image hosted somewhere else first. The
 * Blob store is PRIVATE (a public `put` is refused outright — see
 * hiring/blob.ts), so instead the file is stored privately and served from our
 * own unauthenticated route, `/api/wa-media/<pathname>`. That URL drops into the
 * campaign's existing `headerMediaUrl`, so drafts, the drain and re-sends need
 * no changes, and unlike a Meta media id it never expires.
 *
 * Public on purpose: these are marketing creatives about to be sent to
 * thousands of people. The serving route reads ONLY under BROADCAST_MEDIA_PREFIX,
 * so it can never be pointed at a résumé or any other private blob.
 */
import { put, get } from "@vercel/blob";

export type HeaderMediaKind = "image" | "video" | "document";

export const BROADCAST_MEDIA_PREFIX = "wa-broadcast-media/";
export const BROADCAST_MEDIA_ROUTE = "/api/wa-media/";

/**
 * Below both Meta's smallest header limit (5 MB for images) and Vercel's 4.5 MB
 * request-body ceiling, which would otherwise reject the upload with an opaque
 * 413 before our code runs.
 */
export const MAX_HEADER_MEDIA_BYTES = 4 * 1024 * 1024;

/** The formats Meta accepts for each template header kind. */
export const HEADER_MEDIA_MIMES: Record<HeaderMediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png"],
  video: ["video/mp4", "video/3gpp"],
  document: ["application/pdf"],
};

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Null when the file is acceptable, else the reason to show the user. */
export function headerMediaProblem(kind: HeaderMediaKind, mime: string, size: number): string | null {
  const allowed = HEADER_MEDIA_MIMES[kind];
  if (!allowed.includes(mime)) {
    const names = allowed.map((m) => m.split("/")[1].toUpperCase()).join(" or ");
    return `A ${kind} header must be ${names}`;
  }
  if (size <= 0) return "The file is empty";
  if (size > MAX_HEADER_MEDIA_BYTES) return "The file must be 4 MB or smaller";
  return null;
}

/** Keeps the blob key (and so the public URL) to plain, unambiguous characters. */
export function safeFileName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(-80) || "header";
}

/**
 * Whether a requested path may be served publicly. Anything outside the
 * broadcast-media prefix is refused, as is any dot-segment, so the public route
 * cannot be used to read another module's private files.
 */
export function isServableBroadcastMediaPath(pathname: string): boolean {
  if (!pathname.startsWith(BROADCAST_MEDIA_PREFIX)) return false;
  return !pathname.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

/** Store the file privately and return its blob pathname. */
export async function storeBroadcastMedia(
  kind: HeaderMediaKind,
  fileName: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const blob = await put(`${BROADCAST_MEDIA_PREFIX}${kind}/${safeFileName(fileName)}`, body, {
    access: "private",
    contentType,
    addRandomSuffix: true,
  });
  return blob.pathname;
}

export async function readBroadcastMedia(pathname: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  const chunks: Uint8Array[] = [];
  // @ts-expect-error — a web ReadableStream is async-iterable at runtime in Node 18+.
  for await (const chunk of result.stream) chunks.push(chunk as Uint8Array);

  return {
    bytes: Buffer.concat(chunks),
    contentType: result.headers?.get("content-type") ?? "application/octet-stream",
  };
}
