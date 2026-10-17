import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { extractText } from "unpdf";
import {
  OTP_LOCK_MS,
  OTP_MAX_ATTEMPTS,
  checkOtp,
  hashOtp,
  mintSession,
  newOtpCode,
  sessionCookieName,
  verifySession,
} from "@/lib/esign/otp";
import { checkSubmission, decodePng, signerFields } from "@/lib/esign/submission";
import { appendCertificate } from "@/lib/esign/certificate";
import { openForStamping } from "@/lib/esign/stamp";
import type { TemplateField } from "@/lib/esign/template-fields";
import { sendProblems } from "@/lib/esign/requests";

process.env.NEXTAUTH_SECRET ??= "test-secret-for-esign-sessions";
const now = new Date("2026-10-17T06:00:00Z");

describe("one-time codes", () => {
  const signerId = "signer_1";
  const fresh = (code: string) => ({
    otpHash: hashOtp(signerId, code),
    otpExpiresAt: new Date(now.getTime() + 5 * 60_000),
    otpAttempts: 0,
    otpLockedUntil: null as Date | null,
  });

  it("are six digits", () => {
    for (let i = 0; i < 50; i++) expect(newOtpCode()).toMatch(/^\d{6}$/);
  });

  it("accept the right code once", () => {
    const r = checkOtp(fresh("123456"), signerId, " 123456 ", now);
    expect(r.result.ok).toBe(true);
    expect(r.nextState.otpHash).toBeNull();
  });

  it("refuse codes for another signer", () => {
    expect(checkOtp(fresh("123456"), "someone_else", "123456", now).result.ok).toBe(false);
  });

  it("count wrong tries and lock after five", () => {
    let state = fresh("123456");
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      const r = checkOtp(state, signerId, "000000", now);
      expect(r.result).toMatchObject({ ok: false, reason: "wrong", attemptsLeft: OTP_MAX_ATTEMPTS - i });
      state = { ...state, ...r.nextState } as typeof state;
    }
    const last = checkOtp(state, signerId, "000000", now);
    expect(last.result).toMatchObject({ ok: false, reason: "wrong", attemptsLeft: 0 });
    expect((last.nextState.otpLockedUntil as Date).getTime()).toBe(now.getTime() + OTP_LOCK_MS);
    state = { ...state, ...last.nextState } as typeof state;
    // Even the right code is refused while locked.
    expect(checkOtp({ ...state, otpHash: hashOtp(signerId, "123456") }, signerId, "123456", now).result).toMatchObject({ reason: "locked" });
    // …and works again after the lock passes, with a new code.
    const later = new Date(now.getTime() + OTP_LOCK_MS + 1000);
    expect(checkOtp({ ...fresh("654321"), otpLockedUntil: state.otpLockedUntil, otpExpiresAt: new Date(later.getTime() + 60_000) }, signerId, "654321", later).result.ok).toBe(true);
  });

  it("expire after ten minutes and need one to exist", () => {
    expect(checkOtp({ ...fresh("123456"), otpExpiresAt: new Date(now.getTime() - 1) }, signerId, "123456", now).result).toMatchObject({ reason: "expired" });
    expect(checkOtp({ ...fresh("123456"), otpHash: null }, signerId, "123456", now).result).toMatchObject({ reason: "none" });
  });
});

describe("signing sessions", () => {
  it("verify for the same signer and link only", () => {
    const v = mintSession("s1", "linkhash", now);
    expect(verifySession(v, "s1", "linkhash", now)).toBe(true);
    expect(verifySession(v, "s2", "linkhash", now)).toBe(false);
    // Resending a link changes its hash and ends sessions opened with the old one.
    expect(verifySession(v, "s1", "newlinkhash", now)).toBe(false);
  });

  it("expire after an hour and resist tampering", () => {
    const v = mintSession("s1", "h", now);
    expect(verifySession(v, "s1", "h", new Date(now.getTime() + 61 * 60_000))).toBe(false);
    const [exp, sig] = v.split(".");
    expect(verifySession(`${Number(exp) + 3600_000}.${sig}`, "s1", "h", now)).toBe(false);
    expect(verifySession(undefined, "s1", "h", now)).toBe(false);
    expect(sessionCookieName("cabcdefghijklmnop")).toBe("esign_efghijklmnop");
  });
});

const F = (p: Partial<TemplateField> & { key: string; type: TemplateField["type"] }): TemplateField => ({
  label: null,
  role: "Client",
  page: 1,
  x: 0.1,
  y: 0.1,
  w: 0.3,
  h: 0.04,
  required: true,
  options: null,
  mergeKey: null,
  fontSize: 11,
  alignment: "left",
  ...p,
});

// A real, minimal PNG (1×1 transparent pixel, padded past the size floor by a text chunk).
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAJnRFWHRDb21tZW50AHNpZ25hdHVyZSBwYWRkaW5nIGZvciB0aGUgdGVzdHMhIQ7XzyMAAAANSURBVHjaY/j//z8ABf4C/qc1gYQAAAAASUVORK5CYII=";

