/**
 * Drives the real HDFC SmartStatement downloader (headless Chrome) against a
 * local mock of the bank's page, covering the flows the automation must get
 * right or fail safely on: correct password, wrong password, a statement page
 * with a download button, CAPTCHA/OTP, an expired link, and a changed layout.
 *
 * Needs a local Chrome/Chromium, so it is opt-in:
 *   BANK_BROWSER_TESTS=1 npx vitest run tests/bank-downloader.browser.test.ts
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hdfcDownloader } from "@/lib/bank/downloaders/hdfc";
import { BankAutomationError } from "@/lib/bank/errors";

const RUN = process.env.BANK_BROWSER_TESTS === "1";
const PASSWORD = "Test@1234";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const form = (action: string, error = "") => `<!doctype html><html><body>
  <h3>View your e-statement</h3>${error ? `<p class="err">${error}</p>` : ""}
  <form method="post" action="${action}"><input type="password" name="pwd"><button type="submit">Submit</button></form>
</body></html>`;

let server: Server;
let base = "";

function body(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });
}

beforeAll(async () => {
  if (!RUN) return;
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const pwd = req.method === "POST" ? new URLSearchParams(await body(req)).get("pwd") : null;
    const html = (s: string) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(s);
    };
    const pdf = () => {
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": 'attachment; filename="stmt.pdf"' });
      res.end(PDF);
    };
    switch (url.pathname) {
      case "/direct": // password → the PDF itself
        if (req.method === "GET") return html(form("/direct"));
        return pwd === PASSWORD ? pdf() : html(form("/direct", "Invalid Password. Please try again."));
      case "/viewer": // password → statement page with a download button
        if (req.method === "GET") return html(form("/viewer"));
        return html('<html><body><table><tr><td>Statement</td></tr></table><a href="/file.pdf">Download PDF</a></body></html>');
      case "/file.pdf":
        return pdf();
      case "/captcha":
        return html('<html><body><p>Please enter the captcha shown below</p><input type="password"></body></html>');
      case "/otp":
        if (req.method === "GET") return html(form("/otp"));
        return html('<html><body><p>Enter the One Time Password sent to your mobile</p><input type="text"></body></html>');
      case "/expired":
        return html("<html><body><p>Sorry, this link has expired.</p></body></html>");
      case "/changed":
        return html("<html><body><h1>Welcome to the new SmartStatement experience</h1><button>Continue</button></body></html>");
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

const log = () => undefined;
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof BankAutomationError ? e.code : `UNEXPECTED: ${String(e)}`;
  }
}

describe.skipIf(!RUN)("HDFC SmartStatement downloader (real browser)", () => {
  it("enters the password and captures the PDF", async () => {
    const r = await hdfcDownloader.download(`${base}/direct`, PASSWORD, { log });
    expect(Buffer.from(r.pdf).subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("clicks the statement page's download control", async () => {
    const r = await hdfcDownloader.download(`${base}/viewer`, PASSWORD, { log });
    expect(Buffer.from(r.pdf).subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("reports a rejected password as PASSWORD_REJECTED (never retried)", async () => {
    expect(await codeOf(hdfcDownloader.download(`${base}/direct`, "wrong", { log }))).toBe("PASSWORD_REJECTED");
  }, 60_000);

  it("stops at a CAPTCHA without trying to solve it", async () => {
    expect(await codeOf(hdfcDownloader.download(`${base}/captcha`, PASSWORD, { log }))).toBe("CAPTCHA_OR_MFA");
  }, 60_000);

  it("stops at an OTP prompt after the password", async () => {
    expect(await codeOf(hdfcDownloader.download(`${base}/otp`, PASSWORD, { log }))).toBe("CAPTCHA_OR_MFA");
  }, 60_000);

  it("recognises an expired link", async () => {
    expect(await codeOf(hdfcDownloader.download(`${base}/expired`, PASSWORD, { log }))).toBe("LINK_EXPIRED");
  }, 60_000);

  it("fails safely as PAGE_CHANGED on an unknown layout, without the password in the message", async () => {
    try {
      await hdfcDownloader.download(`${base}/changed`, PASSWORD, { log });
      throw new Error("should have failed");
    } catch (e) {
      expect(e).toBeInstanceOf(BankAutomationError);
      expect((e as BankAutomationError).code).toBe("PAGE_CHANGED");
      expect((e as Error).message).not.toContain(PASSWORD);
    }
  }, 60_000);
});
