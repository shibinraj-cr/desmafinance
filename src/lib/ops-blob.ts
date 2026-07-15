import { put, del } from "@vercel/blob";

/**
 * Vercel Blob storage for operations proof files. `BLOB_READ_WRITE_TOKEN` must
 * be set in the environment (created with the Blob store in the Vercel project);
 * `isBlobConfigured()` lets the API return a clean error before it's wired up.
 */

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Upload a proof file; returns its public (unguessable) blob URL. */
export async function uploadProof(
  pathname: string,
  body: ArrayBuffer | Buffer,
  contentType: string,
): Promise<string> {
  const blob = await put(pathname, body, { access: "public", contentType, addRandomSuffix: true });
  return blob.url;
}

/** Best-effort delete of a proof blob by URL. */
export async function deleteProof(url: string): Promise<void> {
  await del(url);
}
