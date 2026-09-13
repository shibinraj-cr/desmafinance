import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  SecretVaultError,
  decryptSecret,
  encryptSecret,
  isEncryptedPayload,
  isSecretVaultConfigured,
  secretEquals,
} from "../src/lib/wealth-crypto";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

const original = process.env.WEALTH_SECRET_KEY;

beforeEach(() => {
  process.env.WEALTH_SECRET_KEY = KEY_A;
});

afterEach(() => {
  if (original === undefined) delete process.env.WEALTH_SECRET_KEY;
  else process.env.WEALTH_SECRET_KEY = original;
});

describe("configuration", () => {
  it("is on with a 32-byte base64 key", () => {
    expect(isSecretVaultConfigured()).toBe(true);
  });

  it("accepts a 32-byte hex key too", () => {
    process.env.WEALTH_SECRET_KEY = randomBytes(32).toString("hex");
    expect(isSecretVaultConfigured()).toBe(true);
  });

  it("is off when the variable is unset", () => {
    delete process.env.WEALTH_SECRET_KEY;
    expect(isSecretVaultConfigured()).toBe(false);
  });

  it("is off — not silently weaker — when the key is the wrong length", () => {
    process.env.WEALTH_SECRET_KEY = randomBytes(16).toString("base64");
    expect(isSecretVaultConfigured()).toBe(false);
  });

  it("refuses to encrypt with no key configured", () => {
    delete process.env.WEALTH_SECRET_KEY;
    expect(() => encryptSecret("hunter2")).toThrow(SecretVaultError);
  });
});

describe("round trip", () => {
  it("returns exactly what went in", () => {
    const plain = "p@ssw0rd with spaces & symbols ✓";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("produces a different ciphertext every time for the same input", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("never leaks the plaintext into the stored payload", () => {
    const payload = encryptSecret("TopSecret123");
    expect(payload).not.toContain("TopSecret123");
    expect(Buffer.from(payload).toString("utf8")).not.toContain("TopSecret123");
  });

  it("refuses an empty secret rather than storing a decryptable blank", () => {
    expect(() => encryptSecret("")).toThrow(SecretVaultError);
  });
});

describe("tamper and key handling", () => {
  it("fails closed when the ciphertext is altered", () => {
    const payload = encryptSecret("hunter2");
    const parts = payload.split(".");
    // Flip a character in the ciphertext segment.
    parts[3] = parts[3].startsWith("A") ? "B" + parts[3].slice(1) : "A" + parts[3].slice(1);
    expect(() => decryptSecret(parts.join("."))).toThrow(SecretVaultError);
  });

  it("fails closed when the auth tag is altered", () => {
    const parts = encryptSecret("hunter2").split(".");
    parts[2] = parts[2].startsWith("A") ? "B" + parts[2].slice(1) : "A" + parts[2].slice(1);
    expect(() => decryptSecret(parts.join("."))).toThrow(SecretVaultError);
  });

  it("cannot be decrypted with a different key", () => {
    const payload = encryptSecret("hunter2");
    process.env.WEALTH_SECRET_KEY = KEY_B;
    expect(() => decryptSecret(payload)).toThrow(SecretVaultError);
  });

  it("rejects an unrecognised payload format", () => {
    expect(() => decryptSecret("just-a-string")).toThrow(SecretVaultError);
    expect(() => decryptSecret("v2.a.b.c")).toThrow(SecretVaultError);
    expect(() => decryptSecret("v1.a.b.c")).toThrow(SecretVaultError);
  });
});

describe("helpers", () => {
  it("recognises its own payloads and nothing else", () => {
    expect(isEncryptedPayload(encryptSecret("x"))).toBe(true);
    expect(isEncryptedPayload("plain text")).toBe(false);
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload("")).toBe(false);
  });

  it("compares secrets without leaking length-independent timing", () => {
    expect(secretEquals("abc", "abc")).toBe(true);
    expect(secretEquals("abc", "abd")).toBe(false);
    expect(secretEquals("abc", "abcd")).toBe(false);
  });
});
