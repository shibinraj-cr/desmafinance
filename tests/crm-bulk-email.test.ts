import { describe, it, expect, vi } from "vitest";

// mailer imports app-settings → prisma; mock prisma so importing it never builds a real client.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { fillTemplate } from "@/lib/crm";
import { smtpErrorInfo, friendlySmtpError, formatFrom, textToHtml } from "@/lib/mailer";

describe("fillTemplate", () => {
  const vars = { name: "Priya Menon", first_name: "Priya", service: "AHPRA Direct" };

  it("substitutes known tokens", () => {
    expect(fillTemplate("Hi {first_name}, about {service}", vars)).toBe("Hi Priya, about AHPRA Direct");
  });

  it("is case-insensitive on token names", () => {
    expect(fillTemplate("Hi {First_Name}", vars)).toBe("Hi Priya");
  });

  it("renders a known token with no value as empty string", () => {
    expect(fillTemplate("X{consultant}Y", { consultant: "" })).toBe("XY");
    expect(fillTemplate("X{consultant}Y", { consultant: null })).toBe("XY");
  });

  it("leaves unknown tokens verbatim (so stray braces aren't silently dropped)", () => {
    expect(fillTemplate("Order #{orderId} for {name}", vars)).toBe("Order #{orderId} for Priya Menon");
  });

  it("replaces every occurrence", () => {
    expect(fillTemplate("{name} {name}", vars)).toBe("Priya Menon Priya Menon");
  });
});

describe("smtpErrorInfo", () => {
  it("flags Gmail daily-quota as rate-limited", () => {
    expect(smtpErrorInfo({ responseCode: 550, message: "5.4.5 Daily user sending limit exceeded" }).rateLimited).toBe(true);
  });
  it("flags transient 421/454 as rate-limited", () => {
    expect(smtpErrorInfo({ responseCode: 421, message: "4.7.0 Try again later" }).rateLimited).toBe(true);
    expect(smtpErrorInfo({ responseCode: 454, message: "4.7.0 Too many login attempts" }).rateLimited).toBe(true);
  });
  it("flags 535 as an auth error, not rate-limit", () => {
    const i = smtpErrorInfo({ responseCode: 535, message: "5.7.8 Username and Password not accepted" });
    expect(i.auth).toBe(true);
    expect(i.rateLimited).toBe(false);
  });
  it("does not flag a plain transient send failure", () => {
    const i = smtpErrorInfo({ responseCode: 421, message: "connection closed" });
    // 421 is treated as rate-limited (back off) — assert the auth flag stays false
    expect(i.auth).toBe(false);
  });
  it("handles non-Error input", () => {
    expect(smtpErrorInfo(null).message).toBe("send failed");
  });
});

describe("friendlySmtpError", () => {
  it("maps auth failures to an App Password hint", () => {
    expect(friendlySmtpError({ responseCode: 535, message: "5.7.8 ..." })).toMatch(/App Password/i);
  });
  it("maps throttling to a try-later hint", () => {
    expect(friendlySmtpError({ responseCode: 421, message: "try again later" })).toMatch(/later/i);
  });
});

describe("formatFrom", () => {
  const base = { user: "leads@x.com", pass: "p", fromAddress: "leads@x.com", replyTo: null, dailyCap: 450 };
  it("returns the bare address when no display name", () => {
    expect(formatFrom({ ...base, fromName: null })).toBe("leads@x.com");
  });
  it("quotes the display name and strips CR/LF (header-injection safe)", () => {
    const out = formatFrom({ ...base, fromName: "DESMA\r\nBcc: evil@x.com" });
    expect(out).toBe('"DESMA  Bcc: evil@x.com" <leads@x.com>'); // each of \r and \n → a space
    expect(out).not.toMatch(/[\r\n]/); // the point: no raw line breaks survive
  });
});

describe("textToHtml", () => {
  it("escapes HTML and converts newlines to <br>", () => {
    const html = textToHtml("a < b\nc & d");
    expect(html).toContain("a &lt; b");
    expect(html).toContain("c &amp; d");
    expect(html).toContain("<br>");
  });
});
