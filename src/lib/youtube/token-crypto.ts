import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encryption for the stored Google refresh token (YouTube Insights).
 *
 * Same shape as src/lib/wealth-crypto.ts — AES-256-GCM, random 12-byte IV,
 * fixed AAD — but the key is DERIVED from NEXTAUTH_SECRET with HKDF rather
 * than read from a dedicated variable, so the integration needs no extra
 * secret to configure. The point is the same: a DB dump or a Neon branch
 * handed out for debugging must not carry a live Google credential.
 *
 * Rotating NEXTAUTH_SECRET makes the stored token undecryptable; the sync
 * then reports "reconnect the channel", and one click on Connect fixes it.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from("desgro.youtube.refresh-token");

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "desgro", "youtube-refresh-token", 32));
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Throws when the token was sealed with a different key or tampered with. */
export function decryptToken(sealed: string): string {
  const [ver, ivB, tagB, ctB] = sealed.split(".");
  if (ver !== VERSION || !ivB || !tagB || ctB === undefined) throw new Error("malformed token");
  const iv = Buffer.from(ivB, "base64url");
  const tag = Buffer.from(tagB, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("malformed token");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}