describe("submissions", () => {
  const fields = [
    F({ key: "client_name", type: "text", mergeKey: "client.full_name" }),
    F({ key: "signature_1", type: "signature" }),
    F({ key: "agree_1", type: "checkbox" }),
    F({ key: "plan_1", type: "selection", options: ["Standard", "Premium"] }),
    F({ key: "email_1", type: "email" }),
    F({ key: "notes_1", type: "textarea", required: false }),
    F({ key: "desma_sig", type: "signature", role: "DESMA" }),
  ];

  it("cover only the signer's own, non-CRM boxes", () => {
    expect(signerFields(fields, "Client").map((f) => f.key)).toEqual(["signature_1", "agree_1", "plan_1", "email_1", "notes_1"]);
    expect(signerFields(fields, "DESMA").map((f) => f.key)).toEqual(["desma_sig"]);
  });

  it("turn a complete submission into stamp items and rows", () => {
    expect(decodePng(PNG_1PX)).not.toBeNull();
    const r = checkSubmission(fields, "Client", {
      values: { agree_1: "true", plan_1: "Premium", email_1: "c@example.com", notes_1: "" },
      images: { signature_1: PNG_1PX },
      consent: true,
    });
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.kind)).toEqual(["image", "check", "text", "text"]);
    expect(r.values.map((v) => v.field.key)).toEqual(["signature_1", "agree_1", "plan_1", "email_1"]);
  });

  it("explain everything missing or wrong", () => {
    const r = checkSubmission(fields, "Client", {
      values: { agree_1: "false", plan_1: "Gold", email_1: "not-an-email" },
      images: { signature_1: "data:image/png;base64,AAAA" },
      consent: false,
    });
    const all = r.errors.join(" | ");
    expect(all).toMatch(/Tick the box to agree/);
    expect(all).toMatch(/could not be read/);
    expect(all).toMatch(/Tick agree_1/);
    expect(all).toMatch(/Choose one of the options for plan_1/);
    expect(all).toMatch(/email_1 does not look like an email address/);
    expect(checkSubmission(fields, "Client", { values: {}, images: {}, consent: true }).errors.join(" ")).toMatch(/Sign in signature_1/);
  });

  it("never lets a signer fill someone else's box", () => {
    const r = checkSubmission(fields, "Client", { values: {}, images: { signature_1: PNG_1PX, desma_sig: PNG_1PX }, consent: true, location: null });
    expect(r.values.some((v) => v.field.key === "desma_sig")).toBe(false);
  });
});

describe("sending needs a way to deliver the code", () => {
  it("asks for the client's email unless WhatsApp codes are set up; DESMA logins are exempt", () => {
    const fields = [{ key: "s", label: null, role: "Client" as const, mergeKey: null }, { key: "d", label: null, role: "DESMA" as const, mergeKey: null }];
    const signers = [
      { role: "Client" as const, name: "Client", email: null, phone: "+919876543210", signOrder: 2 },
      { role: "DESMA" as const, userId: "u1", name: "Staff", email: null, phone: null, signOrder: 1 },
    ];
    const p = sendProblems({ input: { signers, mergeData: {}, action: "send" }, fields });
    expect(p).toEqual(["Client needs an email address: it is where their one-time signing code is sent.", "Staff needs an email address or a WhatsApp number to receive the link."]);
    expect(sendProblems({ input: { signers: [signers[0]], mergeData: {}, action: "send" }, fields: [fields[0]], otpByWhatsApp: true })).toEqual([]);
  });
});

describe("certificate", () => {
  it("records signers, verification, history, fingerprints and the verify link", async () => {
    const base = await PDFDocument.create();
    base.addPage([595.28, 841.89]);
    const session = await openForStamping(await base.save(), new Uint8Array(readFileSync("public/fonts/esign/NotoSans-Regular.ttf")));
    await appendCertificate(session, {
      reference: "AHPRA Agreement – Test Candidate",
      requestId: "req_123",
      templateName: "AHPRA Agreement",
      templateVersion: 3,
      originalSha256: "a".repeat(64),
      completedAt: now,
      signers: [
        { name: "Staff Member", role: "DESMA", email: "s****f@desma.in", phone: null, verifiedBy: "Signed in to DesGro as staff", ip: "10.0.0.1", userAgent: "Mozilla/5.0", location: null, viewedAt: now, signedAt: now },
        { name: "Test Candidate", role: "Client", email: "c*******e@example.com", phone: "•••• 3210", verifiedBy: "One-time code by email (c*******e@example.com)", ip: "49.36.1.2", userAgent: "Mobile Safari", location: "9.9312, 76.2673", viewedAt: now, signedAt: now },
      ],
      events: [
        { at: now, action: "sent", actor: "staff@desma.in", ip: "10.0.0.1" },
        { at: now, action: "otp_verified", actor: "Test Candidate", ip: "49.36.1.2" },
        { at: now, action: "completed", actor: "system", ip: null },
      ],
      chainHash: "b".repeat(64),
      verifyUrl: "https://desgro.in/verify/req_123",
      logoPng: new Uint8Array(readFileSync("public/desma-logo.png")),
    });
    const bytes = await session.doc.save();
    const { text, totalPages } = await extractText(bytes, { mergePages: true });
    expect(totalPages).toBeGreaterThanOrEqual(2);
    for (const s of [
      "Certificate of completion",
      "AHPRA Agreement (version 3)",
      "req_123",
      "a".repeat(64),
      "Signed in to DesGro as staff",
      "One-time code by email",
      "49.36.1.2",
      "9.9312, 76.2673",
      "One-time code verified",
      "b".repeat(64),
      "https://desgro.in/verify/req_123",
      "IST",
      "UTC",
    ]) {
      expect(text).toContain(s);
    }
  });
});
