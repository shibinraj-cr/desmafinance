import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Sealing for every bank-automation secret at rest: the statement password
 * (when stored in the DB rather than a deployment secret), the Gmail refresh
 * token, and each e-mail's SmartStatement link.
 *
 * Same construction as src/lib/youtube/token-crypto.ts — AES-256-GCM, random
 * 12-byte IV, a per-purpose AAD so a value sealed for one purpose cannot be
 * replayed as another. The key comes from BANK_SECRETS_KEY when set (so it can
 * rotate independently of sessions), else is HKDF-derived from NEXTAUTH_SECRET.
 * Rotating whichever is in use makes stored values undecryptable: the UI then
 * asks for the password / a mailbox reconnect, which is the safe failure.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type SecretPurpose = "statement-password" | "gmail-refresh-token" | "statement-url";

function key(): Buffer {
  const dedicated = process.env.BANK_SECRETS_KEY?.trim();
  const secret = dedicated || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("BANK_SECRETS_KEY / NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "desgro", "bank-automation", 32));
}

function aad(purpose: SecretPurpose): Buffer {
  return Buffer.from(`desgro.bank.${purpose}`);
}

export function seal(plain: string, purpose: SecretPurpose): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(purpose));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Throws when sealed with a different key or purpose, or tampered with. */
export function unseal(sealed: string, purpose: SecretPurpose): string {
  const [ver, ivB, tagB, ctB] = sealed.split(".");
  if (ver !== VERSION || !ivB || !tagB || ctB === undefined) throw new Error("malformed secret");
  const iv = Buffer.from(ivB, "base64url");
  const tag = Buffer.from(tagB, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("malformed secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(aad(purpose));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/** `env:NAME` → NAME; anything else is not an env reference. */
export function envSecretName(ref: string): string | null {
  const m = /^env:([A-Z][A-Z0-9_]{1,63})$/.exec(ref.trim());
  return m ? m[1] : null;
}

/**
 * Scrub secrets out of any text that is about to be logged, stored as an
 * error, or shown in the UI. Removes the given literal values (the password)
 * wherever they appear, plus anything shaped like a bearer token, an OAuth
 * token, a cookie header, or a SmartStatement job key / query string.
 */
export function redact(text: string, secrets: Array<string | null | undefined> = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 3) out = out.split(s).join("••••••");
  }
  return out
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1••••••")
    .replace(/\b(ya29|1\/\/)[A-Za-z0-9._-]+/g, "••••••")
    .replace(/((?:access|refresh)_token["'=:\s]+)[^\s"'&,]+/gi, "$1••••••")
    .replace(/((?:set-)?cookie["'=:\s]+)[^\n]+/gi, "$1••••••")
    .replace(/(jobkey=)[^\s&"']+/gi, "$1••••••")
    .replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']+/g, "$1?••••••")
    .slice(0, 2000);
}
