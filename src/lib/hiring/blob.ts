import { put, get } from "@vercel/blob";

/**
 * File storage for the hiring module.
 *
 * Separate from `ops-blob.ts` because that one uploads with `access: "public"`
 * and this Blob store is configured private — a public upload is refused
 * outright ("Cannot use public access on a private store").
 *
 * Private is also the right answer here regardless of the store's setting. A
 * résumé is somebody's personal data; an unguessable-but-public URL is still a
 * public URL, and one that leaks by being pasted into a chat or a ticket. These
 * files are readable only through `/api/hiring/files/...`, which checks the
 * caller first.
 *
 * What is stored on the record is that SERVING PATH, not a storage URL, so the
 * UI links to something that will still resolve when the storage layer changes.
 */

/** The route that serves a stored file, checking access on the way through. */
export const HIRING_FILE_PREFIX = "/api/hiring/files/";

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Store a file and return the path to serve it from. `addRandomSuffix` keeps
 * two candidates called `resume.pdf` from colliding.
 */
export async function uploadHiringFile(
  pathname: string,
  body: ArrayBuffer | Buffer,
  contentType: string,
): Promise<string> {
  const blob = await put(pathname, body, {
    access: "private",
    contentType,
    addRandomSuffix: true,
  });
  return HIRING_FILE_PREFIX + blob.pathname;
}

/** True when a stored reference is one of ours rather than an external link. */
export function isHiringFile(url: string | null | undefined): boolean {
  return !!url && url.startsWith(HIRING_FILE_PREFIX);
}

/** The blob pathname behind a serving path. */
export function blobPathnameFor(url: string): string {
  return url.slice(HIRING_FILE_PREFIX.length);
}

export type StoredFile = { bytes: Buffer; contentType: string };

/**
 * Read a stored file back. Used by the serving route and by anything that needs
 * the bytes server-side — résumé parsing, for one, which cannot simply `fetch`
 * a private blob.
 */
export async function readHiringFile(pathname: string): Promise<StoredFile | null> {
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
