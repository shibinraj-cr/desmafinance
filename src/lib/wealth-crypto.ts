import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption for stored portal passwords on the Personal Wealth page.
 *
 * The threat this actually addresses: a database dump, a Neon branch handed to
 * someone for debugging, or a stray backup. None of those should hand over the
 * owner's investment-portal logins in clear text. It does NOT defend against an
 * attacker who already has the running app's environment — if they hold
 * WEALTH_SECRET_KEY they can decrypt, which is why the reveal endpoint is
 * owner-gated and audited on top of this.
 *
 * AES-256-GCM, random 12-byte IV per write, 16-byte auth tag, and a fixed AAD
 * so a ciphertext cannot be lifted out of this field and replayed somewhere
 * else that shares the key.
 *
 * The key lives ONLY in the WEALTH_SECRET_KEY environment variable — 32 bytes,
 * base64 or hex. Generate one with:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * With the variable unset, the vault reports itself unconfigured and the UI
 * hides the password field rather than storing anything in clear. That is the
 * deliberate default: no key, no secrets.
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const AAD = Buffer.from("desgro.wealth.portal");

export class SecretVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretVaultError";
  }
}

/** Parse WEALTH_SECRET_KEY into 32 raw bytes. Null when unset or malformed. */
function loadKey(): Buffer | null {
  const raw = process.env.WEALTH_SECRET_KEY?.trim();
  if (!raw) return null;

  // Hex first (a 64-char hex string is also valid base64url, and hex is the
  // narrower reading), then base64/base64url.
  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, "hex");
  } else {
    try {
      buf = Buffer.from(raw, "base64");
    } catch {
      buf = null;
    }
  }
  if (!buf || buf.length !== KEY_BYTES) return null;
  return buf;
}

/** Whether password storage is switched on for this deployment. */
export function isSecretVaultConfigured(): boolean {
  return loadKey() !== null;
}

function requireKey(): Buffer {
  const k = loadKey();
  if (!k) {
    throw new SecretVaultError(
      "WEALTH_SECRET_KEY is not set (or is not 32 bytes of base64/hex), so portal passwords cannot be stored.",
    );
  }
  return k;
}

/**
 * Encrypt a portal password. Returns `v1.<iv>.<tag>.<ciphertext>`, all
 * base64url — one opaque string that fits a single TEXT column.
 */
export function encryptSecret(plain: string): string {
  if (plain.length === 0) throw new SecretVaultError("Refusing to encrypt an empty secret.");
  const key = requireKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(iv), b64(tag), b64(ct)].join(".");
}

/**
 * Decrypt a stored secret. Throws when the key is wrong, the payload was
 * tampered with, or the format is not recognised — never returns a partial or
 * garbled string.
 */
export function decryptSecret(payload: string): string {
  const key = requireKey();
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretVaultError("Stored secret is not in the expected format.");
  }
  const iv = unb64(parts[1]);
  const tag = unb64(parts[2]);
  const ct = unb64(parts[3]);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretVaultError("Stored secret has an invalid IV or authentication tag.");
  }
  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // GCM's own failure, re-thrown as ours so callers have one error type.
    throw new SecretVaultError("Stored secret could not be decrypted — wrong key or altered data.");
  }
}

/**
 * Whether a stored payload looks like something this module wrote. Used to
 * decide whether to show a "Reveal" button without attempting a decrypt.
 */
export function isEncryptedPayload(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  return parts.length === 4 && parts[0] === VERSION;
}

/** Constant-time compare, for anywhere a stored value is checked against input. */
export function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function b64(b: Buffer): string {
  return b.toString("base64url");
}

function unb64(s: string): Buffer {
  return Buffer.from(s, "base64url");
}
