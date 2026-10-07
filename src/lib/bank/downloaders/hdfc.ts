import type { BrowserContext, Download, Frame, Locator, Page, Response } from "playwright-core";
import { BankAutomationError } from "../errors";
import { launchBrowser } from "../browser";
import type { DownloadContext, DownloadResult, StatementDownloader } from "./types";

/**
 * HDFC SmartStatement: open the e-mailed link, enter the statement password,
 * and capture the statement PDF — whichever way the page delivers it (a
 * download, a PDF response, a PDF in a frame/popup, or as a last resort the
 * page's own print view).
 *
 * The page is observed, not assumed: nothing here depends on HDFC element ids,
 * so a cosmetic redesign keeps working and a structural one fails safely as
 * PAGE_CHANGED with a value-free outline of what the page did show.
 *
 * Security controls are a hard stop. A CAPTCHA, OTP or verification prompt is
 * CAPTCHA_OR_MFA — never solved, never retried — and goes to a person.
 */

const BLOCKER = /captcha|recaptcha|hcaptcha|one[-\s]?time password|\bOTP\b|verification code|verify you are human|are you a robot/i;
const EXPIRED = /link (has )?expired|session (has )?expired|invalid (link|request)|statement (is )?no longer available|already been (viewed|downloaded)/i;
const BAD_PASSWORD = /(incorrect|invalid|wrong) password|password (is )?(incorrect|invalid|wrong)|authentication failed|password does not match/i;
const SUBMIT = /^(submit|view|view statement|ok|continue|proceed|login|open|go|download)$/i;
const DOWNLOAD_CONTROL = /download|save as pdf|\bpdf\b/i;
const PRINT_CONTROL = /^print/i;

async function pageText(page: Page): Promise<string> {
  const parts: string[] = [];
  for (const f of page.frames()) {
    parts.push(await f.locator("body").innerText({ timeout: 2_000 }).catch(() => ""));
  }
  return parts.join("\n").slice(0, 20_000);
}

async function hasBlockerFrame(page: Page): Promise<boolean> {
  return page.frames().some((f) => /recaptcha|hcaptcha|challenges\.cloudflare|captcha/i.test(f.url()));
}

async function findVisible(page: Page, selector: string): Promise<{ frame: Frame; loc: Locator } | null> {
  for (const frame of page.frames()) {
    const loc = frame.locator(selector);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) return { frame, loc: el };
    }
  }
  return null;
}

/** Value-free description of the page for PAGE_CHANGED diagnostics. */
async function outline(page: Page): Promise<string> {
  const u = new URL(page.url());
  const title = await page.title().catch(() => "");
  const inputs = await page.locator("input").evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).type || "text").join(","),
  ).catch(() => "");
  const buttons = await page
    .locator("button, input[type=submit], input[type=button], a")
    .evaluateAll((els) =>
      els
        .map((e) => ((e as HTMLElement).innerText || (e as HTMLInputElement).value || "").trim().slice(0, 30))
        .filter(Boolean)
        .slice(0, 12)
        .join(" | "),
    )
    .catch(() => "");
  return `page ${u.host}${u.pathname} title="${title.slice(0, 60)}" inputs=[${inputs}] controls=[${buttons}] frames=${page.frames().length}`;
}

function isPdf(buf: Uint8Array): boolean {
  return Buffer.from(buf.subarray(0, 1024)).toString("latin1").includes("%PDF-");
}

async function readDownload(d: Download): Promise<Uint8Array> {
  const stream = await d.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return new Uint8Array(Buffer.concat(chunks));
}

class Capture {
  pdf: Uint8Array | null = null;
  via: DownloadResult["via"] | null = null;
  private pending: Promise<unknown>[] = [];

  attach(context: BrowserContext) {
    context.on("response", (r: Response) => {
      const ct = r.headers()["content-type"] ?? "";
      if (!/application\/(pdf|octet-stream)/i.test(ct)) return;
      this.pending.push(
        r.body().then((b) => this.offer(new Uint8Array(b), "response")).catch(() => undefined),
      );
    });
    const onPage = (p: Page) =>
      p.on("download", (d) => {
        this.pending.push(readDownload(d).then((b) => this.offer(b, "download")).catch(() => undefined));
      });
    context.pages().forEach(onPage);
    context.on("page", onPage);
  }

  offer(buf: Uint8Array, via: DownloadResult["via"]) {
    if (!this.pdf && isPdf(buf)) {
      this.pdf = buf;
      this.via = via;
    }
  }

  /** Wait up to `ms` for a PDF to arrive by any route. */
  async wait(ms: number, alsoStopWhen?: () => Promise<boolean>): Promise<boolean> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await Promise.allSettled(this.pending);
      if (this.pdf) return true;
      if (alsoStopWhen && (await alsoStopWhen())) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    await Promise.allSettled(this.pending);
    return !!this.pdf;
  }
}

/** A PDF shown inside the page (iframe/embed/object), fetched with the page's own session. */
async function grabEmbeddedPdf(page: Page, cap: Capture): Promise<void> {
  for (const frame of page.frames()) {
    const srcs = await frame
      .locator("iframe[src], embed[src], object[data]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("src") || e.getAttribute("data") || ""))
      .catch(() => [] as string[]);
    for (const src of srcs) {
      if (!src || !/pdf|blob:|GetStatement|statement/i.test(src)) continue;
      try {
        const b64 = await frame.evaluate(async (u) => {
          const r = await fetch(u, { credentials: "include" });
          const buf = new Uint8Array(await r.arrayBuffer());
          let s = "";
          for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          return btoa(s);
        }, src);
        cap.offer(new Uint8Array(Buffer.from(b64, "base64")), "embed");
        if (cap.pdf) return;
      } catch {
        /* try the next one */
      }
    }
  }
}

async function checkBlockers(page: Page): Promise<void> {
  if (await hasBlockerFrame(page)) {
    throw new BankAutomationError("CAPTCHA_OR_MFA", "The bank page is showing a CAPTCHA");
  }
  const text = await pageText(page);
  if (BLOCKER.test(text)) throw new BankAutomationError("CAPTCHA_OR_MFA", "The bank page is asking for CAPTCHA / OTP verification");
  if (EXPIRED.test(text)) throw new BankAutomationError("LINK_EXPIRED", "The bank says the statement link has expired or is invalid");
}

export const hdfcDownloader: StatementDownloader = {
  async download(url: string, password: string, ctx: DownloadContext): Promise<DownloadResult> {
    const browser = await launchBrowser();
    ctx.log("browser", "Browser launched");
    // A fresh context per statement: no stored cookies, nothing persisted after close.
    const context = await browser.newContext({
      acceptDownloads: true,
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      viewport: { width: 1280, height: 1000 },
    });
    context.setDefaultTimeout(30_000);
    const cap = new Capture();
    cap.attach(context);
    const page = await context.newPage();

    const fail = async (e: BankAutomationError): Promise<never> => {
      if (ctx.screenshot) {
        await page
          .screenshot({ fullPage: true, timeout: 5_000 })
          .then((png) => ctx.screenshot!(new Uint8Array(png)))
          .catch(() => undefined);
      }
      throw e;
    };

    try {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch (e) {
        // A link that answers with the PDF itself aborts navigation as a download.
        if (!/download is starting|net::ERR_ABORTED/i.test(e instanceof Error ? e.message : "")) throw e;
      }
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      ctx.log("page", "SmartStatement page opened");
      if (await cap.wait(1_000)) return done();

      await checkBlockers(page).catch((e) => fail(e as BankAutomationError));

      const pw = await findVisible(page, "input[type=password]");
      if (!pw) {
        await grabEmbeddedPdf(page, cap);
        if (cap.pdf) return done();
        return await fail(new BankAutomationError("PAGE_CHANGED", `No password field on the statement page — ${await outline(page)}`));
      }
      ctx.log("auth", "Password screen detected");

      await pw.loc.fill(password);
      const submit =
        (await findVisible(page, "button[type=submit], input[type=submit]")) ??
        (await (async () => {
          for (const frame of page.frames()) {
            const btn = frame.getByRole("button", { name: SUBMIT }).first();
            if (await btn.isVisible().catch(() => false)) return { frame, loc: btn };
          }
          return null;
        })());
      if (submit) await submit.loc.click({ noWaitAfter: true });
      else await pw.loc.press("Enter");
      ctx.log("auth", "Password submitted");

      // Wait for the PDF, or for the page to say no.
      let rejected = false;
      const arrived = await cap.wait(25_000, async () => {
        const text = await pageText(page);
        if (BAD_PASSWORD.test(text)) rejected = true;
        if (BLOCKER.test(text) || (await hasBlockerFrame(page))) return true;
        const stillAsking = await findVisible(page, "input[type=password]");
        return rejected || !stillAsking;
      });
      if (arrived) {
        ctx.log("auth", "Authentication successful");
        return done();
      }
      if (rejected) return await fail(new BankAutomationError("PASSWORD_REJECTED", "The bank rejected the statement password"));
      await checkBlockers(page).catch((e) => fail(e as BankAutomationError));
      if (await findVisible(page, "input[type=password]")) {
        return await fail(new BankAutomationError("PAGE_CHANGED", `Still on the password screen after submitting — ${await outline(page)}`));
      }
      ctx.log("auth", "Authentication successful");
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

      // Statement page: look for the bank's own download / save-as-PDF control.
      for (const frame of page.frames()) {
        const controls = frame.locator("a, button, input[type=button], input[type=submit], [role=button]").filter({ hasText: DOWNLOAD_CONTROL });
        const n = Math.min(await controls.count().catch(() => 0), 3);
        for (let i = 0; i < n && !cap.pdf; i++) {
          const el = controls.nth(i);
          if (!(await el.isVisible().catch(() => false))) continue;
          ctx.log("download", "Clicking the statement's download control");
          await el.click({ noWaitAfter: true }).catch(() => undefined);
          if (await cap.wait(20_000)) return done();
        }
      }
      await grabEmbeddedPdf(page, cap);
      if (cap.pdf) return done();

      // Last resort: the page offers only Print — capture the print rendering.
      let hasPrint = false;
      for (const frame of page.frames()) {
        const btn = frame.locator("a, button, input[type=button]").filter({ hasText: PRINT_CONTROL }).first();
        if (await btn.isVisible().catch(() => false)) hasPrint = true;
      }
      if (hasPrint) {
        ctx.log("download", "Only a print view is offered — capturing it as PDF");
        cap.offer(new Uint8Array(await page.pdf({ format: "A4", printBackground: true })), "print");
        if (cap.pdf) return done();
      }

      return await fail(new BankAutomationError("PAGE_CHANGED", `Statement page shows no PDF or download control — ${await outline(page)}`));
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }

    function done(): DownloadResult {
      ctx.log("download", `PDF captured (${cap.via})`);
      return { pdf: cap.pdf!, via: cap.via! };
    }
  },
};
